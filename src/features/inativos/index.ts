import type { BotContext, BotModule, GroupMember, InboundMessage } from '../../core/types.js';
import { digits, last8, samePhone } from '../../core/phone.js';
import { prettyPhone } from '../boasvindas/index.js';
import { realPhones } from '../../core/members.js';
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
  if (phone.length < 8) return;
  await ctx.sql`
    insert into member_activity (bot_id, member_key, phone, tracked_since, last_seen_at)
    values (${ctx.bot.id}, ${last8(phone)}, ${phone}, ${msg.timestamp}, ${msg.timestamp})
    on conflict (bot_id, member_key) do update set
      phone = excluded.phone, warnings = 0,
      last_seen_at = greatest(member_activity.last_seen_at, excluded.last_seen_at)`;
}

/** Começa a acompanhar quem ainda não tem registro (quem já tem fica como está). */
async function track(ctx: BotContext, members: GroupMember[], now: Date): Promise<void> {
  for (const m of members) {
    if (digits(m.phone).length < 8) continue;
    await ctx.sql`
      insert into member_activity (bot_id, member_key, phone, tracked_since) values (${ctx.bot.id}, ${last8(m.phone)}, ${digits(m.phone)}, ${now})
      on conflict (bot_id, member_key) do nothing`;
  }
}

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
    const members = await ctx.wa.listGroupMembers(ctx.bot.chatJid).catch(() => []);
    await track(ctx, members, ctx.now());
  }
  await ctx.reply(
    `👀 Aviso de sumidos ligado! Toda segunda, ao meio-dia, marco quem está há mais de ${INACTIVE_DAYS} dias sem mandar nada no grupo. Quem continuar sumido depois do ${MAX_WARNINGS}º aviso sai do grupo. Basta uma mensagem para zerar os avisos. Para desligar: #desativarBAN`,
  );
}

export function mentionText(m: GroupMember, name: string, canMention: boolean): string {
  // A AvisaAPI só marca pelo telefone (pelo LID não pega).
  if (canMention) return `@${digits(m.phone)}${name ? ` (*${name}*)` : ''}`;
  return name ? `*${name}* (${prettyPhone(m.phone)})` : prettyPhone(m.phone);
}

