import { DateTime } from 'luxon';

export type AgendaCommand =
  | { type: 'agendar'; text: string }
  | { type: 'comparecer'; name: string }
  | { type: 'desistir'; name: string }
  | { type: 'agenda' }
  | { type: 'cancelar'; name: string };

/** Comandos da agenda. Aceita com ou sem acento e com o nome do evento entre aspas. */
export function parseAgendaCommand(text: string): AgendaCommand | null {
  const t = text.trim();
  const rest = (re: RegExp) => stripQuotes(t.replace(re, '').trim());
  if (/^#agendar\b/i.test(t)) return { type: 'agendar', text: t.replace(/^#agendar/i, '').trim() };
  if (/^#comparecer\b/i.test(t)) return { type: 'comparecer', name: rest(/^#comparecer/i) };
  if (/^#(desistir|naovou|n[aã]ovou)\b/i.test(t)) return { type: 'desistir', name: rest(/^#\S+/) };
  if (/^#cancelarevento\b/i.test(t)) return { type: 'cancelar', name: rest(/^#cancelarevento/i) };
  if (/^#(agenda|eventos)\b/i.test(t)) return { type: 'agenda' };
  return null;
}

function stripQuotes(s: string): string {
  return s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
}

/** Minúsculas, sem acento e sem pontuação, para comparar nomes de eventos. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Acha o evento pelo nome: igual, depois "contém". Se só houver um evento e nenhum nome, é ele. */
export function matchEvent<T extends { title: string }>(events: T[], name: string): T | T[] | null {
  if (!name) return events.length === 1 ? events[0]! : null;
  const n = normalize(name);
  const exact = events.filter((e) => normalize(e.title) === n);
  if (exact.length === 1) return exact[0]!;
  const partial = events.filter((e) => normalize(e.title).includes(n) || n.includes(normalize(e.title)));
  if (partial.length === 1) return partial[0]!;
  return partial.length > 1 ? partial : null;
}

export interface EventDraft {
  title: string;
  date: string | null; // yyyy-MM-dd
  time: string | null; // HH:mm
  place: string | null;
  organizer: string | null;
}

/**
 * Formato direto, sem IA: "Nome | 15/11 19h | Local | Organizador" (separado por | ou ;).
 * Devolve null se não tiver ao menos nome e data.
 */
export function parseExplicit(text: string, today: string): EventDraft | null {
  const parts = text.split(/\s*[|;]\s*/).filter(Boolean);
  if (parts.length < 2) return null;
  const when = parseWhen(parts[1]!, today);
  if (!when) return null;
  return { title: parts[0]!, date: when.date, time: when.time, place: parts[2] ?? null, organizer: parts[3] ?? null };
}

/** '15/11', '15/11/2026', '15/11 19h', '15/11 às 19:30'. Ano omitido = próxima ocorrência. */
export function parseWhen(s: string, today: string): { date: string; time: string | null } | null {
  const m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const ref = DateTime.fromISO(today);
  let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : ref.year;
  let d = DateTime.fromObject({ year, month: Number(m[2]), day: Number(m[1]) });
  if (!d.isValid) return null;
  if (!m[3] && d < ref) {
    year += 1;
    d = d.set({ year });
  }
  const tm = s.slice((m.index ?? 0) + m[0].length).match(/(\d{1,2})(?:[:h](\d{2}))?\s*h?/i);
  const time = tm && Number(tm[1]) < 24 ? `${tm[1]!.padStart(2, '0')}:${tm[2] ?? '00'}` : null;
  return { date: d.toISODate()!, time };
}

export function eventPrompt(suggestion: string, extra: string, today: string, weekday: string): string {
  return `Hoje é ${weekday}, ${today} (formato ano-mês-dia). Num grupo de WhatsApp, alguém sugeriu um evento e um admin pediu para agendar.

Sugestão: """${suggestion}"""
${extra ? `Complemento do admin: """${extra}"""\n` : ''}
Extraia os dados do evento. Datas relativas ("sábado", "dia 15", "semana que vem") devem virar a próxima data correspondente a partir de hoje. Se a informação não estiver no texto, use null. Não invente.

Responda só com JSON neste formato:
{"title": "nome curto do evento", "date": "AAAA-MM-DD ou null", "time": "HH:mm ou null", "place": "local ou null", "organizer": "nome de quem organiza, se o texto disser, ou null"}`;
}
