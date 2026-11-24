/**
 * Bot de qualidade da água (grupo PROFISSIONAL).
 *
 * É uma peça da automação de laudos de outro sistema: o sistema manda o laudo para o bot
 * (POST /api/agua/laudos, ver api.ts), o bot posta no grupo pedindo autorização e um admin
 * responde com #aprovar ou #recusar. A decisão volta para o sistema de duas formas:
 * webhook de retorno (callback_url do laudo ou AGUA_CALLBACK_URL) e consulta de status
 * (GET /api/agua/laudos/:id). Email, Neovero, planilha e dashboard ficam no outro sistema.
 */
import type { Sql } from '../../db.js';
import type { BotContext, BotModule, InboundMessage, Logger } from '../../core/types.js';

export type Resultado = 'satisfatorio' | 'insatisfatorio';
export type Status = 'pendente' | 'aprovado' | 'recusado';

export interface LaudoDados {
  cliente?: string;
  equipamento?: string;
  os?: string;
  data_coleta?: string;
  resumo?: string;
  parametros?: { nome: string; valor: string; limite?: string; ok?: boolean }[];
  link?: string;
}

export interface LaudoRow {
  id: string;
  bot_id: string;
  external_id: string;
  resultado: Resultado;
  dados: LaudoDados;
  status: Status;
  group_msg_id: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  motivo: string | null;
  callback_url: string | null;
  callback_status: string | null;
  created_at: Date;
}

/** Trocado nos testes. */
export const aguaDeps = {
  fetch: ((...a: Parameters<typeof fetch>) => fetch(...a)) as typeof fetch,
  key: () => process.env.AGUA_API_KEY ?? '',
};

/** O que o sistema externo recebe no webhook de retorno e na consulta de status. */
export function laudoJson(r: LaudoRow) {
  return {
    id: r.external_id,
    resultado: r.resultado,
    status: r.status,
    decidido_por: r.decided_by,
    decidido_em: r.decided_at ? new Date(r.decided_at).toISOString() : null,
    motivo: r.motivo,
    retorno: r.callback_status,
  };
}

/** Texto do laudo no grupo. */
export function laudoText(external: string, resultado: Resultado, d: LaudoDados): string {
  const ok = resultado === 'satisfatorio';
  const lines = [ok ? `✅ *Laudo satisfatório* - ${external}` : `🚨 *ALERTA: laudo INSATISFATÓRIO* - ${external}`, ''];
  if (d.cliente) lines.push(`*Cliente:* ${d.cliente}`);
  if (d.equipamento) lines.push(`*Equipamento:* ${d.equipamento}`);
  if (d.os) lines.push(`*OS:* ${d.os}`);
  if (d.data_coleta) lines.push(`*Coleta:* ${d.data_coleta}`);
  for (const p of d.parametros ?? []) {
    const mark = p.ok === false ? '❌' : p.ok === true ? '✔️' : '•';
    lines.push(`${mark} ${p.nome}: ${p.valor}${p.limite ? ` (limite ${p.limite})` : ''}`);
  }
  if (d.resumo) lines.push('', d.resumo);
  if (d.link) lines.push('', `Laudo: ${d.link}`);
  lines.push('');
  if (ok) lines.push('Autoriza o envio para o cliente? Um admin responde a esta mensagem com *#aprovar* ou *#recusar* + motivo.');
  else
    lines.push(
      'Autoriza seguir o fluxo (encerrar a OS com o laudo insatisfatório, abrir OS de recoleta e avisar o cliente)? Um admin responde a esta mensagem com *#aprovar* ou *#recusar* + motivo.',
    );
  return lines.join('\n');
}

export interface NovoLaudo {
  external_id: string;
  resultado: Resultado;
  dados: LaudoDados;
  callback_url?: string | null;
}

/**
 * Registra o laudo e posta no grupo. Mandar o mesmo código de novo não posta outra vez:
 * devolve o laudo como está (o sistema pode repetir o envio sem medo).
 */
