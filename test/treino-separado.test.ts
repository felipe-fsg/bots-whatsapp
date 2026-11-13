import { afterEach, describe, expect, it } from 'vitest';
import { event, world, type World } from './helpers.js';
import { parseWhatsmeowEvent } from '../src/core/whatsapp/whatsmeow.js';
import { clearPending } from '../src/modules/splinter/pendentes.js';
import { findRuleLoose } from '../src/modules/splinter/rules.js';
import type { Rule } from '../src/modules/splinter/types.js';

const ANA = '5511911111111';
const BRUNO = '5511922222222';

let w: World;
afterEach(async () => {
  clearPending();
  await w?.sql.end();
});

const checkin = async (id: string) =>
  (await w.sql`select category, status, photo_sha256 from splinter_checkins where provider_msg_id = ${id}`)[0];
const count = async () => Number((await w.sql`select count(*)::int as n from splinter_checkins`)[0]!.n);

async function sendRaw(raw: unknown, withImage = false) {
  const msg = parseWhatsmeowEvent(raw, withImage ? { data: Buffer.from('foto'), mime: 'image/jpeg' } : undefined)!;
  const r = await w.runtime.handle(w.connectionId, msg, async () => {});
  await w.runtime.idle();
  return r;
}

describe('#treino mandado separado da foto', () => {
  it('foto sem legenda e #treino logo depois viram check-in', async () => {
    w = await world();
    await w.send({ id: 'F1', phone: ANA, at: '2026-11-09T10:00:00Z', image: { sha: 's1' } });
    expect(w.wa.sent).toHaveLength(0);
    await w.send({ phone: ANA, at: '2026-11-09T10:01:00Z', text: '#treino' });
    expect(await checkin('F1')).toMatchObject({ category: 'Treino', photo_sha256: 's1' });
    expect(w.wa.last()).toContain('mande sua localização');
  });

  it('#treino antes da foto também vale', async () => {
    w = await world();
    await w.send({ phone: ANA, at: '2026-11-09T10:00:00Z', text: '#treino' });
    await w.send({ id: 'F2', phone: ANA, at: '2026-11-09T10:00:30Z', image: { sha: 's2' } });
    expect(await checkin('F2')).toMatchObject({ category: 'Treino' });
  });

  it('não junta foto e hashtag de pessoas diferentes nem depois do prazo', async () => {
    w = await world();
    await w.send({ phone: ANA, at: '2026-11-09T10:00:00Z', image: { sha: 's3' } });
    await w.send({ phone: BRUNO, at: '2026-11-09T10:01:00Z', text: '#treino' });
    await w.send({ phone: ANA, at: '2026-11-09T10:30:00Z', text: '#treino' });
    expect(await count()).toBe(0);
  });

  it('resposta à própria foto com #treino', async () => {
    w = await world();
    await w.send({ id: 'F4', phone: ANA, at: '2026-11-09T10:00:00Z', image: { sha: 's4' } });
    await w.send({ phone: BRUNO, at: '2026-11-09T10:02:00Z', text: 'que legal' });
    await w.send({ phone: ANA, at: '2026-11-09T10:03:00Z', text: '#treino', quoted: { id: 'F4', participant: `${ANA}@s.whatsapp.net` } });
    expect(await checkin('F4')).toMatchObject({ category: 'Treino', photo_sha256: 's4' });
  });

  it('resposta a foto que o bot não guardou usa a foto citada', async () => {
    w = await world();
    const raw = event({ phone: ANA, at: '2026-11-09T10:03:00Z', text: '#treino', quoted: { id: 'VELHA', participant: `${ANA}@s.whatsapp.net` } });
    raw.event.Message.extendedTextMessage!.contextInfo!.quotedMessage = { imageMessage: { fileSHA256: 'old' } } as never;
    await sendRaw(raw);
    expect(await checkin('VELHA')).toMatchObject({ category: 'Treino', photo_sha256: 'old' });
  });

  it('não registra resposta com #treino à foto de outra pessoa', async () => {
    w = await world();
    await w.send({ id: 'F5', phone: BRUNO, at: '2026-11-09T10:00:00Z', image: { sha: 's5' } });
    await w.send({ phone: ANA, at: '2026-11-09T10:01:00Z', text: '#treino', quoted: { id: 'F5', participant: `${BRUNO}@s.whatsapp.net` } });
    expect(await count()).toBe(0);
  });

  it('legenda editada para pôr #treino', async () => {
    w = await world();
    await w.send({ id: 'F6', phone: ANA, at: '2026-11-09T10:00:00Z', image: { sha: 's6' } });
    const raw = event({ id: 'EDIT1', phone: ANA, at: '2026-11-09T10:02:00Z', text: 'x' });
    raw.event.Message = {
      protocolMessage: { type: 14, key: { ID: 'F6' }, editedMessage: { imageMessage: { caption: 'treino de hoje #treino' } } },
    } as never;
    await sendRaw(raw);
    expect(await checkin('F6')).toMatchObject({ category: 'Treino', photo_sha256: 's6' });
  });

  it('texto editado não roda comando de novo', async () => {
    w = await world();
    const raw = event({ phone: ANA, at: '2026-11-09T10:02:00Z', text: 'x' });
    raw.event.Message = { protocolMessage: { type: 14, key: { ID: 'T0' }, editedMessage: { conversation: '#ranking' } } } as never;
    await sendRaw(raw);
    expect(w.wa.sent).toHaveLength(0);
  });

  it('aceita variações da hashtag (#Treinos, #treinei)', async () => {
    w = await world();
    await w.send({ id: 'V1', phone: ANA, at: '2026-11-09T10:00:00Z', image: { sha: 'v1', caption: 'bora #Treinos' } });
    await w.send({ id: 'V2', phone: BRUNO, at: '2026-11-09T10:00:00Z', image: { sha: 'v2', caption: '#treinei hoje' } });
    expect(await checkin('V1')).toMatchObject({ category: 'Treino' });
    expect(await checkin('V2')).toMatchObject({ category: 'Treino' });
  });

  it('foto com hashtag não deixa sobra para a próxima foto', async () => {
    w = await world();
    await w.send({ phone: ANA, at: '2026-11-09T10:00:00Z', text: '#agua' });
    await w.send({ id: 'G1', phone: ANA, at: '2026-11-09T10:00:10Z', image: { sha: 'g1', caption: '#agua' } });
    await w.send({ id: 'G2', phone: ANA, at: '2026-11-09T10:01:00Z', image: { sha: 'g2' } });
    expect(await checkin('G1')).toBeTruthy();
    expect(await checkin('G2')).toBeUndefined();
  });
});

describe('findRuleLoose', () => {
  const rule = (hashtag: string, active = true) => ({ hashtag, active }) as Rule;
  const rules = [rule('#treino'), rule('#comida'), rule('#pose'), rule('#agua')];
  it('casa variações claras e evita palpites', () => {
    expect(findRuleLoose('#treinando', rules)?.hashtag).toBe('#treino');
    expect(findRuleLoose('#comidinha', rules)?.hashtag).toBe('#comida');
    expect(findRuleLoose('#poses', rules)?.hashtag).toBe('#pose');
    expect(findRuleLoose('#positivo', rules)).toBeUndefined();
    expect(findRuleLoose('#aguardando', rules)).toBeUndefined();
    expect(findRuleLoose('sem hashtag', rules)).toBeUndefined();
  });
});
