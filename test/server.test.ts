import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { event, world, type World } from './helpers.js';

const SECRET = 'segredo-de-teste-123456';
let w: World;
afterEach(async () => {
  await w?.sql.end();
});

describe('webhook da AvisaAPI', () => {
  it('recusa sem a chave e aceita multipart com a foto', async () => {
    w = await world({ challenge: { require_location: false } });
    const app = buildServer(w.runtime, { secret: SECRET });
    const url = `/webhook/avisa/${w.connectionId}`;

    expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(401);

    const ev = event({ id: 'MP1', phone: '5511911111111', at: '2026-11-09T12:00:00Z', image: { sha: 'mp', caption: '#agua' } });
    const boundary = 'xyz';
    const body =
      `--${boundary}\r\nContent-Disposition: form-data; name="jsonData"\r\n\r\n${JSON.stringify(ev)}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="foto.jpg"\r\nContent-Type: image/jpeg\r\n\r\nFOTO\r\n` +
      `--${boundary}--\r\n`;
    const res = await app.inject({
      method: 'POST',
      url: `${url}?key=${SECRET}`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.json()).toEqual({ ok: true, result: 'handled' });
    await w.runtime.idle();
    const [row] = await w.sql`select status from splinter_checkins where provider_msg_id = 'MP1'`;
    expect(row?.status).toBe('valido');

    const json = await app.inject({ method: 'POST', url: `${url}?key=${SECRET}`, payload: { jsonData: JSON.stringify(event({ phone: '1', at: '2026-11-09T12:00:00Z', chat: 'outro@g.us', text: 'oi' })) } });
    expect(json.json()).toEqual({ ok: true, result: 'ignored' });
    // formulário simples e texto puro também são aceitos
    const ev2 = JSON.stringify(event({ id: 'F1', phone: '5511911111111', at: '2026-11-10T12:00:00Z', text: '#ranking' }));
    const form = await app.inject({ method: 'POST', url: `${url}?key=${SECRET}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ jsonData: ev2 }).toString() });
    expect(form.json()).toEqual({ ok: true, result: 'handled' });
    const ev3 = JSON.stringify(event({ id: 'F2', phone: '5511911111111', at: '2026-11-10T12:00:00Z', text: '#ranking' }));
    const plain = await app.inject({ method: 'POST', url: `${url}?key=${SECRET}`, headers: { 'content-type': 'text/plain' }, payload: ev3 });
    expect(plain.json()).toEqual({ ok: true, result: 'handled' });
    await w.runtime.idle();
    await app.close();
  });
});