export async function receberLaudo(ctx: BotContext, l: NovoLaudo): Promise<{ laudo: LaudoRow; novo: boolean }> {
  const [row] = await ctx.sql<LaudoRow[]>`
    insert into agua_laudos (bot_id, external_id, resultado, dados, callback_url)
    values (${ctx.bot.id}, ${l.external_id}, ${l.resultado}, ${ctx.sql.json(l.dados as never)}, ${l.callback_url ?? null})
    on conflict (bot_id, external_id) do nothing
    returning *`;
  if (!row) {
    const [old] = await ctx.sql<LaudoRow[]>`select * from agua_laudos where bot_id = ${ctx.bot.id} and external_id = ${l.external_id}`;
    return { laudo: old!, novo: false };
  }
  const msgId = await ctx.replyWithId(laudoText(l.external_id, l.resultado, l.dados));
  const [saved] = await ctx.sql<LaudoRow[]>`update agua_laudos set group_msg_id = ${msgId || null} where id = ${row.id} returning *`;
  ctx.log.info({ bot: ctx.bot.id, laudo: l.external_id, resultado: l.resultado }, 'laudo postado no grupo');
  return { laudo: saved!, novo: true };
}

/** Avisa o sistema externo da decisão. Devolve 'ok', 'falhou: ...' ou null (sem endereço). */
export async function avisarSistema(sql: Sql, log: Logger, r: LaudoRow): Promise<string | null> {
  const url = r.callback_url || process.env.AGUA_CALLBACK_URL || '';
  if (!url) return null;
  let status: string;
  try {
    const key = aguaDeps.key();
    const res = await aguaDeps.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(laudoJson({ ...r, callback_status: null })),
      signal: AbortSignal.timeout(15_000),
    });
    status = res.ok ? 'ok' : `falhou: HTTP ${res.status}`;
  } catch (err) {
    status = `falhou: ${String(err).slice(0, 200)}`;
  }
  if (status !== 'ok') log.warn({ laudo: r.external_id, status }, 'agua: retorno ao sistema falhou');
  await sql`update agua_laudos set callback_status = ${status} where id = ${r.id}`;
  return status;
}

const pending = (ctx: BotContext) =>
  ctx.sql<LaudoRow[]>`select * from agua_laudos where bot_id = ${ctx.bot.id} and status = 'pendente' order by created_at`;

/** Acha o laudo do #aprovar/#recusar: resposta à mensagem do bot, código escrito, ou o único pendente. */
async function findTarget(ctx: BotContext, msg: InboundMessage, rest: string): Promise<{ laudo?: LaudoRow; rest: string; erro?: string }> {
  if (msg.quoted?.messageId) {
    const [l] = await ctx.sql<LaudoRow[]>`
      select * from agua_laudos where bot_id = ${ctx.bot.id} and group_msg_id = ${msg.quoted.messageId}`;
    if (l) return { laudo: l, rest };
  }
  const first = rest.split(/\s+/)[0] ?? '';
  if (first) {
    const [l] = await ctx.sql<LaudoRow[]>`
      select * from agua_laudos where bot_id = ${ctx.bot.id} and lower(external_id) = ${first.toLowerCase()}`;
    if (l) return { laudo: l, rest: rest.slice(first.length).trim() };
  }
  const open = await pending(ctx);
  if (open.length === 1 && !msg.quoted?.messageId) return { laudo: open[0], rest };
  if (open.length === 0) return { rest, erro: 'Não há laudos esperando autorização.' };
  return {
    rest,
    erro: `Há ${open.length} laudos pendentes. Responda à mensagem do laudo ou escreva o código. Ex.: *#aprovar ${open[0]!.external_id}*`,
  };
}

