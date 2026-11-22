import type { BotContext, BotModule, GroupMember, InboundMessage } from '../../core/types.js';
import { digits, last8, samePhone } from '../../core/phone.js';
import { prettyPhone } from '../boasvindas/index.js';
import { realPhones } from '../../core/members.js';
import { local } from '../../core/time.js';
import { adminOnly } from '../admins/index.js';
import { setSetting, settings } from '../curiar/index.js';

const DAY = 86_400_000;
/** Dias sem interagir para receber aviso. */
export const INACTIVE_DAYS = 7;
/** Avisos antes de sair do grupo: quem continua sumido depois do 3º aviso é removido. */
export const MAX_WARNINGS = 3;

interface Row {
  member_key: string;
  tracked_since: Date;
  last_seen_at: Date | null;
  warnings: number;
  last_warned_at: Date | null;
}

/** Anota que a pessoa falou no grupo e zera os avisos dela. */
async function seen(ctx: BotContext, msg: InboundMessage): Promise<void> {
  const phone = digits(msg.senderPhone);
  const lid = msg.senderLid?.endsWith('@lid') ? digits(msg.senderLid) : '';
  // Sem telefone conhecido, anota pelo LID: assim quem fala nunca é tratado como sumido.
  const key = phone.length >= 8 && phone !== lid ? last8(phone) : lid.length >= 8 ? `lid:${lid}` : '';
  if (!key) return;
  await ctx.sql`
    insert into member_activity (bot_id, member_key, phone, tracked_since, last_seen_at)
    values (${ctx.bot.id}, ${key}, ${key.startsWith('lid:') ? '' : phone}, ${msg.timestamp}, ${msg.timestamp})
    on conflict (bot_id, member_key) do update set
      phone = excluded.phone, warnings = 0,
      last_seen_at = greatest(member_activity.last_seen_at, excluded.last_seen_at)`;
}

/** Começa a acompanhar quem ainda não tem registro (quem já tem fica como está). */
async function track(ctx: BotContext, members: Member[], now: Date): Promise<void> {
  for (const m of members) {
    await ctx.sql`
      insert into member_activity (bot_id, member_key, phone, tracked_since) values (${ctx.bot.id}, ${m.key}, ${m.phone}, ${now})
      on conflict (bot_id, member_key) do nothing`;
  }
}

/** Membro do grupo com a chave usada em member_activity. */
interface Member extends GroupMember {
  key: string;
  /** true quando a AvisaAPI só mandou o LID e o bot ainda não sabe o telefone (pessoa que nunca falou). */
  hidden: boolean;
}

/**
 * Lista do grupo com o telefone de verdade de cada um. A AvisaAPI pode mandar só o LID; aí o telefone
 * vem do que o bot já aprendeu (wa_contacts). Sem isso, quem fala no grupo ficava registrado pelo
 * telefone e a lista pelo LID: o registro de quem fala era apagado toda semana e todos pareciam sumidos.
 */
async function resolveMembers(ctx: BotContext): Promise<{ members: Member[]; error?: string }> {
  let listed: GroupMember[] = [];
  let error: string | undefined;
  for (let i = 0; i < 2 && !listed.length; i++) {
    try {
      listed = await ctx.wa.listGroupMembers(ctx.bot.chatJid);
      error = listed.length ? undefined : 'a AvisaAPI devolveu o grupo sem membros';
    } catch (err) {
      error = `não consegui listar o grupo (${String(err)})`;
    }
  }
  const phones = await realPhones(ctx, listed);
  const members: Member[] = [];
  listed.forEach((m, i) => {
    const phone = phones[i]!;
    if (phone.length >= 8) return members.push({ ...m, phone, key: last8(phone), hidden: false });
    const lid = digits(m.lid ?? m.jid);
    if (lid.length >= 8) members.push({ ...m, phone: '', key: `lid:${lid}`, hidden: true });
  });
  return { members, error: members.length ? undefined : error ?? 'a lista do grupo veio sem ninguém' };
}

/** Primeira segunda, 12h, em que alguém pode ser avisado (7 dias depois de ligar). */
export function firstCheck(since: Date, zone: string): Date {
  let d = local(since, zone).plus({ days: INACTIVE_DAYS }).set({ hour: 12, minute: 0, second: 0, millisecond: 0 });
  if (d.toMillis() < since.getTime() + INACTIVE_DAYS * DAY) d = d.plus({ days: 1 });
  while (d.weekday !== 1) d = d.plus({ days: 1 });
  return d.toJSDate();
}

const dayMonth = (d: Date, zone: string) => local(d, zone).toFormat('dd/MM');

