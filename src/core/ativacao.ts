/**
 * #ativarbot / #habilitarbot <tipo> e #desativarbot: o dono liga ou desliga o bot num grupo
 * mandando o comando no próprio grupo, sem arquivo JSON nem script no servidor.
 *
 * Quem pode: o próprio número do bot (mensagem "fromMe") ou um telefone da variável BOT_DONOS
 * do .env (vários separados por vírgula). Os outros são ignorados em silêncio.
 */
import type { Sql } from '../db.js';
import type { InboundMessage, Logger, WhatsAppProvider } from './types.js';
import { digits, samePhone } from './phone.js';
import { foldCommand } from './commands.js';

export type BotType = 'tecnico' | 'geral' | 'splinter' | 'agua';

export const BOT_TYPES: Record<BotType, { label: string; defaultName: string }> = {
  tecnico: { label: 'dúvidas técnicas', defaultName: 'Dúvidas técnicas' },
  geral: { label: 'social', defaultName: 'Bot social' },
  splinter: { label: 'fitness', defaultName: 'Desafio fitness' },
  agua: { label: 'qualidade agua', defaultName: 'Qualidade da água' },
};

export type AtivacaoCommand = { action: 'ativar'; module: BotType | null; typed: string } | { action: 'desativar' };

/** Lê o tipo escrito depois do comando ('duvidas tecnicas', 'social', 'fitness'...). */
export function parseBotType(text: string): BotType | null {
  const t = foldCommand(text).replace(/[^a-z ]/g, ' ');
  if (/agua|laudo/.test(t)) return 'agua';
  if (/tecnic|duvida|profission|trabalho/.test(t)) return 'tecnico';
  if (/fitness|fit\b|desafio|splinter|academia|treino/.test(t)) return 'splinter';
  if (/social|geral|conversa|amigos|turma/.test(t)) return 'geral';
  return null;
}

/** '#ativarbot social', '#habilitar bot fitness', '#desativarbot'. Espera o texto já normalizado. */
export function parseAtivacao(text: string): AtivacaoCommand | null {
  const m = /^\s*#(ativar|habilitar|desativar|desabilitar) ?bot(?![a-z0-9])(.*)$/s.exec(text);
  if (!m) return null;
  if (m[1] === 'desativar' || m[1] === 'desabilitar') return { action: 'desativar' };
  const typed = m[2]!.trim();
  return { action: 'ativar', module: typed ? parseBotType(typed) : null, typed };
}

/** Telefones do .env (BOT_DONOS=5511999990000,5511988887777). */
export function ownerPhones(env: NodeJS.ProcessEnv): string[] {
  return String(env.BOT_DONOS ?? '')
    .split(/[,;\s]+/)
    .map(digits)
    .filter((p) => p.length >= 8);
}

export function isOwner(msg: InboundMessage, phone: string, env: NodeJS.ProcessEnv): boolean {
  if (msg.fromMe) return true;
  return ownerPhones(env).some((o) => samePhone(o, phone));
}

const OPTIONS = [
  '• *#ativarbot social* - grupo de amigos (mascote, agenda, resumo, brincadeiras)',
  '• *#ativarbot fitness* - desafio fitness (check-ins com foto, pontos e ranking)',
  '• *#ativarbot duvidas tecnicas* - grupo de trabalho (/duvida com a base técnica)',
  '• *#ativarbot qualidade agua* - grupo de trabalho que autoriza os laudos de análise de água',
  '• *#desativarbot* - desliga o bot neste grupo (os dados ficam guardados)',
].join('\n');

interface Deps {
  sql: Sql;
  wa: WhatsAppProvider;
  log: Logger;
  connectionId: string;
  connectionLabel: string;
  /** Telefone de quem mandou (já resolvido do LID quando deu). */
  senderPhone: string;
  senderName: string;
}

