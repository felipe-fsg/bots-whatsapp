import type { BotContext, BotModule, GroupMember, InboundMessage } from '../../core/types.js';
import { digits, samePhone } from '../../core/phone.js';
import { prettyPhone } from '../boasvindas/index.js';

const MAX = 200;
/** Marcador que a IA põe no lugar da pessoa sorteada; o bot troca pelo @ de verdade. */
const SLOT = '[SORTEADO]';

/** Pedido à IA: transformar a pergunta em afirmação sobre a pessoa sorteada. */
export function quemPrompt(question: string, asker: string): string {
  return [
    `${asker} mandou no grupo a pergunta: "#quem ${question}"`,
    'O bot sorteou uma pessoa do grupo como resposta.',
    `Reescreva a pergunta como uma frase afirmativa dizendo que a pessoa sorteada vai fazer aquilo. Use exatamente ${SLOT} no lugar da pessoa sorteada, no começo da frase.`,
    `Quem perguntou é ${asker}: troque "mim", "me", "comigo", "eu", "meu" etc. pelo nome ${asker} (ex.: "pra mim" vira "para o ${asker}" ou "para a ${asker}").`,
    `Exemplo: "vai mandar um ifood pra mim?" vira "${SLOT} vai mandar um ifood para o ${asker}."`,
    'Responda só com a frase, em uma linha, sem aspas e sem explicação. Pode terminar com um emoji que combine. Não acrescente nada ofensivo ou de cunho sexual.',
  ].join('\n');
}

/** Sem IA: troca as palavras de quem perguntou e tira o "?". */
export function quemFallback(question: string, asker: string): string {
  const q = question
    .replace(/[?!.\s]+$/u, '')
    .replace(/\b(pra|para) mim\b/giu, `para ${asker}`)
    .replace(/\bcomigo\b/giu, `com ${asker}`)
    .replace(/\bmim\b/giu, asker);
  return `${SLOT} ${q}.`;
}

function jidOf(m: GroupMember): string {
  return digits(m.phone).length >= 8 ? `${digits(m.phone)}@s.whatsapp.net` : m.jid;
}

async function draw(ctx: BotContext, msg: InboundMessage, question: string): Promise<void> {
  const members = await ctx.wa.listGroupMembers(ctx.bot.chatJid).catch((err) => {
    ctx.log.warn({ err: String(err) }, 'não consegui listar o grupo no #quem');
    return [] as GroupMember[];
  });
  const [conn] = await ctx.sql<{ own_phone: string | null }[]>`select own_phone from wa_connections where id = ${ctx.bot.connectionId}`;
  const all = members.filter((m) => jidOf(m) && !(conn?.own_phone && samePhone(conn.own_phone, m.phone)));
  // Quem perguntou não é sorteado (a não ser que esteja sozinho com o bot).
  const others = all.filter((m) => !(msg.senderPhone && samePhone(msg.senderPhone, m.phone)));
  const pool = others.length ? others : all;
  if (!pool.length) return ctx.reply('🎲 Não consegui ver quem está no grupo agora. Tente de novo daqui a pouco.');
  const chosen = pool[Math.floor(Math.random() * pool.length)]!;

  const asker = (await ctx.nameOf(msg.senderPhone)) || msg.pushName || 'quem perguntou';
  let sentence = '';
  try {
    sentence = (await ctx.ai.text(quemPrompt(question, asker), { system: (await ctx.mascot()).persona, temperature: 0.9 }))
      .replace(/\*\*/g, '*')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? '';
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou no #quem');
  }
  if (!sentence.includes(SLOT)) sentence = quemFallback(question, asker);

  const jid = jidOf(chosen);
  if (typeof ctx.wa.sendTextMentions === 'function') {
    try {
      return await ctx.wa.sendTextMentions(ctx.bot.chatJid, `🎲 ${sentence.replace(SLOT, `@${jid.split('@')[0]}`)}`, [jid]);
    } catch (err) {
      ctx.log.warn({ err: String(err) }, 'não consegui marcar no #quem; mandando sem marcar');
    }
  }
  const name = (await ctx.nameOf(chosen.phone)) || prettyPhone(chosen.phone);
  await ctx.reply(`🎲 ${sentence.replace(SLOT, `*${name}*`)}`);
}

/** #quem + pergunta: sorteia alguém do grupo e marca a pessoa. Só grupos sociais. */
export const quem: BotModule = {
  id: 'quem',
  async handle(ctx, msg) {
    if (msg.type !== 'text') return false;
    const m = /^[#!]quem(?![\p{L}\p{N}])\s*([\s\S]*)$/iu.exec(msg.text.trim());
    if (!m) return false;
    const question = m[1]!.replace(/\s+/g, ' ').trim();
    if (!question) {
      await ctx.reply('🎲 Mande #quem e a pergunta, que eu sorteio alguém do grupo. Ex.: #quem vai mandar um ifood pra mim?');
      return true;
    }
    if (question.length > MAX) {
      await ctx.reply(`🎲 Pergunta muito longa. Resume em até ${MAX} letras.`);
      return true;
    }
    await draw(ctx, msg, question);
    return true;
  },
};
