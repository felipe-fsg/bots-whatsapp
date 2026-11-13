import type { BotContext, ScheduledJob } from '../../core/types.js';
import { local } from '../../core/time.js';
import { SplinterRepo } from './repo.js';
import * as P from './prompts.js';
import { br } from '../../core/time.js';

/** Treinos que ficaram sem localização no prazo vão para a revisão dos admins. */
async function expireLocations(ctx: BotContext): Promise<void> {
  const repo = new SplinterRepo(ctx.sql);
  const ch = await repo.activeChallenge(ctx.bot.id);
  if (!ch) return;
  const before = new Date(ctx.now().getTime() - ch.location_window_min * 60_000);
  const n = await repo.expireLocations(ch.id, before);
  if (n) ctx.log.info({ bot: ctx.bot.id, n }, 'treinos sem localização foram para revisão');
}

/** Monta os números do desafio para a IA escrever como Mestre Splinter. */
export async function splinterData(ctx: BotContext, summary: boolean): Promise<string | null> {
  const repo = new SplinterRepo(ctx.sql);
  const ch = await repo.activeChallenge(ctx.bot.id);
  if (!ch) return null;
  const now = local(ctx.now(), ch.timezone);
  const today = now.toISODate()!;
  const yesterday = now.minus({ days: 1 }).toISODate()!;
  const refDay = summary ? yesterday : today;
  if (refDay < ch.starts_on || refDay > ch.ends_on) return null;

  const participants = await repo.countActiveParticipants(ch.id);
  const daysLeft = Math.max(0, Math.round(local(new Date(`${ch.ends_on}T12:00:00Z`), ch.timezone).startOf('day').diff(now.startOf('day'), 'days').days));
  const checkins = await repo.validCheckins(ch.id, refDay, refDay);
  const byPerson = new Map<string, { points: number; cats: string[] }>();
  for (const c of checkins) {
    const e = byPerson.get(c.name) ?? { points: 0, cats: [] };
    e.points += c.points;
    e.cats.push(c.category);
    byPerson.set(c.name, e);
  }
  const fmt =
    [...byPerson.entries()]
      .sort((a, b) => b[1].points - a[1].points)
      .map(([n, v]) => `${n}: ${v.points} pts (${v.cats.join(', ')})`)
      .join('; ') || 'ninguém';

  const L: string[] = [];
  L.push(`Desafio: ${ch.name} (${br(ch.starts_on)} a ${br(ch.ends_on)}). Agora: ${br(today)}, ${now.hour}h. Dias restantes depois de hoje: ${daysLeft}. Participantes: ${participants}.`);
  if (summary) {
    L.push(`Check-ins válidos de ontem (${br(yesterday)}): ${fmt}`);
    L.push(`Participantes sem nenhum check-in válido ontem: ${Math.max(0, participants - byPerson.size)}`);
  } else {
    L.push(`Check-ins válidos de hoje até agora: ${fmt}`);
    L.push(`Participantes ainda sem check-in hoje: ${Math.max(0, participants - byPerson.size)}`);
    const hours = Math.max(1, ch.persona_interval_h);
    const since = ctx.now().getTime() - hours * 3_600_000;
    const recent = checkins.filter((c) => c.sent_at.getTime() >= since).map((c) => `${c.name} (${c.category})`);
    L.push(`Check-ins válidos desde a última mensagem (últimas ${hours}h): ${recent.join(', ') || 'nenhum'}`);
  }
  const ranking = await repo.ranking(ch.id);
  L.push(`Ranking individual: ${ranking.slice(0, summary ? 10 : 5).map((r, i) => `${i + 1}. ${r.name} ${r.points} pts`).join('; ') || 'vazio'}`);
  const teams = await repo.teamRanking(ch.id, ch.team_bonus_points);
  if (teams.length) L.push(`Ranking de equipes: ${teams.slice(0, 5).map((t, i) => `${i + 1}. ${t.name} (${t.members}) ${t.points} pts`).join('; ')}`);
  return L.join('\n');
}

/** Roda de hora em hora das 4h às 23h: resumo às 4h e mensagens no intervalo configurado. */
async function mestreSplinter(ctx: BotContext): Promise<void> {
  const repo = new SplinterRepo(ctx.sql);
  const ch = await repo.activeChallenge(ctx.bot.id);
  if (!ch || ch.paused) return; // pausado: sem resumo nem mensagens do mestre
  const hour = local(ctx.now(), ch.timezone).hour;
  const summary = hour === 4;
  const interval = Math.max(1, ch.persona_interval_h);
  const on = summary ? ch.daily_summary : ch.persona_messages && hour > 4 && (hour - 4) % interval === 0;
  if (!on) return;

  const data = await splinterData(ctx, summary);
  if (!data) return;
  const prompt = summary ? P.summaryPrompt(data) : P.hourlyPrompt(hour, data);
  const text = P.whatsappFormat(await ctx.ai.text(prompt, { system: (await ctx.mascot()).persona, temperature: 1 }));
  if (text) await ctx.reply(text);
}

export const splinterJobs: ScheduledJob[] = [
  { name: 'localizacao-vencida', cron: '*/5 * * * *', run: expireLocations },
  { name: 'mestre-splinter', cron: '0 4-23 * * *', run: mestreSplinter },
];
