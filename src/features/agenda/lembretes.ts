import { DateTime } from 'luxon';
import type { BotContext, InboundMessage } from '../../core/types.js';
import { local } from '../../core/time.js';
import { adminOnly } from '../admins/index.js';
import { sendToAll, setSetting, settings } from '../curiar/index.js';

/**
 * Lembretes automáticos da agenda (núcleo, todos os bots que usam a agenda).
 * Todo dia às 9h o bot olha a agenda:
 *  - evento a 6 dias ou menos (a semana do evento): lembra todo dia até o dia dele;
 *  - evento mais longe: lembra uma vez por semana, na segunda.
 * Tudo numa mensagem só, marcando todo mundo do grupo. Vem ligado; admin desliga com #desativarlembretes.
 */
export const REMINDER_CRON = '0 9 * * *';
const DAILY_WINDOW = 6; // dias antes do evento em que o lembrete vira diário

export interface ReminderEvent {
  title: string;
  starts_on: string;
  start_time: string | null;
  place: string | null;
  attendees: string[];
}

export function daysUntil(startsOn: string, today: string): number {
  return Math.round(DateTime.fromISO(startsOn).diff(DateTime.fromISO(today), 'days').days);
}

function countdown(days: number): string {
  if (days <= 0) return 'é *HOJE*';
  if (days === 1) return 'é *amanhã*';
  return `faltam *${days} dias*`;
}

/** Texto do lembrete do dia, ou null se hoje não tem o que lembrar. */
export function reminderText(
  events: ReminderEvent[],
  today: string,
  isMonday: boolean,
  when: (e: ReminderEvent) => string,
): string | null {
  const soon = events.filter((e) => daysUntil(e.starts_on, today) <= DAILY_WINDOW);
  const later = isMonday ? events.filter((e) => daysUntil(e.starts_on, today) > DAILY_WINDOW) : [];
  if (!soon.length && !later.length) return null;

  const L = ['⏰ *Lembrete da agenda*'];
  const item = (e: ReminderEvent, head: string) => {
    L.push('', head);
    if (e.place) L.push(`   📍 ${e.place}`);
    L.push(`   ✅ Confirmados: ${e.attendees.length}`);
  };
  for (const e of soon) {
    const d = daysUntil(e.starts_on, today);
    item(e, `${d <= 0 ? '🔥' : '📌'} *${e.title}* ${countdown(d)}! (${when(e)})`);
  }
  if (later.length) {
    L.push('', soon.length ? '📅 *Mais para frente*' : '📅 *Próximos eventos*');
    for (const e of later) item(e, `• *${e.title}* - ${when(e)}`);
  }
  L.push('', 'Quem vai, mande: #comparecer nome do evento', 'Ver tudo: #agenda');
  return L.join('\n');
}

/** Roda todo dia às 9h. Não manda duas vezes no mesmo dia (se o servidor reiniciar, por exemplo). */
export async function reminderJob(
  ctx: BotContext,
  upcoming: (ctx: BotContext) => Promise<ReminderEvent[]>,
  when: (e: ReminderEvent) => string,
): Promise<void> {
  const s = await settings(ctx);
  if (s.lembretes_agenda === false) return;
  const now = local(ctx.now(), ctx.timezone);
  const today = now.toISODate()!;
  if (s.lembretes_agenda_dia === today) return;
  const text = reminderText(await upcoming(ctx), today, now.weekday === 1, when);
  if (!text) return;
  await setSetting(ctx, { lembretes_agenda_dia: today });
  await sendToAll(ctx, text);
}

const TOGGLE = /^[#!](des)?ativar\s*lembretes?\s*$/iu;
const STATUS = /^[#!]lembretes?\s*$/iu;

/** #ativarlembretes / #desativarlembretes (só admins) e #lembretes (mostra se está ligado). */
export async function handleReminderCommand(ctx: BotContext, msg: InboundMessage): Promise<boolean> {
  const t = msg.text.trim();
  const toggle = TOGGLE.exec(t);
  if (!toggle && !STATUS.test(t)) return false;
  if (!toggle) {
    const on = (await settings(ctx)).lembretes_agenda !== false;
    await ctx.reply(
      on
        ? '⏰ Lembretes da agenda *ligados*: toda segunda às 9h lembro os próximos eventos marcando todo mundo, e na semana do evento lembro todo dia às 9h. Admins desligam com #desativarlembretes'
        : '⏰ Lembretes da agenda *desligados*. Admins ligam com #ativarlembretes',
    );
    return true;
  }
  if (!(await ctx.isAdmin(msg.senderPhone))) {
    await ctx.reply(adminOnly('ligar ou desligar os lembretes da agenda'));
    return true;
  }
  const on = !toggle[1];
  await setSetting(ctx, { lembretes_agenda: on });
  await ctx.reply(
    on
      ? '⏰ Lembretes da agenda ligados! Toda segunda às 9h lembro os próximos eventos, e na semana do evento lembro todo dia às 9h, marcando todo mundo. Para desligar: #desativarlembretes'
      : '⏰ Lembretes da agenda desligados. A agenda continua funcionando (#agenda). Para voltar: #ativarlembretes',
  );
  return true;
}
