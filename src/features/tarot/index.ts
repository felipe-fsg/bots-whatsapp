import { randomInt } from 'node:crypto';
import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { digits, last8 } from '../../core/phone.js';
import { local, localDay } from '../../core/time.js';

const MAX = 200;

/** Os 22 Arcanos Maiores, com uma ideia curta para cada lado da carta. */
export const ARCANOS: { name: string; up: string; rev: string }[] = [
  { name: 'O Louco', up: 'começos, aventura, coragem de pular', rev: 'imprudência, hesitação' },
  { name: 'O Mago', up: 'iniciativa, talento, fazer acontecer', rev: 'truques, energia desperdiçada' },
  { name: 'A Sacerdotisa', up: 'intuição, segredos, sabedoria interior', rev: 'segredos guardados demais, desconexão' },
  { name: 'A Imperatriz', up: 'abundância, cuidado, criatividade', rev: 'bloqueio criativo, descuido consigo' },
  { name: 'O Imperador', up: 'estrutura, liderança, disciplina', rev: 'teimosia, controle demais' },
  { name: 'O Hierofante', up: 'tradição, aprendizado, conselho', rev: 'quebrar regras, caminho próprio' },
  { name: 'Os Enamorados', up: 'escolhas do coração, união', rev: 'indecisão, desencontro' },
  { name: 'O Carro', up: 'vitória, determinação, movimento', rev: 'falta de direção, freio de mão puxado' },
  { name: 'A Força', up: 'coragem, paciência, força interior', rev: 'insegurança, impaciência' },
  { name: 'O Eremita', up: 'introspecção, pausa, busca interior', rev: 'isolamento, fugir da galera' },
  { name: 'A Roda da Fortuna', up: 'virada de sorte, ciclos, destino', rev: 'maré baixa, resistência à mudança' },
  { name: 'A Justiça', up: 'equilíbrio, verdade, decisões justas', rev: 'injustiça, desequilíbrio' },
  { name: 'O Enforcado', up: 'pausa, novo ponto de vista, entrega', rev: 'enrolação, sacrifício à toa' },
  { name: 'A Morte', up: 'fim de ciclo, transformação, recomeço', rev: 'apego, medo de mudar' },
  { name: 'A Temperança', up: 'equilíbrio, moderação, paciência', rev: 'exagero, pressa' },
  { name: 'O Diabo', up: 'tentações, vícios, desejo', rev: 'libertação, largar o que prende' },
  { name: 'A Torre', up: 'mudança repentina, surpresa, revelação', rev: 'adiar o inevitável, susto evitado' },
  { name: 'A Estrela', up: 'esperança, inspiração, fé', rev: 'desânimo, falta de fé' },
  { name: 'A Lua', up: 'mistério, imaginação, ilusões', rev: 'confusão se desfazendo, verdade aparecendo' },
  { name: 'O Sol', up: 'alegria, sucesso, energia lá em cima', rev: 'alegria atrasada, nuvem passageira' },
  { name: 'O Julgamento', up: 'despertar, segunda chance, chamado', rev: 'autocrítica, dúvida' },
  { name: 'O Mundo', up: 'conquista, ciclo completo, celebração', rev: 'quase lá, falta um passo' },
];

export const POSICOES = ['Passado', 'Presente', 'Futuro'] as const;

export interface CartaTirada {
  name: string;
  reversed: boolean;
  meaning: string;
}