async function toggle(ctx: BotContext, msg: InboundMessage, on: boolean): Promise<void> {
  if (!(await ctx.isAdmin(msg.senderPhone))) return ctx.reply(adminOnly('ligar ou desligar o aviso de sumidos'));
  const s = await settings(ctx);
  if (!on) {
    await setSetting(ctx, { ban: false });
    await ctx.sql`update member_activity set warnings = 0, last_warned_at = null where bot_id = ${ctx.bot.id}`;
    return ctx.reply('🔕 Aviso de sumidos desligado e avisos zerados. Para voltar: #ativarBAN');
  }
  // Conta os 7 dias a partir de agora, para ninguém ser avisado pelo que aconteceu antes de ligar.
  if (s.ban !== true) {
    await setSetting(ctx, { ban: true, ban_desde: ctx.now().toISOString() });
    // já anota quem está no grupo, para quem nunca fala também ser contado desde agora
    const { members } = await resolveMembers(ctx);
    await track(ctx, members, ctx.now());
  }
  const since = typeof s.ban_desde === 'string' && s.ban === true ? new Date(s.ban_desde) : ctx.now();
  await ctx.reply(
    `👀 Aviso de sumidos ligado! Toda segunda, ao meio-dia, marco quem está há mais de ${INACTIVE_DAYS} dias sem mandar nada no grupo. Os dias contam a partir de quando liguei, então o primeiro aviso pode sair na segunda ${dayMonth(firstCheck(since, ctx.timezone), ctx.timezone)}. Quem continuar sumido depois do ${MAX_WARNINGS}º aviso sai do grupo. Basta uma mensagem para zerar os avisos. Admins veem a lista de agora com #sumidos. Para desligar: #desativarBAN`,
  );
}

export function mentionText(m: GroupMember, name: string, canMention: boolean): string {
  // A AvisaAPI só marca pelo telefone (pelo LID não pega).
  if (canMention) return `@${digits(m.phone)}${name ? ` (*${name}*)` : ''}`;
  return name ? `*${name}* (${prettyPhone(m.phone)})` : prettyPhone(m.phone);
}

interface Candidate {
  m: Member;
  r: Row;
  label: string;
  days: number;
}

/** Quem está sumido agora (sem mudar nada). Não entram: o bot, admins do grupo, admins do bot e quem foi avisado há menos de 6 dias. */
async function findInactive(ctx: BotContext, members: Member[], since: Date, now: Date) {
  const [conn] = await ctx.sql<{ own_phone: string | null }[]>`select own_phone from wa_connections where id = ${ctx.bot.connectionId}`;
  const botAdmins = (await ctx.sql<{ phone: string }[]>`select phone from bot_admins where bot_id = ${ctx.bot.id}`).map((a) => a.phone);
  const rows = new Map(
    (await ctx.sql<Row[]>`select member_key, tracked_since, last_seen_at, warnings, last_warned_at from member_activity where bot_id = ${ctx.bot.id}`).map(
      (r) => [r.member_key, r],
    ),
  );
  const canMention = typeof ctx.wa.sendTextMentions === 'function';
  const list: Candidate[] = [];
  let hidden = 0;
  for (const m of members) {
    if (m.admin || (m.phone && conn?.own_phone && samePhone(conn.own_phone, m.phone)) || (m.phone && botAdmins.some((a) => samePhone(a, m.phone)))) continue;
    const r = rows.get(m.key);
    if (!r) continue;
    const lastActive = Math.max((r.last_seen_at ?? r.tracked_since).getTime(), since.getTime());
    if (now.getTime() - lastActive < INACTIVE_DAYS * DAY) continue;
    if (r.last_warned_at && now.getTime() - r.last_warned_at.getTime() < 6 * DAY) continue; // já avisado nesta semana
    const days = Math.floor((now.getTime() - (r.last_seen_at ?? r.tracked_since).getTime()) / DAY);
    if (m.hidden) {
      // o WhatsApp esconde o número: não dá para marcar, então vai pelo nome (se a lista trouxer)
      hidden++;
      list.push({ m, r, label: hiddenLabel(m), days });
      continue;
    }
    const name = (await ctx.nameOf(m.phone)) || m.name || '';
    list.push({ m, r, label: mentionText(m, name, canMention), days });
  }
  return { list, hidden, canMention };
}

/** Como mostrar quem só tem LID: pelo nome do WhatsApp, ou pelo final do código. */
export function hiddenLabel(m: GroupMember): string {
  const tag = `final ${digits(m.lid ?? m.jid).slice(-4)}`;
  return m.name ? `*${m.name}* (número escondido pelo WhatsApp, ${tag})` : `alguém com o número escondido pelo WhatsApp (${tag})`;
}

