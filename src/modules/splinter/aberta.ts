/**
 * Competição aberta de treinos (#monitorartreinos): serve para a turma engajar postando treino,
 * alimentação etc. Pontua igual à competição individual, sem duplas/equipes; qualquer pessoa entra
 * a qualquer momento com #ficargostoso ou #ficargostosa. No fim do dia o mascote dá os parabéns a
 * quem mais pontuou (#desativarparabens / #ativarparabens).
 */
import type { BotContext, InboundMessage } from '../../core/types.js';
import { local, localDay, br } from '../../core/time.js';
import type { SplinterRepo } from './repo.js';
import type { Challenge, Rule } from './types.js';
import { displayName } from './types.js';
import * as M from './messages.js';
import * as P from './prompts.js';

/** Categorias quando o bot nunca teve desafio para copiar. Pose começa desligada: precisa de admin postando. */
export const OPEN_DEFAULT_RULES: Omit<Rule, 'id'>[] = [
  { category: 'Treino', hashtag: '#treino', kind: 'treino', points: 3, max_per_day: 1, active: true },
  { category: 'Alimentação', hashtag: '#comida', kind: 'comida', points: 1, max_per_day: 1, active: true },
  { category: 'Hidratação', hashtag: '#agua', kind: 'outro', points: 1, max_per_day: 1, active: true },
  { category: 'Cardio', hashtag: '#cardio', kind: 'outro', points: 1, max_per_day: 1, active: true },
  { category: 'Pose do dia', hashtag: '#pose', kind: 'pose', points: 1, max_per_day: 1, active: false },
];

const OPEN_DEFAULT_SETTINGS: Partial<Challenge> = {
  require_location: true,
  location_radius_m: 15,
  place_types: ['gym', 'fitness_center', 'park', 'sports_complex', 'sports_club', 'stadium', 'swimming_pool'],
  confirm_valid: true,
};

/** #monitorartreinos (liga) e #pararmonitoramento (desliga). Só admins. */
export async function toggleOpen(ctx: BotContext, repo: SplinterRepo, msg: InboundMessage, on: boolean) {
  if (!(await ctx.isAdmin(msg.senderPhone))) {
    return ctx.reply(M.onlyAdmin(on ? 'ligar a competição aberta de treinos' : 'desligar a competição aberta de treinos'));
  }
  const active = await repo.activeChallenge(ctx.bot.id);
  if (!on) {
    if (!active?.open_mode) return ctx.reply('ℹ️ A competição aberta de treinos não está ligada neste grupo.');
    await repo.stopChallenge(active.id);
    return ctx.reply(
      '⏹️ *Competição aberta encerrada.* As fotos deixam de valer ponto.\nInscritos e pontos ficam guardados: se ligar de novo com #monitorartreinos, continua de onde parou.',
    );
  }
  if (active?.open_mode) {
    return ctx.reply(`✅ A competição aberta já está ligada. Para entrar: *#ficargostoso* ou *#ficargostosa*. Mande #regras para ver como pontuar.`);
  }
  if (active) {
    return ctx.reply(
      `⚠️ Este grupo já tem a competição *${active.name}* rolando (com inscrição pelos admins). Só cabe uma por vez: a competição aberta pode ser ligada depois que ela terminar.`,
    );
  }
  const today = localDay(ctx.now(), ctx.timezone);
  const { ch, created } = await repo.startOpenChallenge(ctx.bot.id, today, { rules: OPEN_DEFAULT_RULES, settings: OPEN_DEFAULT_SETTINGS });
  const rules = (await repo.rules(ch.id)).filter((r) => r.active);
  const mascot = (await ctx.mascot()).name;
  return ctx.reply(
    [
      `🔥 *Competição aberta de treinos ${created ? 'ligada' : 'religada'}!*`,
      created ? '' : 'Quem já estava inscrito continua com seus pontos.',
      'Vale para todo mundo do grupo e dá para entrar a qualquer momento: mande *#ficargostoso* ou *#ficargostosa*.',
      '',
      '📸 Depois é só mandar foto com a hashtag na legenda:',
      ...rules.map((r) => `• ${r.hashtag} - ${r.category}: ${fmt(r.points)} ponto(s)`),
      '',
      `🏆 Todo dia às 6h o ${mascot} dá os parabéns a quem mais pontuou no dia anterior.`,
      'Ranking: #ranking. Regras completas: #regras.',
    ]
      .filter((l, i) => i !== 1 || l)
      .join('\n'),
  );
}

