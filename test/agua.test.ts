import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/db.js';
import { Runtime } from '../src/core/runtime.js';
import { parseWhatsmeowEvent } from '../src/core/whatsapp/whatsmeow.js';
import { buildServer } from '../src/server.js';
import { modules } from '../src/modules/index.js';
import { features } from '../src/features/index.js';
import { aguaDeps } from '../src/modules/agua/index.js';
import { parseBotType } from '../src/core/ativacao.js';
import { event, FakeAi, FakePlaces, FakeWhatsApp, freshDb, type EventInput } from './helpers.js';

const GRUPO = '120363777777777777@g.us';
const KEY = 'chave-do-sistema-de-laudos-123';
const ADMIN = '5511900000001';
const auth = { authorization: `Bearer ${KEY}` };

/** WhatsApp falso que devolve o id da mensagem enviada (para o #aprovar em resposta). */
class FakeWaIds extends FakeWhatsApp {
  n = 0;
  async sendTextWithId(chat: string, text: string) {
    await this.sendText(chat, text);
    return `BOT${++this.n}`;
  }
}

let sql: Sql;
let wa: FakeWaIds;
let runtime: Runtime;
let conn: string;
let botId: string;
let calls: { url: string; body: any; auth: string }[];
let callbackStatus: number;
let app: ReturnType<typeof buildServer>;

beforeEach(async () => {
  sql = await freshDb();
  wa = new FakeWaIds();
  const [t] = await sql`insert into tenants (name) values ('GSS') returning id`;
  const [c] = await sql`insert into wa_connections (label, token_env) values ('Número', 'AVISA_TOKEN_TESTE') returning id`;
  conn = c!.id;
  const [b] = await sql`insert into bots (tenant_id, connection_id, name, module, chat_jid)
    values (${t!.id}, ${conn}, 'Qualidade da água', 'agua', ${GRUPO}) returning id`;
  botId = b!.id;
  await sql`insert into bot_admins (bot_id, phone, name) values (${botId}, ${ADMIN}, 'Emerson')`;
  runtime = new Runtime({
    sql,
    modules,
    features,
    ai: new FakeAi(),
    places: new FakePlaces(),
    log: { info() {}, warn() {}, error: (o) => console.error(o) },
    now: () => new Date('2026-11-24T12:00:00Z'),
    providerFor: () => wa,
  });
  app = buildServer(runtime, { secret: 'segredo-de-teste-123456', aguaKey: KEY });
  calls = [];
  callbackStatus = 200;
  aguaDeps.fetch = (async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
    return new Response('{}', { status: callbackStatus });
  }) as unknown as typeof fetch;
  aguaDeps.key = () => KEY;
});
afterEach(async () => {
  await app.close();
  await sql.end();
});

async function send(e: Omit<EventInput, 'at' | 'chat'>) {
  const r = await runtime.handle(conn, parseWhatsmeowEvent(event({ chat: GRUPO, at: '2026-11-24T12:00:00Z', ...e }))!);
  await runtime.idle();
  return r;
}
const post = (payload: object, headers: Record<string, string> = auth) =>
  app.inject({ method: 'POST', url: '/api/agua/laudos', headers, payload });
const status = (id: string) => app.inject({ method: 'GET', url: `/api/agua/laudos/${id}`, headers: auth });