/** Toda semana: avisa quem está sumido e tira do grupo quem já levou os 3 avisos. */
export interface CheckResult {
  /** Por que não rodou (desligado ou sem lista do grupo). */
  skipped?: string;
  warned: number;
  removed: number;
  manual: number;
}

export async function weeklyCheck(ctx: BotContext): Promise<CheckResult> {
  const s = await settings(ctx);
  if (s.ban !== true) return { skipped: 'desligado', warned: 0, removed: 0, manual: 0 };
  const { members, error } = await resolveMembers(ctx);
  if (error) {
    // falha ao listar: não arrisca avisar ninguém
    ctx.log.warn({ chat: ctx.bot.chatJid, error }, 'sumidos da semana: não rodou');
    return { skipped: error, warned: 0, removed: 0, manual: 0 };
  }

  const now = ctx.now();
  const since = typeof s.ban_desde === 'string' ? new Date(s.ban_desde) : now;
  const keys = members.map((m) => m.key);

  await track(ctx, members, now);
  // quem saiu do grupo é esquecido
  await ctx.sql`delete from member_activity where bot_id = ${ctx.bot.id} and not (member_key = any(${keys}::text[]))`;
  const { list, hidden, canMention } = await findInactive(ctx, members, since, now);
  ctx.log.info(
    { chat: ctx.bot.chatJid, membros: members.length, sem_numero: members.filter((m) => m.hidden).length, sumidos: list.length, sumidos_sem_numero: hidden },
    'sumidos da semana',
  );

  const warned: { m: Member; line: string }[] = [];
  const out: { m: Member; label: string }[] = [];
  for (const { m, r, label, days } of list) {
    if (r.warnings >= MAX_WARNINGS) {
      out.push({ m, label });
      continue;
    }
    const n = r.warnings + 1;
    await ctx.sql`update member_activity set warnings = ${n}, last_warned_at = ${now} where bot_id = ${ctx.bot.id} and member_key = ${r.member_key}`;
    const when = r.last_seen_at ? `${days} dias sem interagir` : 'nenhuma mensagem desde que comecei a acompanhar';
    warned.push({ m, line: `• ${label}: ${when} (aviso ${n} de ${MAX_WARNINGS}${n === MAX_WARNINGS ? ', último' : ''})` });
  }

  // só dá para marcar quem tem telefone; quem só tem LID aparece pelo nome
  const send = (text: string, list: Member[]) => {
    const jids = list.filter((m) => !m.hidden).map((m) => `${digits(m.phone)}@s.whatsapp.net`);
    return canMention && jids.length ? ctx.wa.sendTextMentions!(ctx.bot.chatJid, text, jids) : ctx.reply(text);
  };

  if (warned.length) {
    await send(
      [
        '👀 *Sumidos da semana*',
        `Estas pessoas estão há mais de ${INACTIVE_DAYS} dias sem mandar nada no grupo:`,
        '',
        ...warned.map((w) => w.line),
        '',
        `Uma mensagem já zera os avisos. Quem continuar sumido depois do ${MAX_WARNINGS}º aviso sai do grupo.`,
      ].join('\n'),
      warned.map((w) => w.m),
    );
  }

  const removed: string[] = [];
  const manual: { m: Member; label: string }[] = [];
  for (const o of out) {
    try {
      if (!ctx.wa.removeParticipant) throw new Error('provedor não remove participantes');
      await ctx.wa.removeParticipant(ctx.bot.chatJid, o.m.jid);
      await ctx.sql`delete from member_activity where bot_id = ${ctx.bot.id} and member_key = ${o.m.key}`;
      removed.push(o.label);
    } catch (err) {
      ctx.log.warn({ err: String(err) }, 'não consegui remover membro inativo');
      manual.push(o);
    }
  }
  if (removed.length) await ctx.reply(`🚪 Saíram do grupo depois de ${MAX_WARNINGS} avisos sem interagir:\n${removed.map((r) => `• ${r}`).join('\n')}`);
  if (manual.length) {
    await send(
      `🛡️ Admins: ${manual.length > 1 ? 'estas pessoas completaram' : 'esta pessoa completou'} ${MAX_WARNINGS} avisos sem interagir e ${manual.length > 1 ? 'devem' : 'deve'} sair do grupo. Não consegui remover sozinho (o número do bot precisa ser admin do grupo), então removam, por favor:\n${manual.map((o) => `• ${o.label}`).join('\n')}${
        manual.some((o) => o.m.hidden) ? '\n\nQuem está com o número escondido não dá para marcar: procurem pelo nome nos dados do grupo.' : ''
      }`,
      manual.map((o) => o.m),
    );
  }
  return { warned: warned.length, removed: removed.length, manual: manual.length };
}

