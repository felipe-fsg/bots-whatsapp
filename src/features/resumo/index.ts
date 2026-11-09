import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { local } from '../../core/time.js';

/** Por quantos dias as mensagens ficam guardadas para o #resumo. */
export const KEEP_DAYS = 3;
const MAX_CHARS = 120_000;

export function summaryPrompt(dayLabel: string, transcript: string, partial: boolean): string {
  return `Abaixo estão as mensagens do grupo de WhatsApp ${dayLabel}${partial ? ' (as mais recentes; o dia teve mais mensagens)' : ''}, no formato "hora nome: texto".

Faça um resumo para quem não acompanhou a conversa:
- Até 15 tópicos, do mais importante para o menos importante. Agrupe mensagens sobre o mesmo assunto num tópico só.
- Cada tópico em uma linha começando com um emoji, com o assunto em *negrito* e o que foi dito ou decidido, citando quem falou quando ajudar.
- Destaque combinados, datas, horários, pedidos e perguntas que ficaram sem resposta.
- Ignore bom dia, figurinhas, risadas e mensagens sem conteúdo.
- Não invente nada que não esteja nas mensagens.
- Comece com uma linha curta de abertura, do seu jeito de mascote, e depois os tópicos. Sem conclusão longa.

Mensagens:
${transcript}`;
}

async function summarize(ctx: BotContext, msg: InboundMessage, yesterday: boolean): Promise<void> {
  const now = local(ctx.now(), ctx.timezone);
  const day = yesterday ? now.minus({ days: 1 }) : now;
  const from = day.startOf('day').toJSDate();
  const to = yesterday ? day.endOf('day').toJSDate() : ctx.now();

  const rows = await ctx.sql<{ sent_at: Date; sender_name: string | null; sender_phone: string | null; text: string }[]>`
    select sent_at, sender_name, sender_phone, text from group_messages
    where bot_id = ${ctx.bot.id} and sent_at >= ${from} and sent_at <= ${to} and msg_id <> ${msg.id}
    order by sent_at`;
  // comandos para o bot não entram no resumo
  const lines = rows
    .filter((r) => !/^[#!?]/.test(r.text.trim()))
    .map((r) => `${local(r.sent_at, ctx.timezone).toFormat('HH:mm')} ${r.sender_name || (r.sender_phone ? `+${r.sender_phone}` : 'alguém')}: ${r.text.replace(/\s+/g, ' ')}`);

  if (lines.length < 3) {
    await ctx.reply(`📝 Quase não teve conversa ${yesterday ? 'ontem' : 'hoje'} até agora, não há o que resumir.`);
    return;
  }
  let transcript = '';
  let partial = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (transcript.length + lines[i]!.length > MAX_CHARS) {
      partial = true;
      break;
    }
    transcript = `${lines[i]}\n${transcript}`;
  }

  const label = yesterday ? `de ontem (${day.toFormat('dd/MM')})` : `de hoje (${day.toFormat('dd/MM')}) até as ${now.toFormat('HH:mm')}`;
  let text = '';
  try {
    text = await ctx.ai.text(summaryPrompt(label, transcript.trim(), partial), { system: (await ctx.mascot()).persona, temperature: 0.4 });
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou no resumo');
  }
  await ctx.reply(
    text.trim()
      ? `📝 *Resumo ${label}* (${lines.length} mensagens)\n\n${text.replace(/\*\*/g, '*').trim()}`
      : '😕 Não consegui fazer o resumo agora. Tente de novo em alguns minutos.',
  );
}

/** #resumo: o que rolou no grupo hoje (ou ontem). Função do núcleo, vale para todos os bots. */
export const resumo: BotModule = {
  id: 'resumo',
  async handle(ctx, msg) {
    if (msg.type !== 'text') return false;
    const m = msg.text.trim().match(/^[#!]resumo\b\s*(.*)$/i);
    if (!m) return false;
    await summarize(ctx, msg, /^ontem/i.test(m[1] ?? ''));
    return true;
  },
  jobs: [
    {
      name: 'apagar-mensagens-antigas',
      cron: '30 3 * * *',
      async run(ctx) {
        await ctx.sql`delete from group_messages
          where bot_id = ${ctx.bot.id} and sent_at < now() - make_interval(days => ${KEEP_DAYS})`;
      },
    },
  ],
};
