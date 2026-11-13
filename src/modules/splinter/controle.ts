import type { BotContext, InboundMessage } from '../../core/types.js';
import { samePhone } from '../../core/phone.js';
import type { SplinterRepo } from './repo.js';
import type { Challenge } from './types.js';
import * as M from './messages.js';

/** Quantas vezes o bot pergunta antes de zerar a pontuação. */
export const RESET_QUESTIONS = 3;
/** Depois disso sem resposta, o pedido de #reiniciar caduca. */
export const RESET_TIMEOUT_MIN = 5;

/** #pausar / #despausar: só admins. Pausado, nenhuma foto nova pontua. */
export async function togglePause(ctx: BotContext, repo: SplinterRepo, ch: Challenge, msg: InboundMessage, pause: boolean) {
  if (!(await ctx.isAdmin(msg.senderPhone))) return ctx.reply(M.onlyAdmin(pause ? 'pausar a competição' : 'despausar a competição'));
  if (ch.paused === pause) {
    return ctx.reply(pause ? `⏸️ A competição ${ch.name} já está pausada. Para voltar: #despausar` : `▶️ A competição ${ch.name} não está pausada.`);
  }
  await repo.setPaused(ch.id, pause, msg.pushName || msg.senderPhone);
  return ctx.reply(
    pause
      ? `⏸️ *Competição pausada* por ${msg.pushName || 'um admin'}.\nA partir de agora as fotos não valem ponto. A pontuação que já existe continua guardada.\nPara voltar: #despausar`
      : `▶️ *Competição retomada!* As fotos voltam a valer ponto a partir de agora.\nO que foi mandado durante a pausa não conta. Ao treino, meus alunos! 🐀`,
  );
}

/** #reiniciar: só admins. O bot pergunta 3 vezes antes de zerar. */
export async function askReset(ctx: BotContext, repo: SplinterRepo, ch: Challenge, msg: InboundMessage) {
  if (!(await ctx.isAdmin(msg.senderPhone))) return ctx.reply(M.onlyAdmin('reiniciar a competição'));
  await repo.setResetStep(ch.id, 1, msg.senderPhone, ctx.now());
  return ctx.reply(question(ch, 1));
}

/** #sim / #não depois de um #reiniciar. Fora disso, ignora (é conversa normal). */
export async function answerReset(ctx: BotContext, repo: SplinterRepo, ch: Challenge, msg: InboundMessage, yes: boolean) {
  if (!ch.reset_step || !ch.reset_by) return;
  const expired = !ch.reset_asked_at || ctx.now().getTime() - ch.reset_asked_at.getTime() > RESET_TIMEOUT_MIN * 60_000;
  if (expired) {
    await repo.setResetStep(ch.id, 0, null, null);
    return ctx.reply(`⌛ O pedido para reiniciar a competição expirou. Nada foi apagado. Se ainda quiser, mande #reiniciar de novo.`);
  }
  if (!samePhone(ch.reset_by, msg.senderPhone)) {
    return ctx.reply('🛡️ Só o admin que mandou o #reiniciar pode responder às perguntas.');
  }
  if (!yes) {
    await repo.setResetStep(ch.id, 0, null, null);
    return ctx.reply('👍 Reinício cancelado. A pontuação continua como estava.');
  }
  if (ch.reset_step < RESET_QUESTIONS) {
    const next = ch.reset_step + 1;
    await repo.setResetStep(ch.id, next, ch.reset_by, ctx.now());
    return ctx.reply(question(ch, next));
  }
  const { checkins } = await repo.resetScores(ch.id, msg.pushName || msg.senderPhone);
  return ctx.reply(
    `🔄 *Competição reiniciada!* A pontuação do ${ch.name} foi zerada (${checkins} check-in(s) guardados no arquivo do bot).\n` +
      'Participantes e equipes continuam os mesmos. Que comece um novo ciclo, meus alunos! 🐀🥋',
  );
}

function question(ch: Challenge, step: number): string {
  const lines: Record<number, string> = {
    1: `⚠️ *Reiniciar a competição ${ch.name}?*\nIsso ZERA a pontuação de todo mundo: ranking individual e de equipes voltam para 0.\nTem certeza?`,
    2: '⚠️ Tem certeza *mesmo*? Todos os check-ins até hoje deixam de contar e não dá para desfazer pelo grupo.',
    3: '🚨 *Última pergunta:* posso zerar a pontuação agora?',
  };
  return `${lines[step]} (${step}/${RESET_QUESTIONS})\nResponda #sim para continuar ou #não para cancelar. O pedido vale por ${RESET_TIMEOUT_MIN} minutos.`;
}
