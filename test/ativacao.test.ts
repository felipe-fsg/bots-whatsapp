import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/db.js';
import { Runtime } from '../src/core/runtime.js';
import { parseAtivacao, parseBotType } from '../src/core/ativacao.js';
import { normalizeCommand } from '../src/core/commands.js';
import { parseWhatsmeowEvent } from '../src/core/whatsapp/whatsmeow.js';
import { modules } from '../src/modules/index.js';
import { features } from '../src/features/index.js';
import { event, FakeAi, FakePlaces, FakeWhatsApp, freshDb, type EventInput } from './helpers.js';

const NOVO = '120363555555555555@g.us';
const DONO = '5511977776666';
const BOT = '5511900000000';

describe('parse do #ativarbot', () => {
  it('entende os tipos e os sinônimos', () => {
    const p = (t: string) => parseAtivacao(normalizeCommand(t));
    expect(p('#ativarbot duvidas técnicas')).toEqual({ action: 'ativar', module: 'tecnico', typed: 'duvidas técnicas' });
    expect(p('#HabilitarBot Social')).toMatchObject({ module: 'geral' });
    expect(p('#ativar bot fitness')).toMatchObject({ module: 'splinter' });
    expect(p('#ativarbot')).toEqual({ action: 'ativar', module: null, typed: '' });
    expect(p('#ativarbot xyz')).toMatchObject({ module: null, typed: 'xyz' });
    expect(p('#desativarbot')).toEqual({ action: 'desativar' });
    expect(p('#desabilitarbot')).toEqual({ action: 'desativar' });
    expect(p('#ativar treino')).toBeNull(); // comando do Splinter, não é este
    expect(p('#ativarbots')).toBeNull();
    expect(parseBotType('Dúvidas Técnicas')).toBe('tecnico');
  });
});

