import type { InboundMessage } from '../../core/types.js';

/**
 * Foto e hashtag mandadas separadas: guarda por alguns minutos a última foto sem
 * categoria (e a última hashtag sem foto) de cada pessoa, para juntar as duas.
 * Fica só na memória: se o servidor reiniciar no meio, a pessoa manda de novo.
 */
export const PENDING_MIN = 10;

interface Entry {
  photo?: InboundMessage;
  tag?: { text: string; at: Date };
}

const store = new Map<string, Entry>();

const key = (botId: string, phone: string) => `${botId}|${phone}`;
const fresh = (at: Date, now: Date) => Math.abs(now.getTime() - at.getTime()) <= PENDING_MIN * 60_000;

function cleanup(now: Date) {
  if (store.size < 500) return;
  for (const [k, e] of store) {
    if ((!e.photo || !fresh(e.photo.timestamp, now)) && (!e.tag || !fresh(e.tag.at, now))) store.delete(k);
  }
}

export function rememberPhoto(botId: string, msg: InboundMessage) {
  cleanup(msg.timestamp);
  const e = store.get(key(botId, msg.senderPhone)) ?? {};
  e.photo = msg;
  store.set(key(botId, msg.senderPhone), e);
}

export function rememberTag(botId: string, phone: string, text: string, at: Date) {
  cleanup(at);
  const e = store.get(key(botId, phone)) ?? {};
  e.tag = { text, at };
  store.set(key(botId, phone), e);
}

/** Foto recente sem categoria da pessoa (opcionalmente a de um ID específico). Tira da memória. */
export function takePhoto(botId: string, phone: string, now: Date, id?: string): InboundMessage | undefined {
  const e = store.get(key(botId, phone));
  const p = e?.photo;
  if (!p || (id ? p.id !== id : !fresh(p.timestamp, now))) return undefined;
  delete e.photo;
  return p;
}

/** Hashtag recente mandada sem foto. Tira da memória. */
export function takeTag(botId: string, phone: string, now: Date): string | undefined {
  const e = store.get(key(botId, phone));
  const t = e?.tag;
  if (!t || !fresh(t.at, now)) return undefined;
  delete e.tag;
  return t.text;
}

/** Esquece tudo (testes). */
export function clearPending() {
  store.clear();
}