describe('bot de qualidade da água', () => {
  it('recusa sem a chave e com dados inválidos', async () => {
    expect((await post({ id: 'L1', resultado: 'satisfatorio' }, {})).statusCode).toBe(401);
    expect((await post({ id: 'L1', resultado: 'satisfatorio' }, { authorization: 'Bearer errada' })).statusCode).toBe(401);
    const bad = await post({ id: 'L1', resultado: 'talvez' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().campos).toContain('resultado');
    const off = buildServer(runtime, { secret: 'segredo-de-teste-123456' });
    expect((await off.inject({ method: 'POST', url: '/api/agua/laudos', headers: auth, payload: {} })).statusCode).toBe(503);
    await off.close();
    expect(wa.sent).toHaveLength(0);
  });

  it('laudo satisfatório: posta, admin aprova respondendo, sistema recebe o webhook e consulta o status', async () => {
    const res = await post({
      id: 'L-2026-001',
      resultado: 'Satisfatório',
      cliente: 'Clínica Rim Feliz',
      equipamento: 'Osmose reversa OR-02',
      parametros: [{ nome: 'Bactérias', valor: '12 UFC/mL', limite: '100', ok: true }],
      link: 'https://exemplo.com/laudo.pdf',
      callback_url: 'https://sistema.exemplo/retorno',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true, novo: true, laudo: { id: 'L-2026-001', resultado: 'satisfatorio', status: 'pendente' } });
    expect(wa.last()).toContain('Laudo satisfatório');
    expect(wa.last()).toContain('Clínica Rim Feliz');
    expect(wa.last()).toContain('Bactérias: 12 UFC/mL (limite 100)');
    expect(wa.last()).toContain('#aprovar');

    // repetir o envio não posta de novo
    const again = await post({ id: 'L-2026-001', resultado: 'satisfatorio' });
    expect(again.statusCode).toBe(200);
    expect(again.json().novo).toBe(false);
    expect(wa.sent).toHaveLength(1);

    // quem não é admin não aprova
    await send({ phone: '5511944443333', text: '#aprovar', quoted: { id: 'BOT1', participant: '5511900000000@s.whatsapp.net' } });
    expect(wa.last()).toContain('Só os admins');
    expect(calls).toHaveLength(0);

    await send({ phone: ADMIN, name: 'Emerson', text: '#Aprovar', quoted: { id: 'BOT1', participant: '5511900000000@s.whatsapp.net' } });
    expect(wa.last()).toContain('L-2026-001* aprovado por Emerson');
    expect(wa.last()).toContain('email do cliente');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: 'https://sistema.exemplo/retorno',
      auth: `Bearer ${KEY}`,
      body: { id: 'L-2026-001', status: 'aprovado', decidido_por: 'Emerson', motivo: null },
    });

    const st = await status('L-2026-001');
    expect(st.json().laudo).toMatchObject({ status: 'aprovado', decidido_por: 'Emerson', retorno: 'ok', decidido_em: '2026-11-24T12:00:00.000Z' });

    // decidir de novo só avisa
    await send({ phone: ADMIN, text: '#recusar', quoted: { id: 'BOT1', participant: '5511900000000@s.whatsapp.net' } });
    expect(wa.last()).toContain('já foi aprovado');
    expect(calls).toHaveLength(1);
    expect((await status('NAO-EXISTE')).statusCode).toBe(404);
  });

  it('laudo insatisfatório: alerta, recusa pelo código com motivo, e sem endereço de retorno só fica a consulta', async () => {
    await post({ id: 'L9', resultado: 'insatisfatorio', cliente: 'Hospital X', resumo: 'Endotoxina acima do limite.' });
    await post({ id: 'L10', resultado: 'satisfatorio', cliente: 'Clínica Y' });
    expect(wa.sent[0]!.text).toContain('ALERTA');
    expect(wa.sent[0]!.text).toContain('recoleta');

    // com dois pendentes, sem resposta nem código, pede para escolher
    await send({ phone: ADMIN, text: '#recusar' });
    expect(wa.last()).toContain('2 laudos pendentes');

    await send({ phone: ADMIN, text: '#pendentes' });
    expect(wa.last()).toContain('*L9* Hospital X');
    expect(wa.last()).toContain('*L10* Clínica Y');

    await send({ phone: ADMIN, name: 'Emerson', text: '#recusar l9 aguardar contraprova' });
    expect(wa.last()).toContain('L9* recusado por Emerson. Motivo: aguardar contraprova');
    expect(calls).toHaveLength(0); // sem callback_url nem AGUA_CALLBACK_URL
    expect((await status('L9')).json().laudo).toMatchObject({ status: 'recusado', motivo: 'aguardar contraprova', retorno: null });

    // agora só sobra um: #aprovar sozinho decide esse
    await send({ phone: ADMIN, text: '#aprovar' });
    expect(wa.last()).toContain('L10* aprovado');
  });

  it('avisa no grupo quando o retorno ao sistema falha', async () => {
    callbackStatus = 500;
    await post({ id: 'L5', resultado: 'insatisfatorio', callback_url: 'https://sistema.exemplo/retorno' });
    await send({ phone: ADMIN, text: '#aprovar', quoted: { id: 'BOT1', participant: '5511900000000@s.whatsapp.net' } });
    expect(wa.last()).toContain('encerrar a OS');
    expect(wa.last()).toContain('Não consegui avisar o sistema');
    expect((await status('L5')).json().laudo.retorno).toBe('falhou: HTTP 500');
  });

  it('#ativarbot entende "qualidade agua"', () => {
    expect(parseBotType('qualidade água')).toBe('agua');
    expect(parseBotType('laudos')).toBe('agua');
  });
});