/** #ficargostoso / #ficargostosa: a própria pessoa entra na competição aberta. */
export async function selfEnroll(ctx: BotContext, repo: SplinterRepo, msg: InboundMessage) {
  const ch = await repo.activeChallenge(ctx.bot.id);
  if (!ch) return ctx.reply('ℹ️ A competição aberta de treinos não está ligada neste grupo. Um admin liga com #monitorartreinos.');
  if (!ch.open_mode) return ctx.reply(M.notEnrolled(msg.pushName));
  if (!msg.senderPhone) {
    return ctx.reply(`⚠️ ${msg.pushName || 'Jovem guerreiro'}, o WhatsApp não me mostrou seu número, então não consegui te inscrever. Peça a um admin para te inscrever com #inscrever.`);
  }
  const existing = await repo.participantByPhone(ch.id, msg.senderPhone);
  if (existing?.active) {
    return ctx.reply(`💪 ${displayName(existing)}, você já está na competição! Agora é mandar as fotos com as hashtags. Mande #regras se quiser relembrar.`);
  }
  const name = (existing?.name || (await ctx.nameOf(msg.senderPhone)) || msg.pushName || `Atleta ${msg.senderPhone.slice(-4)}`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  await repo.upsertParticipant(ch.id, msg.senderPhone, name);
  const rules = (await repo.rules(ch.id)).filter((r) => r.active);
  return ctx.reply(
    `🔥 *${name}* entrou na competição! Bora ficar gostos${msg.text.toLowerCase().includes('gostosa') ? 'a' : 'o'}! 💪\n` +
      `Mande foto com a hashtag na legenda: ${rules.map((r) => r.hashtag).join(', ')}. Mande #regras para ver os pontos.`,
  );
}

/** #ativarparabens / #desativarparabens: só admins, só na competição aberta. */
export async function toggleCongrats(ctx: BotContext, repo: SplinterRepo, msg: InboundMessage, on: boolean) {
  if (!(await ctx.isAdmin(msg.senderPhone))) return ctx.reply(M.onlyAdmin(`${on ? 'ativar' : 'desativar'} os parabéns do dia`));
  const ch = await repo.activeChallenge(ctx.bot.id);
  if (!ch?.open_mode) return ctx.reply('ℹ️ Os parabéns do dia são da competição aberta de treinos. Ligue antes com #monitorartreinos.');
  if (ch.daily_congrats === on) {
    return ctx.reply(on ? '✅ Os parabéns do dia já estão ligados.' : '⛔ Os parabéns do dia já estão desligados.');
  }
  await repo.setDailyCongrats(ch.id, on);
  return ctx.reply(
    on
      ? '✅ Parabéns do dia ligados: todo dia às 6h o mascote parabeniza quem mais pontuou no dia anterior.'
      : '⛔ Parabéns do dia desligados. Para voltar: #ativarparabens',
  );
}

/** Job das 6h: parabeniza quem teve a maior pontuação do dia anterior (empates levam todos). */
export async function congratulateDay(ctx: BotContext, repo: SplinterRepo): Promise<void> {
  const ch = await repo.activeChallenge(ctx.bot.id);
  if (!ch?.open_mode || !ch.daily_congrats || ch.paused) return;
  const day = local(ctx.now(), ch.timezone).minus({ days: 1 }).toISODate()!;
  const scores = await repo.dayScores(ch.id, day);
  if (!scores.length) return;
  const best = scores[0]!.points;
  const winners = scores.filter((s) => s.points === best);

  const facts = winners.map((w) => `${w.name}: ${fmt(w.points)} pontos (${w.categories.join(', ')})`).join('; ');
  let text = '';
  try {
    text = P.whatsappFormat(
      await ctx.ai.text(P.congratsPrompt(br(day), facts, winners.length, scores.length), {
        system: (await ctx.mascot()).persona,
        temperature: 1,
      }),
    );
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou nos parabéns do dia');
  }
  if (!text) text = winners.length > 1 ? 'Empate no topo! Disciplina assim merece reverência. Amanhã tem mais. 🐀🥋' : 'Disciplina assim merece reverência. Amanhã tem mais. 🐀🥋';

  const head = `🏆 *Destaque${winners.length > 1 ? 's' : ''} de ontem (${br(day)})*`;
  const line = (w: (typeof winners)[number], tag: boolean) =>
    `${tag ? `@${w.phone} (*${w.name}*)` : `*${w.name}*`} - ${fmt(w.points)} pts (${w.categories.join(', ')})`;

  const phones = winners.filter((w) => w.phone.length >= 10);
  if (phones.length === winners.length && typeof ctx.wa.sendTextMentions === 'function') {
    try {
      const body = [head, ...winners.map((w) => line(w, true)), '', text].join('\n');
      return await ctx.wa.sendTextMentions(ctx.bot.chatJid, body, winners.map((w) => `${w.phone}@s.whatsapp.net`));
    } catch (err) {
      ctx.log.warn({ err: String(err) }, 'não consegui marcar nos parabéns do dia; mandando sem marcar');
    }
  }
  await ctx.reply([head, ...winners.map((w) => line(w, false)), '', text].join('\n'));
}

function fmt(n: number): string {
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
}