async function decidir(ctx: BotContext, msg: InboundMessage, status: 'aprovado' | 'recusado', rest: string): Promise<void> {
  if (!(await ctx.isAdmin(msg.senderPhone))) return ctx.reply('⚠️ Só os admins do bot podem aprovar ou recusar laudos.');
  const t = await findTarget(ctx, msg, rest);
  if (!t.laudo) return ctx.reply(t.erro!);
  const l = t.laudo;
  if (l.status !== 'pendente') {
    return ctx.reply(`O laudo *${l.external_id}* já foi ${l.status} por ${l.decided_by ?? 'alguém'}.`);
  }
  const name = (await ctx.nameOf(msg.senderPhone)) || msg.pushName || `final ${msg.senderPhone.slice(-4)}`;
  const motivo = t.rest.trim() || null;
  const [done] = await ctx.sql<LaudoRow[]>`
    update agua_laudos set status = ${status}, decided_by = ${name}, decided_phone = ${msg.senderPhone || null},
      decided_at = ${ctx.now()}, motivo = ${motivo}
    where id = ${l.id} and status = 'pendente' returning *`;
  if (!done) return ctx.reply(`O laudo *${l.external_id}* já tinha sido decidido.`);
  ctx.log.info({ bot: ctx.bot.id, laudo: l.external_id, status, by: name }, 'laudo decidido');

  const next =
    status === 'recusado'
      ? 'O fluxo fica parado para este laudo.'
      : l.resultado === 'satisfatorio'
        ? 'O laudo segue para o email do cliente.'
        : 'O fluxo segue: encerrar a OS, abrir a recoleta e avisar o cliente.';
  const lines = [`${status === 'aprovado' ? '👍' : '✋'} Laudo *${l.external_id}* ${status} por ${name}.${motivo ? ` Motivo: ${motivo}` : ''}`, next];
  const ret = await avisarSistema(ctx.sql, ctx.log, done);
  if (ret && ret !== 'ok') lines.push('⚠️ Não consegui avisar o sistema agora; ele ainda pode consultar a decisão.');
  await ctx.reply(lines.join('\n'));
}

async function listarPendentes(ctx: BotContext): Promise<void> {
  const open = await pending(ctx);
  if (!open.length) return ctx.reply('✅ Nenhum laudo esperando autorização.');
  const lines = [`⏳ *Laudos esperando autorização (${open.length})*`, ''];
  for (const l of open) {
    const who = [l.dados.cliente, l.dados.equipamento].filter(Boolean).join(' - ');
    lines.push(`${l.resultado === 'satisfatorio' ? '✅' : '🚨'} *${l.external_id}*${who ? ` ${who}` : ''}`);
  }
  lines.push('', 'Para decidir: responda à mensagem do laudo com #aprovar ou #recusar, ou escreva o código. Ex.: #aprovar ' + open[0]!.external_id);
  await ctx.reply(lines.join('\n'));
}

export const HELP = [
  '💧 *Bot de qualidade da água*',
  '',
  'Os laudos chegam aqui sozinhos, vindos do sistema de análise.',
  '• #pendentes - laudos esperando autorização',
  '',
  '🛡️ *Admins*',
  '• #aprovar - respondendo à mensagem do laudo (ou #aprovar + código)',
  '• #recusar + motivo - respondendo à mensagem do laudo (ou #recusar + código + motivo)',
  '• #promover @pessoa / #demover @pessoa - quem pode aprovar (#admins lista)',
  '• #suporte + o problema ou a melhoria - manda o pedido para a equipe do bot',
].join('\n');

export const agua: BotModule = {
  id: 'agua',
  defaultMascot: {
    name: 'Bot da Qualidade da Água',
    persona:
      'Você é o assistente de um grupo de trabalho de controle de qualidade da água. Seja objetivo, educado e profissional. Português do Brasil, mensagens curtas, formatação de WhatsApp (*negrito* com um asterisco).',
  },
  features: ['suporte', 'grupo', 'admins'],
  async handle(ctx, msg) {
    if (msg.type !== 'text') return;
    const t = msg.text.trim();
    const m = /^[#!/](aprovar|aprovado|autorizar|autorizo|recusar|recusado|reprovar|negar)(?![\p{L}\p{N}])\s*(.*)$/su.exec(t);
    if (m) return decidir(ctx, msg, /^(aprov|autoriz)/.test(m[1]!) ? 'aprovado' : 'recusado', m[2]!);
    if (/^[#!/]pendentes?(?![\p{L}\p{N}])/u.test(t)) return listarPendentes(ctx);
    if (/^[#!/](ajuda|comandos)(?![\p{L}\p{N}])/u.test(t)) return ctx.reply(HELP);
  },
};
