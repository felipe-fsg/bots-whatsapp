import type { BotContext, BotModule } from '../../core/types.js';
import { local } from '../../core/time.js';
import { adminOnly } from '../admins/index.js';

/** Liga e desliga uma opção em bots.settings. */
export async function setSetting(ctx: BotContext, patch: Record<string, unknown>): Promise<void> {
  await ctx.sql`update bots set settings = settings || ${ctx.sql.json(patch as never)} where id = ${ctx.bot.id}`;
}

export async function settings(ctx: BotContext): Promise<Record<string, unknown>> {
  const [row] = await ctx.sql<{ settings: Record<string, unknown> }[]>`select settings from bots where id = ${ctx.bot.id}`;
  return row?.settings ?? {};
}

const FALLBACK: Record<string, string> = {
  manha: '📸 Bom dia, galera! O que vocês estão fazendo agora? Manda uma foto aqui no grupo!',
  tarde: '📸 Boa tarde, galera! Como está a tarde de vocês? Manda uma foto do que está fazendo!',
  noite: '📸 Boa noite, galera! O que rolou hoje? Manda uma foto de agora aqui no grupo!',
};

export function periodOf(hour: number): 'manha' | 'tarde' | 'noite' {
  return hour < 12 ? 'manha' : hour < 18 ? 'tarde' : 'noite';
}

export function curiarPrompt(period: 'manha' | 'tarde' | 'noite'): string {
  const when = { manha: 'de manhã (10h)', tarde: 'à tarde (15h)', noite: 'à noite (21h)' }[period];
  return `Agora é ${when}. Escreva uma mensagem curta (2 a 3 linhas) para o grupo, do seu jeito, pedindo para todo mundo mandar uma foto do que está fazendo agora, para animar a conversa. Combine com o horário, varie o estilo e evite frases prontas. Não cite ninguém pelo nome.`;
}

/** Pedido de fotos às 10h, 15h e 21h, quando ligado com #curiar. */
export async function curiarJob(ctx: BotContext): Promise<void> {
  if ((await settings(ctx)).curiar !== true) return;
  const period = periodOf(local(ctx.now(), ctx.timezone).hour);
  let text = '';
  try {
    text = await ctx.ai.text(curiarPrompt(period), { system: (await ctx.mascot()).persona, temperature: 1 });
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou no #curiar');
  }
  await ctx.reply(text.replace(/\*\*/g, '*').trim() || FALLBACK[period]!);
}

/** #curiar liga e #nãocuriar desliga o pedido de fotos. Função do núcleo. */
export const curiar: BotModule = {
  id: 'curiar',
  jobs: [{ name: 'pedido-de-fotos', cron: '0 10,15,21 * * *', run: curiarJob }],
  async handle(ctx, msg) {
    if (msg.type !== 'text') return false;
    const m = /^[#!](n[aã]o\s*)?curiar(?![\p{L}\p{N}])/iu.exec(msg.text.trim());
    if (!m) return false;
    if (!(await ctx.isAdmin(msg.senderPhone))) {
      await ctx.reply(adminOnly('ligar ou desligar o pedido de fotos'));
      return true;
    }
    const on = !m[1];
    await setSetting(ctx, { curiar: on });
    await ctx.reply(
      on
        ? '📸 Pedido de fotos ligado! Às 10h, 15h e 21h vou pedir para a galera mandar foto do que está fazendo. Para desligar: #nãocuriar'
        : '📸 Pedido de fotos desligado. Para voltar: #curiar',
    );
    return true;
  },
};
