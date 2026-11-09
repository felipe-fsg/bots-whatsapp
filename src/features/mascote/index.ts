import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { normalize } from '../agenda/parse.js';

const RULES =
  'Regras fixas: escreva em português do Brasil, em mensagens curtas. Não copie falas longas de filmes, livros, séries ou desenhos. Use somente nomes e números dos dados fornecidos, nunca invente. Elogie pessoas pelo nome, mas nunca critique, exponha ou cobre alguém pelo nome. Formatação de WhatsApp: *negrito* com um asterisco só, sem títulos com # e sem links. Mantenha o tom adequado a um grupo de amigos.';

export function personaPrompt(character: string, groupName: string): string {
  return `Vamos dar vida a "${character}" como mascote de um grupo de WhatsApp chamado "${groupName}". Escreva as instruções de personalidade que a IA vai seguir para interpretar esse personagem.

Um parágrafo só, na segunda pessoa, começando com "Você é ${character}": quem é o personagem, jeito de falar, expressões e bordões típicos (curtos), como chama as pessoas do grupo, humor e tom, e 3 a 5 emojis que combinam com ele. Se o personagem tiver lado agressivo, adulto ou ofensivo, suavize para um grupo de amigos.

Responda só com o parágrafo, sem título.`;
}

/** Remove o que vier da IA antes de "Você é" e junta as regras fixas. */
export function buildPersona(raw: string, character: string): string {
  const text = raw.replace(/\*\*/g, '').trim();
  const start = text.search(/voc[eê] [eé]/i);
  return `${start > 0 ? text.slice(start) : text || `Você é ${character}, mascote do grupo.`}\n\n${RULES}`;
}

/** A mensagem começa chamando o mascote? ("Splinter, ..." ou "Mestre Splinter ...") */
export function callsMascot(text: string, name: string): boolean {
  if (/^[#!?]/.test(text.trim())) return false;
  const t = normalize(text);
  const full = normalize(name);
  const last = full.split(' ').pop() ?? '';
  return [full, last].some((n) => n.length >= 3 && (t === n || t.startsWith(`${n} `)));
}

async function show(ctx: BotContext): Promise<void> {
  const m = await ctx.mascot();
  await ctx.reply(`🎭 O mascote do grupo é *${m.name}*. Fale com ele começando a mensagem pelo nome. Admins trocam com #mascote Nome do personagem (ou #mascote padrão para voltar ao original).`);
}

async function change(ctx: BotContext, msg: InboundMessage, character: string): Promise<void> {
  if (!(await ctx.isAdmin(msg.senderPhone))) {
    await ctx.reply('🛡️ Só os admins podem trocar o mascote do grupo.');
    return;
  }
  if (/^padr[aã]o$/i.test(character)) {
    await ctx.sql`delete from bot_mascots where bot_id = ${ctx.bot.id}`;
    const m = await ctx.mascot();
    await ctx.reply(`🎭 Voltamos ao mascote original: *${m.name}*.`);
    return;
  }
  let persona: string;
  try {
    persona = buildPersona(await ctx.ai.text(personaPrompt(character, ctx.bot.name), { temperature: 0.8 }), character);
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou ao criar o mascote');
    await ctx.reply('😕 Não consegui criar esse mascote agora. Tente de novo em alguns minutos.');
    return;
  }
  await ctx.sql`
    insert into bot_mascots (bot_id, name, persona, set_by) values (${ctx.bot.id}, ${character}, ${persona}, ${msg.senderPhone})
    on conflict (bot_id) do update set name = excluded.name, persona = excluded.persona, set_by = excluded.set_by, updated_at = now()`;
  let hello = '';
  try {
    hello = await ctx.ai.text(
      'Você acabou de virar o mascote deste grupo. Apresente-se em 2 a 3 linhas, do seu jeito, e diga que é só começar a mensagem com o seu nome para falar com você.',
      { system: persona, temperature: 1 },
    );
  } catch {
    /* a apresentação é opcional */
  }
  await ctx.reply(`🎭 Novo mascote: *${character}*\n\n${hello.replace(/\*\*/g, '*').trim() || `Olá, turma! Agora quem fala aqui sou eu, ${character}.`}`);
}

async function chat(ctx: BotContext, msg: InboundMessage, persona: string): Promise<void> {
  const who = (await ctx.nameOf(msg.senderPhone)) || msg.pushName || 'alguém';
  let text = '';
  try {
    text = await ctx.ai.text(
      `${who} falou com você no grupo: "${msg.text.slice(0, 500)}"\n\nResponda como o personagem, em 1 a 4 linhas, chamando ${who} pelo nome. Se for uma pergunta que você não sabe responder com certeza, diga isso do seu jeito.`,
      { system: persona, temperature: 0.9 },
    );
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou na conversa com o mascote');
  }
  if (text.trim()) await ctx.reply(text.replace(/\*\*/g, '*').trim());
}

/** Mascote da turma: função do núcleo, vale para todos os bots. */
export const mascote: BotModule = {
  id: 'mascote',
  async handle(ctx, msg) {
    if (msg.type !== 'text') return false;
    const t = msg.text.trim();
    if (/^#mascote\b/i.test(t)) {
      const character = t.replace(/^#mascote/i, '').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 60);
      if (character) await change(ctx, msg, character);
      else await show(ctx);
      return true;
    }
    const m = await ctx.mascot();
    if (callsMascot(t, m.name)) {
      await chat(ctx, msg, m.persona);
      return true;
    }
    return false;
  },
};