/** Executa o comando e responde no grupo. Devolve true se mudou algo no banco. */
export async function runAtivacao(d: Deps, msg: InboundMessage, cmd: AtivacaoCommand): Promise<boolean> {
  const reply = (text: string) => d.wa.sendText(msg.chatJid, text);
  if (!msg.isGroup) {
    await reply('Esse comando só funciona dentro de um grupo.');
    return false;
  }
  const [existing] = await d.sql<{ id: string; module: string; active: boolean; name: string; tenant_id: string }[]>`
    select id, module, active, name, tenant_id from bots where connection_id = ${d.connectionId} and chat_jid = ${msg.chatJid}`;

  if (cmd.action === 'desativar') {
    if (!existing?.active) {
      await reply('O bot já está desligado neste grupo.');
      return false;
    }
    await d.sql`update bots set active = false where id = ${existing.id}`;
    d.log.info({ chat: msg.chatJid, bot: existing.id }, 'bot desativado por comando');
    await reply(`⏸️ Bot desligado neste grupo. Os dados ficam guardados; para ligar de novo mande *#ativarbot ${BOT_TYPES[existing.module as BotType]?.label ?? 'social'}*.`);
    return true;
  }

  if (!cmd.module) {
    await reply(
      (cmd.typed ? `Não entendi o tipo "${cmd.typed}". ` : 'Falta dizer o tipo de bot. ') + 'Escolha um:\n\n' + OPTIONS,
    );
    return false;
  }
  const type = cmd.module;
  if (existing?.active && existing.module === type) {
    await reply(`✅ O bot já está ligado neste grupo como *${BOT_TYPES[type].label}*. Mande #ajuda para ver os comandos.`);
    return false;
  }

  const tenantId = existing?.tenant_id ?? (await tenantFor(d));
  const name = existing && existing.module === type ? existing.name : BOT_TYPES[type].defaultName;
  const [bot] = await d.sql<{ id: string }[]>`
    insert into bots (tenant_id, connection_id, name, module, chat_jid)
    values (${tenantId}, ${d.connectionId}, ${name}, ${type}, ${msg.chatJid})
    on conflict (connection_id, chat_jid) do update set name = excluded.name, module = excluded.module, active = true
    returning id`;
  const admins = await addAdmins(d, bot!.id, msg.chatJid);
  d.log.info({ chat: msg.chatJid, bot: bot!.id, module: type, before: existing?.module ?? null }, 'bot ativado por comando');

  const changed = existing && existing.module !== type ? ` (antes era *${BOT_TYPES[existing.module as BotType]?.label ?? existing.module}*)` : '';
  const lines = [`✅ Bot ligado neste grupo como *${BOT_TYPES[type].label}*${changed}.`];
  lines.push(admins.length ? `Admins do bot: ${admins.join(', ')}.` : 'Ainda não há admins do bot neste grupo.');
  if (type === 'tecnico') {
    lines.push('Usa a mesma base técnica dos outros grupos. Os admins acima são os sêniores que revisam as respostas (/correto, /corrigir...).');
    lines.push('Perguntas: /duvida + a pergunta. Mande #ajuda para ver tudo.');
  } else if (type === 'agua') {
    lines.push('Os laudos chegam pelo sistema de análise. Os admins acima autorizam com #aprovar ou #recusar (respondendo à mensagem do laudo).');
    lines.push('Mande #ajuda para ver os comandos.');
  } else if (type === 'splinter') {
    const [ch] = await d.sql<{ name: string }[]>`select name from splinter_challenges where bot_id = ${bot!.id} and status = 'ativo' limit 1`;
    if (ch) lines.push(`Desafio ativo: *${ch.name}*.`);
    else {
      lines.push('Já funcionam #ajuda, #motivação, ?alimento, agenda e resumo.');
      lines.push('⚠️ Para as fotos valerem pontos falta cadastrar o desafio (datas, pontuação e participantes). O dono do bot faz isso pelo arquivo do desafio.');
    }
  } else {
    lines.push('Mande #ajuda para ver os comandos.');
  }
  await reply(lines.join('\n'));
  return true;
}

/** Cliente dono da conexão: o dos outros bots do mesmo número; se não houver, cria um com o nome da conexão. */
async function tenantFor(d: Deps): Promise<string> {
  const [other] = await d.sql<{ tenant_id: string }[]>`
    select tenant_id from bots where connection_id = ${d.connectionId} order by created_at limit 1`;
  if (other) return other.tenant_id;
  const [t] = await d.sql<{ id: string }[]>`insert into tenants (name) values (${d.connectionLabel}) returning id`;
  return t!.id;
}

/**
 * Admins do bot: quem mandou o comando e os admins do grupo no WhatsApp (quando a AvisaAPI mostra o telefone).
 * Nunca tira ninguém. Devolve os nomes de todos os admins do bot no grupo.
 */
async function addAdmins(d: Deps, botId: string, chatJid: string): Promise<string[]> {
  const add = async (phone: string, name: string | null) => {
    const p = digits(phone);
    if (p.length < 10) return;
    await d.sql`insert into bot_admins (bot_id, phone, name) values (${botId}, ${p}, ${name})
      on conflict (bot_id, phone) do update set name = coalesce(bot_admins.name, excluded.name)`;
  };
  if (d.senderPhone) await add(d.senderPhone, d.senderName || null);
  try {
    for (const m of await d.wa.listGroupMembers(chatJid)) {
      const lid = m.lid ?? (m.jid.endsWith('@lid') ? m.jid : '');
      if (!m.admin || (lid && digits(lid) === digits(m.phone))) continue; // só LID: não dá para saber o telefone
      await add(m.phone, m.name ?? null);
    }
  } catch (err) {
    d.log.warn({ err: String(err) }, 'ativarbot: não consegui listar os admins do grupo');
  }
  const rows = await d.sql<{ phone: string; name: string | null }[]>`select phone, name from bot_admins where bot_id = ${botId} order by name`;
  return rows.map((r) => r.name || `final ${r.phone.slice(-4)}`);
}
