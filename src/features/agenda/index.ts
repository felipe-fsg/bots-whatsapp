import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { local } from '../../core/time.js';
import { digits } from '../../core/phone.js';
import { eventPrompt, matchEvent, parseAgendaCommand, parseExplicit, type EventDraft } from './parse.js';

interface EventRow {
  id: string;
  title: string;
  starts_on: string;
  start_time: string | null;
  place: string | null;
  organizer_name: string | null;
  attendees: string[];
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function when(e: Pick<EventRow, 'starts_on' | 'start_time'>): string {
  const [y, m, d] = e.starts_on.split('-').map(Number) as [number, number, number];
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}${e.start_time ? ` às ${e.start_time}` : ''}`;
}

function today(ctx: BotContext): string {
  return local(ctx.now(), ctx.timezone).toISODate()!;
}

/** Eventos de hoje em diante. Um evento sai da lista no dia seguinte à data dele. */
async function upcoming(ctx: BotContext): Promise<EventRow[]> {
  return ctx.sql<EventRow[]>`
    select e.id, e.title, e.starts_on, e.start_time, e.place, e.organizer_name,
           coalesce(array_agg(a.name order by a.created_at) filter (where a.name is not null), '{}') as attendees
    from events e left join event_attendees a on a.event_id = e.id
    where e.bot_id = ${ctx.bot.id} and e.status = 'agendado' and e.starts_on >= ${today(ctx)}
    group by e.id order by e.starts_on, e.start_time nulls last, e.created_at`;
}

function listText(events: EventRow[]): string {
  if (!events.length) return '📅 Nenhum evento na agenda. Sugira um aqui no grupo e peça para um admin responder com #agendar.';
  const L = ['📅 *Agenda do grupo*'];
  events.forEach((e, i) => {
    L.push('', `${i + 1}. *${e.title}* - ${when(e)}`);
    const info = [e.place && `📍 ${e.place}`, e.organizer_name && `🙋 ${e.organizer_name}`].filter(Boolean).join(' · ');
    if (info) L.push(`   ${info}`);
    L.push(`   ✅ Confirmados (${e.attendees.length})${e.attendees.length ? `: ${e.attendees.join(', ')}` : ''}`);
  });
  L.push('', 'Para ir: #comparecer nome do evento');
  return L.join('\n');
}

async function ambiguous(ctx: BotContext, found: EventRow[] | null, events: EventRow[]): Promise<void> {
  if (Array.isArray(found)) {
    await ctx.reply(`🤔 Achei mais de um evento com esse nome: ${found.map((e) => e.title).join(', ')}. Escreva o nome completo.`);
  } else if (!events.length) {
    await ctx.reply('📅 Não há eventos na agenda agora.');
  } else {
    await ctx.reply(`🤔 Não achei esse evento. Os da agenda são: ${events.map((e) => e.title).join(', ')}.`);
  }
}

async function schedule(ctx: BotContext, msg: InboundMessage, extra: string): Promise<void> {
  if (!(await ctx.isAdmin(msg.senderPhone))) {
    await ctx.reply('🛡️ Só os admins podem agendar eventos. Sugira o evento aqui no grupo e peça para um deles responder com #agendar.');
    return;
  }
  const suggestion = msg.quoted?.text ?? '';
  if (!suggestion && !extra) {
    await ctx.reply('📅 Para agendar, responda à mensagem com a sugestão do evento usando #agendar. Ou escreva direto: #agendar Nome | 15/11 19h | Local');
    return;
  }

  const day = today(ctx);
  let draft: EventDraft | null = parseExplicit(extra, day);
  if (!draft) {
    try {
      const weekday = local(ctx.now(), ctx.timezone).setLocale('pt-BR').toFormat('cccc');
      const raw = await ctx.ai.text(eventPrompt(suggestion, extra, day, weekday), { json: true, temperature: 0 });
      const j = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim());
      draft = {
        title: String(j.title ?? '').trim(),
        date: /^\d{4}-\d{2}-\d{2}$/.test(j.date ?? '') ? j.date : null,
        time: /^\d{2}:\d{2}$/.test(j.time ?? '') ? j.time : null,
        place: j.place ? String(j.place) : null,
        organizer: j.organizer ? String(j.organizer) : null,
      };
    } catch (err) {
      ctx.log.warn({ err: String(err) }, 'IA falhou ao ler o evento');
    }
  }
  if (!draft?.title || !draft.date) {
    await ctx.reply('🤔 Não consegui entender o nome ou a data do evento. Escreva assim: #agendar Nome do evento | 15/11 19h | Local');
    return;
  }
  if (draft.date < day) {
    await ctx.reply(`🤔 A data ${draft.date.split('-').reverse().join('/')} já passou. Confira e mande de novo.`);
    return;
  }

  // Quem organiza: o nome escrito no texto; senão, quem sugeriu (a mensagem citada); senão, o admin.
  const suggesterPhone = msg.quoted ? await ctx.contacts.phoneOf(msg.quoted.participant, msg.chatJid).catch(() => '') : '';
  const organizerPhone = suggesterPhone || msg.senderPhone;
  const organizerName = draft.organizer || (suggesterPhone ? await ctx.nameOf(suggesterPhone) : msg.pushName) || null;

  const rows = await ctx.sql<{ id: string }[]>`
    insert into events (bot_id, title, starts_on, start_time, place, organizer_name, organizer_phone, source_msg_id, created_by)
    values (${ctx.bot.id}, ${draft.title.slice(0, 80)}, ${draft.date}, ${draft.time}, ${draft.place}, ${organizerName},
            ${digits(organizerPhone)}, ${msg.quoted?.messageId ?? null}, ${msg.senderPhone})
    on conflict (bot_id, source_msg_id) where source_msg_id is not null do nothing
    returning id`;
  if (!rows.length) {
    await ctx.reply('📅 Essa sugestão já está na agenda. Mande #agenda para ver.');
    return;
  }
  const info = [draft.place && `📍 ${draft.place}`, organizerName && `🙋 Organização: ${organizerName}`].filter(Boolean);
  await ctx.reply(
    [`📅 Evento agendado: *${draft.title}*`, `🗓️ ${when({ starts_on: draft.date, start_time: draft.time })}`, ...info, '', `Quem vai, mande: #comparecer ${draft.title}`].join('\n'),
  );
}

