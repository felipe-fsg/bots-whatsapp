import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { digits, last8, samePhone } from '../../core/phone.js';
import { local } from '../../core/time.js';
import { prettyPhone } from '../boasvindas/index.js';

const MEDALS = ['🥇', '🥈', '🥉'];

/** Soma uma mensagem para quem mandou. */
async function count(ctx: BotContext, msg: InboundMessage): Promise<void> {
  const phone = digits(msg.senderPhone);
  if (phone.length < 8) return;
  await ctx.sql`
    insert into member_message_counts (bot_id, member_key, phone, messages, first_at, last_at)
    values (${ctx.bot.id}, ${last8(phone)}, ${phone}, 1, ${msg.timestamp}, ${msg.timestamp})
    on conflict (bot_id, member_key) do update set
      phone = excluded.phone, messages = member_message_counts.messages + 1,
      first_at = least(member_message_counts.first_at, excluded.first_at),
      last_at = greatest(member_message_counts.last_at, excluded.last_at)`;
}

const plural = (n: number) => `${n} ${n === 1 ? 'mensagem' : 'mensagens'}`;

/** Ranking de quem mais mandou mensagens no grupo. */
export async function ranking(ctx: BotContext): Promise<void> {
  const [conn] = await ctx.sql<{ own_phone: string | null }[]>`select own_phone from wa_connections where id = ${ctx.bot.connectionId}`;
  const rows = (
    await ctx.sql<{ phone: string; messages: number; first_at: Date }[]>`
      select phone, messages, first_at from member_message_counts where bot_id = ${ctx.bot.id} order by messages desc, last_at desc`
  ).filter((r) => !(conn?.own_phone && samePhone(conn.own_phone, r.phone)));
  if (!rows.length) return ctx.reply('💬 Ainda não contei nenhuma mensagem neste grupo. Bora conversar!');

  const total = rows.reduce((s, r) => s + r.messages, 0);
  const since = rows.reduce((d, r) => (r.first_at < d ? r.first_at : d), rows[0]!.first_at);
  const lines: string[] = [];
  let pos = 0;
  let prev = -1;
  for (const [i, r] of rows.entries()) {
    if (r.messages !== prev) pos = i + 1; // empate fica na mesma posição
    prev = r.messages;
    const name = (await ctx.nameOf(r.phone)) || prettyPhone(r.phone);
    const badge = MEDALS[pos - 1] ?? `${pos}º`;
    lines.push(`${badge} ${name}: ${plural(r.messages)}`);
  }
  await ctx.reply(
    [
      '💬 *Ranking de engajamento*',
      `Quem mais mandou mensagens no grupo desde ${local(since, ctx.timezone).toFormat('dd/MM')}:`,
      '',
      ...lines,
      '',
      `Total: ${plural(total)} de ${rows.length} ${rows.length === 1 ? 'pessoa' : 'pessoas'}.`,
    ].join('\n'),
  );
}

/** #engajamento: ranking de mensagens por pessoa. Só grupos sociais. Conta toda mensagem que chega ao bot. */
export const engajamento: BotModule = {
  id: 'engajamento',
  async handle(ctx, msg) {
    if (msg.type === 'join' || !msg.senderPhone || msg.fromMe) return false;
    await count(ctx, msg);
    if (msg.type !== 'text' || !/^[#!]engajamento(?![\p{L}\p{N}])/iu.test(msg.text.trim())) return false;
    await ranking(ctx);
    return true;
  },
};