/** #carrodoban (admins): roda agora a verificação de segunda, avisando e removendo de verdade. */
async function runNow(ctx: BotContext, msg: InboundMessage): Promise<void> {
  if (!(await ctx.isAdmin(msg.senderPhone))) return ctx.reply(adminOnly('chamar o carro do ban'));
  const r = await weeklyCheck(ctx);
  if (r.skipped === 'desligado') return ctx.reply('🚓 O aviso de sumidos está desligado. Ligue com #ativarBAN e depois chame o #carrodoban.');
  if (r.skipped) return ctx.reply(`🚓 Não consegui rodar: ${r.skipped}. Sem a lista do grupo eu não aviso ninguém.`);
  if (!r.warned && !r.removed && !r.manual)
    return ctx.reply(
      `🚓 Carro do ban passou e não achou ninguém: ninguém está há mais de ${INACTIVE_DAYS} dias sem falar (ou já foi avisado nos últimos 6 dias). Veja a situação com #sumidos.`,
    );
}

/** #sumidos (admins): mostra como está o aviso e quem seria avisado agora, sem avisar ninguém. */
async function preview(ctx: BotContext, msg: InboundMessage): Promise<void> {
  if (!(await ctx.isAdmin(msg.senderPhone))) return ctx.reply(adminOnly('ver a lista de sumidos'));
  const s = await settings(ctx);
  const now = ctx.now();
  const on = s.ban === true;
  const since = on && typeof s.ban_desde === 'string' ? new Date(s.ban_desde) : now;
  const { members, error } = await resolveMembers(ctx);
  const lines = [
    '👀 *Aviso de sumidos*',
    on
      ? `Ligado desde ${dayMonth(since, ctx.timezone)}. Primeiro aviso possível: segunda ${dayMonth(firstCheck(since, ctx.timezone), ctx.timezone)}, ao meio-dia.`
      : 'Desligado. Para ligar: #ativarBAN',
  ];
  if (error) {
    lines.push('', `⚠️ Não consegui ver quem está no grupo: ${error}. Sem essa lista eu não aviso ninguém.`);
    return ctx.reply(lines.join('\n'));
  }
  await track(ctx, members, now);
  const { list, hidden } = await findInactive(ctx, members, since, now);
  const noPhone = members.filter((m) => m.hidden).length;
  lines.push(`Vejo ${members.length} pessoas no grupo${noPhone ? ` (${noPhone} com o número escondido pelo WhatsApp: aparecem pelo nome, sem marcar)` : ''}.`);
  if (!on) return ctx.reply(lines.join('\n'));
  lines.push('');
  if (!list.length) lines.push(`Hoje ninguém seria avisado (ninguém com mais de ${INACTIVE_DAYS} dias sem falar desde que liguei).`);
  else {
    lines.push(`Se a verificação fosse agora, ${list.length > 1 ? `estas ${list.length} pessoas seriam avisadas` : 'esta pessoa seria avisada'}:`);
    for (const c of list) {
      const when = c.r.last_seen_at ? `${c.days} dias sem interagir` : 'nunca falou desde que comecei a acompanhar';
      lines.push(`• ${c.label}: ${when}, ${c.r.warnings} de ${MAX_WARNINGS} avisos${c.r.warnings >= MAX_WARNINGS ? ' (sairia do grupo)' : ''}`);
    }
  }
  if (hidden) lines.push('', 'Quem está com o número escondido pelo WhatsApp aparece pelo nome, sem marcar. Se eu não conseguir remover, peço para os admins.');
  // mostra os nomes sem marcar ninguém
  await ctx.reply(lines.join('\n').replace(/@(\d{8,})/g, (_, p: string) => prettyPhone(p)));
}

/** Aviso de sumidos: #ativarBAN / #desativarBAN. Função do núcleo. Também anota quem fala no grupo. */
export const inativos: BotModule = {
  id: 'inativos',
  jobs: [{ name: 'sumidos-da-semana', cron: '0 12 * * 1', run: async (ctx) => void (await weeklyCheck(ctx)) }],
  async handle(ctx, msg) {
    if (msg.type === 'join') return false;
    await seen(ctx, msg);
    if (!msg.senderPhone) return false;
    if (msg.type !== 'text') return false;
    if (/^[#!]carro\s*do\s*ban(?![\p{L}\p{N}])/iu.test(msg.text.trim())) {
      await runNow(ctx, msg);
      return true;
    }
    if (/^[#!]sumidos(?![\p{L}\p{N}])/iu.test(msg.text.trim())) {
      await preview(ctx, msg);
      return true;
    }
    const m = /^[#!](ativar|desativar)\s*ban(?![\p{L}\p{N}])/iu.exec(msg.text.trim());
    if (!m) return false;
    await toggle(ctx, msg, m[1]!.toLowerCase() === 'ativar');
    return true;
  },
};