async function attend(ctx: BotContext, msg: InboundMessage, name: string, going: boolean): Promise<void> {
  const events = await upcoming(ctx);
  const found = matchEvent(events, name);
  if (!found || Array.isArray(found)) return ambiguous(ctx, found, events);
  const who = (await ctx.nameOf(msg.senderPhone)) || msg.pushName || `+${msg.senderPhone}`;
  if (going) {
    await ctx.sql`insert into event_attendees (event_id, phone, name) values (${found.id}, ${digits(msg.senderPhone)}, ${who})
      on conflict (event_id, phone) do update set name = excluded.name`;
    const total = found.attendees.includes(who) ? found.attendees.length : found.attendees.length + 1;
    await ctx.reply(`✅ ${who} confirmou presença em *${found.title}* (${when(found)}). Já são ${total} confirmados.`);
  } else {
    await ctx.sql`delete from event_attendees where event_id = ${found.id} and phone = ${digits(msg.senderPhone)}`;
    await ctx.reply(`👋 ${who} saiu da lista de *${found.title}*.`);
  }
}

async function cancel(ctx: BotContext, msg: InboundMessage, name: string): Promise<void> {
  if (!(await ctx.isAdmin(msg.senderPhone))) {
    await ctx.reply('🛡️ Só os admins podem cancelar eventos.');
    return;
  }
  const events = await upcoming(ctx);
  const found = matchEvent(events, name);
  if (!found || Array.isArray(found)) return ambiguous(ctx, found, events);
  await ctx.sql`update events set status = 'cancelado' where id = ${found.id}`;
  await ctx.reply(`❌ Evento *${found.title}* (${when(found)}) cancelado.`);
}

/** Agenda de eventos do grupo. Função do núcleo: vale para todos os bots, a qualquer momento. */
export const agenda: BotModule = {
  id: 'agenda',
  async handle(ctx, msg) {
    if (msg.type !== 'text') return false;
    const cmd = parseAgendaCommand(msg.text);
    if (!cmd) return false;
    switch (cmd.type) {
      case 'agenda':
        await ctx.reply(listText(await upcoming(ctx)));
        break;
      case 'agendar':
        await schedule(ctx, msg, cmd.text);
        break;
      case 'comparecer':
        await attend(ctx, msg, cmd.name, true);
        break;
      case 'desistir':
        await attend(ctx, msg, cmd.name, false);
        break;
      case 'cancelar':
        await cancel(ctx, msg, cmd.name);
        break;
    }
    return true;
  },
  jobs: [
    {
      // Uma vez por dia marca como passados os eventos de ontem para trás (a lista já os esconde).
      name: 'eventos-passados',
      cron: '5 0 * * *',
      async run(ctx) {
        await ctx.sql`update events set status = 'passado'
          where bot_id = ${ctx.bot.id} and status = 'agendado' and starts_on < ${today(ctx)}`;
      },
    },
  ],
};

export { listText as agendaText };