/** Toda semana: avisa quem está sumido e tira do grupo quem já levou os 3 avisos. */
export async function weeklyCheck(ctx: BotContext): Promise<void> {
  const s = await settings(ctx);
  if (s.ban !== true) return;
  // Telefone de verdade de cada um (quem vem só com LID tem o telefone buscado no que o bot já aprendeu).
  const listed = await ctx.wa.listGroupMembers(ctx.bot.chatJid);
  const phones = await realPhones(ctx, listed);
  const members: GroupMember[] = listed.map((m, i) => ({ ...m, phone: phones[i]! })).filter((m) => m.phone.length >= 8);
  if (!members.length) return; // falha ao listar: não arrisca avisar ninguém

  const now = ctx.now();
  const since = typeof s.ban_desde === 'string' ? new Date(s.ban_desde) : now;
  const [conn] = await ctx.sql<{ own_phone: string | null }[]>`select own_phone from wa_connections where id = ${ctx.bot.connectionId}`;
  const botAdmins = (await ctx.sql<{ phone: string }[]>`select phone from bot_admins where bot_id = ${ctx.bot.id}`).map((a) => a.phone);
  const keys = members.map((m) => last8(m.phone));

  await track(ctx, members, now);
  // quem saiu do grupo é esquecido
  await ctx.sql`delete from member_activity where bot_id = ${ctx.bot.id} and not (member_key = any(${keys}::text[]))`;
  const rows = new Map(
    (await ctx.sql<Row[]>`select member_key, tracked_since, last_seen_at, warnings, last_warned_at from member_activity where bot_id = ${ctx.bot.id}`).map(
      (r) => [r.member_key, r],
    ),
  );

  const canMention = typeof ctx.wa.sendTextMentions === 'function';
  const warned: { m: GroupMember; line: string }[] = [];
  const out: { m: GroupMember; label: string }[] = [];
  for (const m of members) {
    // o próprio bot, admins do grupo e admins do bot nunca entram na lista
    if (m.admin || (conn?.own_phone && samePhone(conn.own_phone, m.phone)) || botAdmins.some((a) => samePhone(a, m.phone))) continue;
    const r = rows.get(last8(m.phone));
    if (!r) continue;
    const lastActive = Math.max((r.last_seen_at ?? r.tracked_since).getTime(), since.getTime());
    if (now.getTime() - lastActive < INACTIVE_DAYS * DAY) continue;
    if (r.last_warned_at && now.getTime() - r.last_warned_at.getTime() < 6 * DAY) continue; // já avisado nesta semana
    const name = await ctx.nameOf(m.phone);
    const label = mentionText(m, name, canMention);
    if (r.warnings >= MAX_WARNINGS) {
      out.push({ m, label });
      continue;
    }
    const n = r.warnings + 1;
    await ctx.sql`update member_activity set warnings = ${n}, last_warned_at = ${now} where bot_id = ${ctx.bot.id} and member_key = ${r.member_key}`;
    const days = Math.floor((now.getTime() - (r.last_seen_at ?? r.tracked_since).getTime()) / DAY);
    const when = r.last_seen_at ? `${days} dias sem interagir` : 'nenhuma mensagem desde que comecei a acompanhar';
    warned.push({ m, line: `• ${label}: ${when} (aviso ${n} de ${MAX_WARNINGS}${n === MAX_WARNINGS ? ', último' : ''})` });
  }

  const send = (text: string, list: GroupMember[]) =>
    canMention && list.length ? ctx.wa.sendTextMentions!(ctx.bot.chatJid, text, list.map((m) => `${digits(m.phone)}@s.whatsapp.net`)) : ctx.reply(text);

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
  const manual: { m: GroupMember; label: string }[] = [];
  for (const o of out) {
    try {
      if (!ctx.wa.removeParticipant) throw new Error('provedor não remove participantes');
      await ctx.wa.removeParticipant(ctx.bot.chatJid, o.m.jid);
      await ctx.sql`delete from member_activity where bot_id = ${ctx.bot.id} and member_key = ${last8(o.m.phone)}`;
      removed.push(o.label);
    } catch (err) {
      ctx.log.warn({ err: String(err) }, 'não consegui remover membro inativo');
      manual.push(o);
    }
  }
  if (removed.length) await ctx.reply(`🚪 Saíram do grupo depois de ${MAX_WARNINGS} avisos sem interagir:\n${removed.map((r) => `• ${r}`).join('\n')}`);
  if (manual.length) {
    await send(
      `🛡️ Admins: ${manual.length > 1 ? 'estas pessoas completaram' : 'esta pessoa completou'} ${MAX_WARNINGS} avisos sem interagir e ${manual.length > 1 ? 'devem' : 'deve'} sair do grupo. Não consegui remover sozinho (o número do bot precisa ser admin do grupo), então removam, por favor:\n${manual.map((o) => `• ${o.label}`).join('\n')}`,
      manual.map((o) => o.m),
    );
  }
}

/** Aviso de sumidos: #ativarBAN / #desativarBAN. Função do núcleo. Também anota quem fala no grupo. */
export const inativos: BotModule = {
  id: 'inativos',
  jobs: [{ name: 'sumidos-da-semana', cron: '0 12 * * 1', run: weeklyCheck }],
  async handle(ctx, msg) {
    if (msg.type === 'join' || !msg.senderPhone) return false;
    await seen(ctx, msg);
    if (msg.type !== 'text') return false;
    const m = /^[#!](ativar|desativar)\s*ban(?![\p{L}\p{N}])/iu.exec(msg.text.trim());
    if (!m) return false;
    await toggle(ctx, msg, m[1]!.toLowerCase() === 'ativar');
    return true;
  },
};
