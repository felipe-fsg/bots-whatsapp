import type { BotContext, GroupMember } from './types.js';
import { digits, samePhone } from './phone.js';

/**
 * Telefones de verdade de uma lista de membros (só dígitos; vazio se não souber), na mesma ordem.
 * Em grupos novos a AvisaAPI pode mandar só o LID (sem PhoneNumber); aí o "telefone" da lista
 * são os dígitos do LID, que não servem para marcar. Nesse caso usa o telefone que o bot já aprendeu
 * (tabela wa_contacts, preenchida quando a pessoa manda mensagem). Uma consulta só, sem chamar a AvisaAPI.
 */
export async function realPhones(ctx: BotContext, members: GroupMember[]): Promise<string[]> {
  const lidOf = (m: GroupMember) => m.lid ?? (m.jid.endsWith('@lid') ? m.jid : '');
  const lids = members.map(lidOf).filter(Boolean);
  const known = new Map<string, string>();
  if (lids.length) {
    const rows = await ctx.sql<{ lid: string; phone: string }[]>`
      select lid, phone from wa_contacts where connection_id = ${ctx.bot.connectionId} and lid = any(${lids}::text[])`;
    for (const r of rows) if (digits(r.phone) !== digits(r.lid)) known.set(r.lid, digits(r.phone));
  }
  return members.map((m) => {
    const phone = digits(m.phone);
    const lid = lidOf(m);
    if (phone.length >= 8 && !(lid && digits(lid) === phone)) return phone;
    return (lid && known.get(lid)) || '';
  });
}

/** Quem o bot já viu falando no grupo (telefones, sem repetir). */
async function seenPhones(ctx: BotContext): Promise<string[]> {
  const rows = await ctx.sql<{ phone: string }[]>`
    select phone from member_message_counts where bot_id = ${ctx.bot.id}
    union
    select phone from member_activity where bot_id = ${ctx.bot.id}`;
  return rows.map((r) => digits(r.phone)).filter((p) => p.length >= 8);
}

/** Lista do grupo na AvisaAPI (tenta 2 vezes). Se não vier, usa quem o bot já viu falando no grupo. */
export async function groupMembers(ctx: BotContext, label: string): Promise<GroupMember[]> {
  for (let i = 0; i < 2; i++) {
    try {
      const list = await ctx.wa.listGroupMembers(ctx.bot.chatJid);
      if (list.length) return list;
      ctx.log.warn({ chat: ctx.bot.chatJid }, `${label}: a AvisaAPI devolveu o grupo sem membros`);
    } catch (err) {
      ctx.log.warn({ err: String(err) }, `${label}: não consegui listar o grupo`);
    }
  }
  return (await seenPhones(ctx)).map((p) => ({ jid: `${p}@s.whatsapp.net`, phone: p }));
}

/**
 * Membros que dá para marcar: telefone de verdade e jid = telefone@s.whatsapp.net
 * (a AvisaAPI só marca pelo telefone; pelo LID a marcação não pega). Tira o próprio bot e repetidos.
 */
export async function mentionableMembers(ctx: BotContext, label: string): Promise<GroupMember[]> {
  const members = await groupMembers(ctx, label);
  const [conn] = await ctx.sql<{ own_phone: string | null }[]>`select own_phone from wa_connections where id = ${ctx.bot.connectionId}`;
  const phones = await realPhones(ctx, members);
  const out: GroupMember[] = [];
  const seen = new Set<string>();
  const add = (m: GroupMember, phone: string) => {
    if (phone.length < 8 || seen.has(phone.slice(-8))) return;
    if (conn?.own_phone && samePhone(conn.own_phone, phone)) return;
    seen.add(phone.slice(-8));
    out.push({ ...m, phone, jid: `${phone}@s.whatsapp.net` });
  };
  members.forEach((m, i) => add(m, phones[i]!));
  const missing = phones.filter((p) => p.length < 8).length;
  if (missing) {
    // Alguns vieram só com LID e o bot ainda não sabe o telefone: completa com quem já falou no grupo.
    ctx.log.warn({ missing, total: members.length }, `${label}: membros sem telefone conhecido; completando com quem já falou no grupo`);
    for (const p of await seenPhones(ctx)) add({ jid: '', phone: p }, p);
  }
  return out;
}
