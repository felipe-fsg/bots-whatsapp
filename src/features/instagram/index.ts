import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { digits } from '../../core/phone.js';
import { prettyPhone } from '../boasvindas/index.js';

/**
 * "@fulano", "fulano", "instagram.com/fulano/?hl=pt" ou "https://www.instagram.com/fulano" -> "fulano".
 * Devolve '' se não parecer um usuário do Instagram (letras, números, ponto e _; até 30).
 */
export function parseHandle(raw: string): string {
  let s = raw.trim().split(/\s+/)[0] ?? '';
  const url = /(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/([^/?#\s]+)/i.exec(s);
  if (url) s = url[1]!;
  s = s.replace(/^@+/, '').replace(/[/.,;!]+$/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(s) && !/^\.|\.$|\.\./.test(s) ? s : '';
}

async function save(ctx: BotContext, msg: InboundMessage, arg: string): Promise<void> {
  const phone = digits(msg.senderPhone);
  if (!phone) return ctx.reply('📸 Não consegui identificar seu número. Tente de novo em instantes.');
  if (!arg.trim()) {
    const [row] = await ctx.sql<{ handle: string }[]>`select handle from member_instagram where bot_id = ${ctx.bot.id} and phone = ${phone}`;
    return ctx.reply(
      row
        ? `📸 Seu Instagram na lista: @${row.handle}\nPara trocar: #insta @novo. Para tirar: #removeinsta`
        : '📸 Mande #insta e o seu @ do Instagram. Ex.: #insta @fulano',
    );
  }
  const handle = parseHandle(arg);
  if (!handle) return ctx.reply('📸 Não entendi esse Instagram. Mande só o @ ou o link do perfil. Ex.: #insta @fulano');
  await ctx.sql`
    insert into member_instagram (bot_id, phone, handle) values (${ctx.bot.id}, ${phone}, ${handle})
    on conflict (bot_id, phone) do update set handle = excluded.handle, updated_at = now()`;
  const name = (await ctx.nameOf(phone)) || msg.pushName || prettyPhone(phone);
  await ctx.reply(`📸 Anotado! *${name}*: @${handle}\nVeja todos com #listainsta`);
}

async function remove(ctx: BotContext, msg: InboundMessage): Promise<void> {
  const phone = digits(msg.senderPhone);
  const gone = phone
    ? await ctx.sql`delete from member_instagram where bot_id = ${ctx.bot.id} and phone = ${phone} returning phone`
    : [];
  await ctx.reply(gone.length ? '📸 Pronto, seu Instagram saiu da lista.' : '📸 Seu Instagram não estava na lista.');
}

async function list(ctx: BotContext): Promise<void> {
  const rows = await ctx.sql<{ phone: string; handle: string }[]>`
    select phone, handle from member_instagram where bot_id = ${ctx.bot.id}`;
  if (!rows.length) return ctx.reply('📸 Ninguém colocou o Instagram ainda. Seja o primeiro: #insta @seuusuario');
  const items = await Promise.all(
    rows.map(async (r) => ({ name: (await ctx.nameOf(r.phone)) || prettyPhone(r.phone), handle: r.handle })),
  );
  items.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  await ctx.reply(
    [`📸 *Instagram da galera* (${items.length})`, '', ...items.map((i) => `• ${i.name}: instagram.com/${i.handle}`), '', 'Coloque o seu com #insta @usuario'].join(
      '\n',
    ),
  );
}

/** #insta @usuario, #removeinsta e #listainsta. Só grupos sociais. */
export const instagram: BotModule = {
  id: 'instagram',
  async handle(ctx, msg) {
    if (msg.type !== 'text') return false;
    const m = /^[#!](insta(?:gram)?|remove\s?insta(?:gram)?|lista\s?insta(?:gram)?)(?![\p{L}\p{N}])\s*([\s\S]*)$/iu.exec(msg.text.trim());
    if (!m) return false;
    const cmd = m[1]!.toLowerCase().replace(/\s/g, '').replace('instagram', 'insta');
    if (cmd === 'removeinsta') await remove(ctx, msg);
    else if (cmd === 'listainsta') await list(ctx);
    else await save(ctx, msg, m[2] ?? '');
    return true;
  },
};