describe('#ativarbot no grupo', () => {
  let sql: Sql;
  let wa: FakeWhatsApp;
  let runtime: Runtime;
  let conn: string;
  let tenant: string;
  const at = new Date('2026-11-24T12:00:00Z');

  beforeEach(async () => {
    sql = await freshDb();
    wa = new FakeWhatsApp();
    const [t] = await sql`insert into tenants (name) values ('Felipe') returning id`;
    tenant = t!.id;
    const [c] = await sql`insert into wa_connections (label, token_env) values ('Número do Felipe', 'AVISA_TOKEN_TESTE') returning id`;
    conn = c!.id;
    await sql`insert into bots (tenant_id, connection_id, name, module, chat_jid) values (${tenant}, ${conn}, 'Outro', 'geral', '120363000000000000@g.us')`;
    runtime = new Runtime({
      sql,
      modules,
      features,
      ai: new FakeAi(),
      places: new FakePlaces(),
      log: { info() {}, warn() {}, error: (o) => console.error(o) },
      now: () => at,
      providerFor: () => wa,
      env: { BOT_DONOS: DONO },
    });
  });
  afterEach(async () => {
    await sql.end();
  });

  async function send(e: Omit<EventInput, 'at'> & { fromMe?: boolean }) {
    const ev = event({ chat: NOVO, at: at.toISOString(), ...e });
    if (e.fromMe) ev.event.Info.IsFromMe = true;
    const r = await runtime.handle(conn, parseWhatsmeowEvent(ev)!);
    await runtime.idle();
    return r;
  }
  const botRow = async () => (await sql`select * from bots where chat_jid = ${NOVO}`)[0];

  it('o número do bot liga um grupo novo como social, com os admins do grupo', async () => {
    wa.members = [
      { jid: `${BOT}@s.whatsapp.net`, phone: BOT, admin: true, name: 'Felipe' },
      { jid: '5511955554444@s.whatsapp.net', phone: '5511955554444', admin: true, name: 'Carla' },
      { jid: '5511944443333@s.whatsapp.net', phone: '5511944443333', admin: false, name: 'Zé' },
      { jid: '123456789012345@lid', phone: '123456789012345', admin: true },
    ];
    expect(await send({ phone: BOT, name: 'Felipe', text: '#ativarbot social', fromMe: true })).toBe('handled');
    const b = await botRow();
    expect(b).toMatchObject({ module: 'geral', active: true, tenant_id: tenant, name: 'Bot social' });
    const admins = await sql`select phone from bot_admins where bot_id = ${b!.id} order by phone`;
    expect(admins.map((a) => a.phone)).toEqual([BOT, '5511955554444']);
    expect(wa.last()).toContain('*social*');
    expect(wa.last()).toContain('admins do grupo no WhatsApp');

    // daqui em diante o grupo é atendido pelo módulo
    wa.clear();
    await send({ phone: '5511944443333', text: '#agenda' });
    expect(wa.last().toLowerCase()).toContain('agenda');
  });

  it('o dono do .env troca o tipo, e repetir o mesmo tipo só avisa', async () => {
    await send({ phone: DONO, text: '#habilitarbot fitness' });
    expect(await botRow()).toMatchObject({ module: 'splinter', active: true });
    expect(wa.last()).toContain('falta cadastrar o desafio');

    await send({ phone: DONO, text: '#ativarbot fitness' });
    expect(wa.last()).toContain('já está ligado');

    await send({ phone: DONO, text: '#ativarbot dúvidas técnicas' });
    expect(await botRow()).toMatchObject({ module: 'tecnico', name: 'Dúvidas técnicas' });
    expect(wa.last()).toContain('antes era *fitness*');
    expect(wa.last()).toContain('sêniores');
  });

  it('#desativarbot desliga e #ativarbot liga de novo', async () => {
    await send({ phone: DONO, text: '#ativarbot social' });
    await send({ phone: DONO, text: '#desativarbot' });
    expect(await botRow()).toMatchObject({ active: false });
    expect(wa.last()).toContain('desligado');

    wa.clear();
    expect(await send({ phone: '5511944443333', text: '#agenda' })).toBe('ignored');
    expect(wa.sent).toHaveLength(0);

    await send({ phone: DONO, text: '#desativarbot' });
    expect(wa.last()).toContain('já está desligado');
    await send({ phone: DONO, text: '#ativarbot social' });
    expect(await botRow()).toMatchObject({ active: true });
  });

  it('sem tipo ou com tipo desconhecido, mostra as opções', async () => {
    await send({ phone: DONO, text: '#ativarbot' });
    expect(wa.last()).toContain('Falta dizer o tipo');
    await send({ phone: DONO, text: '#ativarbot cachorro' });
    expect(wa.last()).toContain('Não entendi o tipo "cachorro"');
    expect(wa.last()).toContain('#ativarbot duvidas tecnicas');
    expect(await botRow()).toBeUndefined();
  });

  it('o número do bot e os donos rodam comandos de admin (#promover) no grupo ativado', async () => {
    await send({ phone: BOT, name: 'Felipe', text: '#ativarbot social', fromMe: true });
    const b = await botRow();
    // o eco da resposta do próprio bot (também chega como fromMe) não é tratado como comando
    wa.clear();
    expect(await send({ phone: BOT, text: '#agenda', fromMe: true })).toBe('handled');
    expect(wa.last().toLowerCase()).toContain('agenda');
    const echo = wa.last();
    wa.clear();
    expect(await send({ phone: BOT, text: echo, fromMe: true })).toBe('ignored');
    // conversa normal digitada no número do bot continua ignorada
    expect(await send({ phone: BOT, text: 'oi gente', fromMe: true })).toBe('ignored');

    await send({ phone: BOT, text: '#promover 11 95555-4444', fromMe: true });
    expect(wa.last()).toContain('agora é admin');
    // dono do BOT_DONOS, sem estar na lista de admins do grupo
    await send({ phone: DONO, text: '#promover 11 94444-3333' });
    expect(wa.last()).toContain('agora é admin');
    const admins = await sql`select phone from bot_admins where bot_id = ${b!.id} order by phone`;
    expect(admins.map((a) => a.phone)).toEqual(expect.arrayContaining(['5511955554444', '5511944443333']));
    // quem não é admin continua barrado
    await send({ phone: '5511933332222', text: '#promover 11 92222-1111' });
    expect(wa.last()).toContain('Só os admins');
  });

  it('admins do grupo no WhatsApp são admins do bot, inclusive com número escondido (LID)', async () => {
    await send({ phone: DONO, text: '#ativarbot social' });
    wa.members = [
      { jid: '5511966665555@s.whatsapp.net', phone: '5511966665555', admin: true, name: 'Gabi' },
      { jid: '999888777666555@lid', lid: '999888777666555@lid', phone: '999888777666555', admin: true },
      { jid: '5511933332222@s.whatsapp.net', phone: '5511933332222', admin: false },
    ];
    await sql`insert into wa_contacts (connection_id, lid, phone) values (${conn}, '999888777666555@lid', '5511988887777')`;
    await send({ phone: '5511966665555', text: '#promover 11 91111-0000' });
    expect(wa.last()).toContain('agora é admin');
    await send({ phone: '5511988887777', text: '#promover 11 91111-2222' });
    expect(wa.last()).toContain('agora é admin');
    await send({ phone: '5511933332222', text: '#promover 11 91111-3333' });
    expect(wa.last()).toContain('Só os admins');
  });

  it('ignora quem não é o dono', async () => {
    expect(await send({ phone: '5511944443333', text: '#ativarbot social' })).toBe('ignored');
    expect(wa.sent).toHaveLength(0);
    expect(await botRow()).toBeUndefined();
  });

  it('não processa a mesma mensagem duas vezes', async () => {
    await send({ id: 'DUP1', phone: DONO, text: '#ativarbot social' });
    await send({ id: 'DUP1', phone: DONO, text: '#ativarbot social' });
    expect(wa.sent).toHaveLength(1);
  });
});
