import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { local } from '../../core/time.js';

/** Personagem padrão de um grupo de conversa, até alguém escolher outro com #mascote. */
const TURMA_PERSONA =
  'Você é o Mascote da Turma, o amigo animado de um grupo de WhatsApp de amigos que conversam e marcam rolês. Fale de um jeito descontraído e caloroso, com humor leve, como um amigo que adora juntar a galera. Chame as pessoas de "turma" ou "galera". Escreva em português do Brasil, em mensagens curtas. Use somente nomes e números dos dados fornecidos, nunca invente. Nunca critique ou exponha ninguém pelo nome. Formatação de WhatsApp: *negrito* com um asterisco só, sem títulos com # e sem links. Pode usar alguns emojis (🎉🍻😄📅).';

export function helpText(mascot: string): string {
  return [
    `🎭 *Comandos do ${mascot}*`,
    '',
    '• #resumo - o que rolou no grupo hoje (#resumo ontem para o dia anterior)',
    '• #agenda - próximos rolês do grupo',
    '• #comparecer nome do evento - confirma sua presença',
    '• #desistir nome do evento - tira seu nome da lista',
    '• #motivação - uma palavra do mascote para você',
    `• Para conversar com o mascote, comece a mensagem com "${mascot.split(' ').pop()}"`,
    '',
    '🛡️ *Admins*',
    '• #agendar - responda à sugestão do rolê (ou: #agendar Nome | 15/11 19h | Local)',
    '• #cancelarevento nome do evento',
    '• #mascote Nome do personagem - troca o mascote (#mascote padrão volta ao original)',
  ].join('\n');
}

async function motivate(ctx: BotContext, msg: InboundMessage): Promise<void> {
  const name = (await ctx.nameOf(msg.senderPhone)) || msg.pushName || 'você';
  const hour = local(ctx.now(), ctx.timezone).hour;
  let text = '';
  try {
    text = await ctx.ai.text(
      `${name} mandou #motivação no grupo agora, às ${hour}h, pedindo uma palavra de ânimo. Escreva 2 a 4 linhas só para essa pessoa, chamando pelo nome, do seu jeito. Adapte ao horário e evite frases prontas.`,
      { system: (await ctx.mascot()).persona, temperature: 1 },
    );
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou na motivação');
  }
  await ctx.reply(text.replace(/\*\*/g, '*').trim() || `✨ ${name}, hoje é dia de fazer acontecer!`);
}

/** Bot de grupo de conversa: usa as funções do núcleo (agenda, resumo, mascote) e estes comandos. */
export const geral: BotModule = {
  id: 'geral',
  defaultMascot: { name: 'Mascote da Turma', persona: TURMA_PERSONA },
  async handle(ctx, msg) {
    if (msg.type !== 'text') return;
    const t = msg.text.trim();
    if (/^[#!](ajuda|comandos)\b/i.test(t)) return ctx.reply(helpText((await ctx.mascot()).name));
    if (/^[#!]motiva(c|ç)(a|ã)o(?![\p{L}\p{N}])/iu.test(t)) return motivate(ctx, msg);
  },
};
