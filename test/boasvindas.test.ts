import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseWhatsmeowEvent } from '../src/core/whatsapp/whatsmeow.js';
import { DEFAULT_WELCOME, prettyPhone } from '../src/features/boasvindas/index.js';
import { GROUP, world, type World } from './helpers.js';

describe('boas-vindas', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });
  afterAll(async () => {
    await w?.sql.end();
  });

  async function join(jids: unknown[]) {
    const msg = parseWhatsmeowEvent({ event: { JID: GROUP, Timestamp: '2026-11-09T12:00:00Z', Join: jids, JoinReason: 'invite' } })!;
    expect(msg.type).toBe('join');
    await w.runtime.handle(w.connectionId, msg, async () => {});
    await w.runtime.idle();
  }

  it('pede a apresentação de quem entra, com o nome se já for conhecido', async () => {
    await join(['5511955556666@s.whatsapp.net']);
    expect(w.wa.last()).toContain('👋 Seja bem-vindo(a)!\n\n+55 11 95555-6666\n\n📸');
    expect(w.wa.last()).toContain('ORIENTAÇÃO SEXUAL:');

    await w.sql`insert into wa_people (connection_id, phone, push_name) values (${w.connectionId}, '5511977778888', 'Carla')`;
    await join([{ User: '5511977778888', Server: 's.whatsapp.net' }]);
    expect(w.wa.last()).toContain('\n\nCarla\n\n');
  });

  it('admin troca, desliga e volta ao padrão', async () => {
    const at = '2026-11-09T12:00:00Z';
    await w.send({ phone: '5511911111111', at, text: '#boasvindas desligar' });
    expect(w.wa.last()).toContain('Só os admins');

    await w.send({ phone: '5511900000001', at, text: '#boasvindas Oi {nome}, se apresenta aí!' });
    await join(['5511955556666@s.whatsapp.net']);
    expect(w.wa.last()).toBe('Oi +55 11 95555-6666, se apresenta aí!');

    await w.send({ phone: '5511900000001', at, text: '#boasvindas desligar' });
    w.wa.clear();
    await join(['5511944445555@s.whatsapp.net']);
    expect(w.wa.sent).toHaveLength(0);

    await w.send({ phone: '5511900000001', at, text: '#boasvindas padrão' });
    await w.send({ phone: '5511900000001', at, text: '#boasvindas ligar' });
    await join(['5511933334444@s.whatsapp.net']);
    expect(w.wa.last()).toBe(DEFAULT_WELCOME.replace('{nome}', '+55 11 93333-4444'));
  });

  it('formata telefones', () => {
    expect(prettyPhone('551155554444')).toBe('+55 11 5555-4444');
    expect(prettyPhone('14155550000')).toBe('+14155550000');
  });
});