/** Embaralha de verdade: 3 cartas diferentes, cada uma normal ou invertida. */
export function tirarCartas(rand: (n: number) => number = randomInt): CartaTirada[] {
  const deck = ARCANOS.map((_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck.slice(0, POSICOES.length).map((i) => {
    const c = ARCANOS[i]!;
    const reversed = rand(2) === 1;
    return { name: c.name, reversed, meaning: reversed ? c.rev : c.up };
  });
}

const label = (c: CartaTirada) => `${c.name}${c.reversed ? ' (invertida)' : ''}`;

export function tarotPrompt(name: string, question: string, cards: CartaTirada[], hour: number): string {
  return [
    `${name} pediu uma leitura de tarot no grupo, agora às ${hour}h.`,
    question ? `Pergunta: "${question}"` : 'Sem pergunta: é uma leitura geral do momento da pessoa.',
    'Cartas sorteadas (já foram tiradas, não troque nenhuma):',
    ...cards.map((c, i) => `${POSICOES[i]}: ${label(c)} - ${c.meaning}`),
    'Escreva a leitura como uma cartomante divertida, do seu jeito de personagem: uma frase curta para cada carta (Passado, Presente, Futuro) ligando ao tema da pergunta, e no fim uma conclusão de uma linha.',
    'Fale com a pessoa pelo nome. Tom leve e engraçado, sempre positivo no fim. No máximo 8 linhas.',
    'Não faça previsões de doença, morte, gravidez, dinheiro garantido ou términos; não dê conselho médico, financeiro ou jurídico. Nada ofensivo ou de cunho sexual.',
    'Não repita a lista das cartas no começo (o bot já mostra) e não escreva aviso de que é brincadeira (o bot já põe).',
  ].join('\n');
}

/** Sem IA: leitura montada com os significados das cartas. */
export function tarotFallback(name: string, cards: CartaTirada[]): string {
  return [
    ...cards.map((c, i) => `${POSICOES[i]}: ${c.meaning}.`),
    `✨ ${name}, o universo está do seu lado. Bora!`,
  ].join('\n');
}

async function ler(ctx: BotContext, msg: InboundMessage, question: string): Promise<void> {
  const phone = digits(msg.senderPhone);
  const name = (await ctx.nameOf(msg.senderPhone)) || msg.pushName || 'consulente';
  const day = localDay(msg.timestamp, ctx.timezone);
  const admin = phone.length >= 8 && (await ctx.isAdmin(phone));
  const cards = tirarCartas();

  if (phone.length >= 8 && !admin) {
    const saved = await ctx.sql`
      insert into tarot_readings (bot_id, member_key, day, cards)
      values (${ctx.bot.id}, ${last8(phone)}, ${day}, ${cards.map(label).join(' | ')})
      on conflict do nothing returning 1`;
    if (!saved.length) {
      await ctx.reply(`🔮 ${name}, as cartas já falaram com você hoje. Elas precisam descansar! Volte amanhã para uma nova leitura.`);
      return;
    }
  }

  let reading = '';
  try {
    reading = (
      await ctx.ai.text(tarotPrompt(name, question, cards, local(msg.timestamp, ctx.timezone).hour), {
        system: (await ctx.mascot()).persona,
        temperature: 1,
      })
    )
      .replace(/\*\*/g, '*')
      .trim();
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou no #tarot');
  }
  if (!reading) reading = tarotFallback(name, cards);

  const head = [
    '🔮 *Leitura de tarot*',
    question ? `Pergunta: _${question}_` : '',
    '',
    ...cards.map((c, i) => `🃏 *${POSICOES[i]}:* ${label(c)}`),
  ].filter((l, i) => i !== 1 || l);
  const footer = '_🎭 Só brincadeira, viu? O futuro quem faz é você._';

  if (phone.length >= 8 && typeof ctx.wa.sendTextMentions === 'function') {
    try {
      // Marca pelo telefone (a AvisaAPI só marca assim) e põe o nome junto, como no #quem.
      const tag = `🔮 @${phone}${name ? ` (*${name}*)` : ''}, embaralhei as cartas para você!`;
      const text = [tag, '', ...head, '', reading, '', footer].join('\n');
      return await ctx.wa.sendTextMentions(ctx.bot.chatJid, text, [`${phone}@s.whatsapp.net`]);
    } catch (err) {
      ctx.log.warn({ err: String(err) }, 'não consegui marcar no #tarot; mandando sem marcar');
    }
  }
  await ctx.reply([`🔮 *${name}*, embaralhei as cartas para você!`, '', ...head, '', reading, '', footer].join('\n'));
}

/** #tarot [pergunta]: tira 3 cartas de verdade e a IA lê na voz do mascote. Só grupos sociais. */
export const tarot: BotModule = {
  id: 'tarot',
  async handle(ctx, msg) {
    if (msg.type !== 'text') return false;
    const m = /^[#!]tar[oô]t?(?![\p{L}\p{N}])\s*([\s\S]*)$/iu.exec(msg.text.trim());
    if (!m) return false;
    const question = m[1]!.replace(/\s+/g, ' ').trim();
    if (question.length > MAX) {
      await ctx.reply(`🔮 Pergunta muito longa. Resume em até ${MAX} letras.`);
      return true;
    }
    await ler(ctx, msg, question);
    return true;
  },
};
