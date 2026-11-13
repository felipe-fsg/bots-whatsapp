import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { parseCommand } from '../src/modules/splinter/rules.js';

const ANA = '5511911111111';
const BRUNO = '5511922222222';
const ADMIN = '5511900000001';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

const points = async () =>
  (await w.sql`select coalesce(sum(points), 0)::float8 as p from splinter_checkins where challenge_id = ${w.challengeId} and status = 'valido'`)[0]!.p;

describe('comandos', () => {
  it('reconhece #pausar, #despausar, #reiniciar, #sim e #não', () => {
    expect(parseCommand('#pausar')).toEqual({ type: 'pausar', on: true });
    expect(parseCommand('#despausar')).toEqual({ type: 'pausar', on: false });
    expect(parseCommand('#reiniciar')).toEqual({ type: 'reiniciar' });
    expect(parseCommand('#sim')).toEqual({ type: 'confirmar', yes: true });
    expect(parseCommand('#não')).toEqual({ type: 'confirmar', yes: false });
    expect(parseCommand('#nao')).toEqual({ type: 'confirmar', yes: false });
    expect(parseCommand('#simbora')).toBeNull();
  });
});

describe('#pausar e #despausar', () => {
  it('só admin pausa; pausado, foto não pontua; despausado volta a valer', async () => {
    w = await world({ challenge: { require_location: false } });
    await w.send({ phone: ANA, at: '2026-11-09T09:00:00Z', text: '#pausar' });
    expect(w.wa.last()).toContain('Só os admins');

    await w.send({ phone: ADMIN, at: '2026-11-09T09:01:00Z', text: '#pausar' });
    expect(w.wa.last()).toContain('Competição pausada');
    await w.send({ phone: ADMIN, at: '2026-11-09T09:02:00Z', text: '#pausar' });
    expect(w.wa.last()).toContain('já está pausada');

    await w.send({ id: 'P1', phone: ANA, at: '2026-11-09T10:00:00Z', image: { sha: 'p1', caption: '#agua' } });
    expect(w.wa.last()).toContain('está pausada');
    expect((await w.sql`select 1 from splinter_checkins where provider_msg_id = 'P1'`).length).toBe(0);

    await w.send({ phone: ANA, at: '2026-11-09T10:05:00Z', text: '#ranking' });
    expect(w.wa.last()).toContain('Competição pausada');

    await w.send({ phone: ADMIN, at: '2026-11-09T11:00:00Z', text: '#despausar' });
    expect(w.wa.last()).toContain('retomada');
    // a mesma foto pode ser mandada de novo: durante a pausa nada foi gravado
    await w.send({ id: 'P2', phone: ANA, at: '2026-11-09T11:10:00Z', image: { sha: 'p1', caption: '#agua' } });
    expect(await points()).toBe(1);
  });
});

describe('#reiniciar', () => {
  async function scored() {
    w = await world({ challenge: { require_location: false } });
    await w.send({ id: 'C1', phone: ANA, at: '2026-11-09T10:00:00Z', image: { sha: 'c1', caption: '#agua' } });
    await w.send({ id: 'C2', phone: BRUNO, at: '2026-11-09T10:00:00Z', image: { sha: 'c2', caption: '#treino' } });
    expect(await points()).toBe(2);
  }

  it('pergunta 3 vezes e só então zera, guardando backup', async () => {
    await scored();
    await w.send({ phone: ANA, at: '2026-11-09T12:00:00Z', text: '#reiniciar' });
    expect(w.wa.last()).toContain('Só os admins');

    w.now.value = new Date('2026-11-09T12:00:00Z');
    await w.send({ phone: ADMIN, at: '2026-11-09T12:00:00Z', text: '#reiniciar' });
    expect(w.wa.last()).toContain('(1/3)');
    // outra pessoa não responde por ele
    await w.send({ phone: ANA, at: '2026-11-09T12:00:10Z', text: '#sim' });
    expect(w.wa.last()).toContain('Só o admin que mandou');
    await w.send({ phone: ADMIN, at: '2026-11-09T12:00:20Z', text: '#sim' });
    expect(w.wa.last()).toContain('(2/3)');
    await w.send({ phone: ADMIN, at: '2026-11-09T12:00:30Z', text: '#sim' });
    expect(w.wa.last()).toContain('(3/3)');
    expect(await points()).toBe(2);
    await w.send({ phone: ADMIN, at: '2026-11-09T12:00:40Z', text: '#sim' });
    expect(w.wa.last()).toContain('Competição reiniciada');
    expect(w.wa.last()).toContain('2 check-in(s)');
    expect(await points()).toBe(0);

    const [reset] = await w.sql`select checkins, ranking from splinter_resets where challenge_id = ${w.challengeId}`;
    expect(reset!.checkins).toBe(2);
    expect(reset!.ranking).toEqual(expect.arrayContaining([{ name: 'Ana', points: 1 }]));
    expect((await w.sql`select count(*)::int as n from splinter_checkins_arquivo`)[0]!.n).toBe(2);
    expect((await w.sql`select count(*)::int as n from splinter_participants where challenge_id = ${w.challengeId}`)[0]!.n).toBe(3);

    // #sim solto depois não faz nada
    const before = w.wa.sent.length;
    await w.send({ phone: ADMIN, at: '2026-11-09T12:01:00Z', text: '#sim' });
    expect(w.wa.sent.length).toBe(before);

    // foto antiga continua barrada mesmo depois de zerar
    await w.send({ id: 'C3', phone: ANA, at: '2026-11-10T10:00:00Z', image: { sha: 'c1', caption: '#agua' } });
    expect((await w.sql`select reason from splinter_checkins where provider_msg_id = 'C3'`)[0]!.reason).toBe('Foto já usada antes');
  });

  it('#não cancela e o pedido caduca em 5 minutos', async () => {
    await scored();
    w.now.value = new Date('2026-11-09T12:00:00Z');
    await w.send({ phone: ADMIN, at: '2026-11-09T12:00:00Z', text: '#reiniciar' });
    await w.send({ phone: ADMIN, at: '2026-11-09T12:00:10Z', text: '#sim' });
    await w.send({ phone: ADMIN, at: '2026-11-09T12:00:20Z', text: '#não' });
    expect(w.wa.last()).toContain('cancelado');
    expect(await points()).toBe(2);

    await w.send({ phone: ADMIN, at: '2026-11-09T12:01:00Z', text: '#reiniciar' });
    w.now.value = new Date('2026-11-09T12:07:00Z');
    await w.send({ phone: ADMIN, at: '2026-11-09T12:07:00Z', text: '#sim' });
    expect(w.wa.last()).toContain('expirou');
    expect(await points()).toBe(2);
  });
});
