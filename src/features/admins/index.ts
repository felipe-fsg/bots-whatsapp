import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { digits, samePhone } from '../../core/phone.js';
import { prettyPhone } from '../boasvindas/index.js';

export const adminOnly = (what: string) => `🛡️ Só os admins podem ${what}.`;

/** Telefones das pessoas marcadas com @ (ou digitadas como número) na mensagem. */
async function targets(ctx: BotContext, msg: InboundMessage, rest: string): Promise<string[]> {
  const phones: string[] = [];
  for (const jid of msg.mentions) {
    const phone = await ctx.contacts.phoneOf(jid, msg.chatJid).catch(() => '');
    if (phone) phones.push(phone);
  }
  if (!phones.length) {
    // sem marcação: aceita o número digitado (ex.: #promover 11 98765-4321)
    const typed = digits(rest);
    if (typed.length >= 10) phones.push(typed.length <= 11 ? `55${typed}` : typed);
  }
  return [...new Set(phones)];
}

async function label(ctx: BotContext, phone: string): Promise<string> {
  const name = await ctx.nameOf(phone);
  return name ? `*${name}*` : prettyPhone(phone);
}

async function promote(ctx: BotContext, msg: InboundMessage, rest: string): Promise<void> {
  const phones = await targets(ctx, msg, rest);
  if (!phones.length) return ctx.reply('🛡️ Marque quem vai virar admin do bot. Ex.: #promover @Fulano');
  const done: string[] = [];
  for (const phone of phones) {
    const name = (await ctx.nameOf(phone)) || null;
    const admins = await ctx.sql<{ phone: string }[]>`select phone from bot_admins where bot_id = ${ctx.bot.id}`;
    if (!admins.some((a) => samePhone(a.phone, phone))) {
      await ctx.sql`insert into bot_admins (bot_id, phone, name) values (${ctx.bot.id}, ${phone}, ${name}) on conflict do nothing`;
    }
    done.push(await label(ctx, phone));
  }
  await ctx.reply(`🛡️ ${done.join(', ')} ${done.length > 1 ? 'agora são admins' : 'agora é admin'} do bot.`);
}

async function demote(ctx: BotContext, msg: InboundMessage, rest: string): Promise<void> {
  const phones = await targets(ctx, msg, rest);
  if (!phones.length) return ctx.reply('🛡️ Marque quem vai deixar de ser admin do bot. Ex.: #demover @Fulano');
  const admins = await ctx.sql<{ phone: string }[]>`select phone from bot_admins where bot_id = ${ctx.bot.id}`;
  const hit = admins.filter((a) => phones.some((p) => samePhone(a.phone, p)));
  if (!hit.length) return ctx.reply('🛡️ Essa pessoa não é admin do bot.');
  if (hit.length >= admins.length) return ctx.reply('🛡️ O bot precisa de pelo menos um admin. Promova outra pessoa antes.');
  for (const a of hit) await ctx.sql`delete from bot_admins where bot_id = ${ctx.bot.id} and phone = ${a.phone}`;
  const names = await Promise.all(hit.map((a) => label(ctx, a.phone)));
  await ctx.reply(`🛡️ ${names.join(', ')} ${names.length > 1 ? 'não são mais admins' : 'não é mais admin'} do bot.`);
}

async function list(ctx: BotContext): Promise<void> {
  const admins = await ctx.sql<{ phone: string; name: string | null }[]>`select phone, name from bot_admins where bot_id = ${ctx.bot.id} order by name`;
  const names = await Promise.all(admins.map(async (a) => (await ctx.nameOf(a.phone)) || a.name || prettyPhone(a.phone)));
  await ctx.reply(`🛡️ *Admins do bot*\n${names.map((n) => `• ${n}`).join('\n') || '• ninguém'}`);
}

/** #promover @pessoa, #demover @pessoa e #admins. Função do núcleo. */
export const admins: BotModule = {
  id: 'admins',
  async handle(ctx, msg) {
    if (msg.type !== 'text') return false;
    const m = /^[#!](promover|demover|admins)(?![\p{L}\p{N}])\s*([\s\S]*)$/iu.exec(msg.text.trim());
    if (!m) return false;
    const cmd = m[1]!.toLowerCase();
    if (cmd === 'admins') {
      await list(ctx);
      return true;
    }
    if (!(await ctx.isAdmin(msg.senderPhone))) {
      await ctx.reply(adminOnly('promover ou demover admins'));
      return true;
    }
    if (cmd === 'promover') await promote(ctx, msg, m[2] ?? '');
    else await demote(ctx, msg, m[2] ?? '');
    return true;
  },
};
