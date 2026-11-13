import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { AvisaClient } from '../src/core/whatsapp/avisa.js';
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

describe('AvisaClient.removeParticipant', () => {
  it('chama /group/update com action remove e falha quando a resposta traz erro', async () => {
    const calls: { url: string; body: any }[] = [];
    let reply: unknown = { status: true, data: { success: true } };
    const fake = (async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(reply));
    }) as unknown as typeof fetch;
    const c = new AvisaClient('https://api.exemplo/api', 'tok', fake);
    await c.removeParticipant('123@g.us', '5511922222222:12@s.whatsapp.net');
    expect(calls[0]).toEqual({
      url: 'https://api.exemplo/api/group/update',
      body: { groupId: '123@g.us', participants: ['5511922222222@s.whatsapp.net'], action: 'remove' },
    });
    reply = { status: true, data: { code: 500, success: true } };
    await expect(c.removeParticipant('123@g.us', '5511922222222')).rejects.toThrow('não removeu');
  });
});

describe('AvisaClient.setAdminsOnly', () => {
  it('tenta as rotas até o grupo mudar e lembra a que funcionou', async () => {
    const calls: string[] = [];
    let announce = false;
    const fake = (async (url: string, init: any) => {
      const path = url.replace('https://api.exemplo/api', '');
      calls.push(`${init.method} ${path}`);
      if (path === '/group/list') return new Response(JSON.stringify({ data: { Groups: [{ JID: '123@g.us', IsAnnounce: announce }] } }));
      if (path === '/group/announce') return new Response('not found', { status: 404 });
      const body = JSON.parse(init.body);
      if (path === '/group/update') announce = body.action === 'announcement';
      return new Response(JSON.stringify({ status: true }));
    }) as unknown as typeof fetch;
    const c = new AvisaClient('https://api.exemplo/api', 'tok', fake);
    await c.setAdminsOnly('123@g.us', true);
    expect(announce).toBe(true);
    expect(calls).toEqual(['POST /group/announce', 'POST /group/update', 'GET /group/list']);
    calls.length = 0;
    await c.setAdminsOnly('123@g.us', false);
    expect(announce).toBe(false);
    expect(calls).toEqual(['POST /group/update', 'GET /group/list']);
  });

  it('falha quando nenhuma rota muda o grupo', async () => {
    const fake = (async (url: string) =>
      url.endsWith('/group/list')
        ? new Response(JSON.stringify({ data: { Groups: [{ JID: '123@g.us', IsAnnounce: false }] } }))
        : new Response(JSON.stringify({ status: true }))) as unknown as typeof fetch;
    const c = new AvisaClient('https://api.exemplo/api', 'tok', fake);
    await expect(c.setAdminsOnly('123@g.us', true)).rejects.toThrow('não mudou o grupo');
  });

  it('diz "unverified" quando a AvisaAPI aceita mas a lista não traz o grupo', async () => {
    const fake = (async (url: string) =>
      url.endsWith('/group/list') ? new Response(JSON.stringify({ data: { Groups: [] } })) : new Response(JSON.stringify({ status: true }))) as unknown as typeof fetch;
    const c = new AvisaClient('https://api.exemplo/api', 'tok', fake);
    const trace: string[] = [];
    expect(await c.setAdminsOnly('123@g.us', true, trace)).toBe('unverified');
    expect(trace).toHaveLength(3);
    expect(trace[0]).toContain('/group/announce: respondeu');
  });
});
