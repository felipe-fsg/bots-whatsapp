import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseWhatsmeowEvent } from '../src/core/whatsapp/whatsmeow.js';
import { DEFAULT_WELCOME, checkMembers, prettyPhone } from '../src/features/boasvindas/index.js';
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

  it('confere a lista de membros: na primeira vez só anota, depois dá boas-vindas a quem é novo', async () => {
    await w.runtime.activeBots();
    const bot = (await w.runtime.activeBots())[0]!;
    const ctx = w.runtime.context(bot);
    w.wa.members = [{ jid: '1@lid', lid: '1@lid', phone: '5511911111111' }];
    await checkMembers(ctx);
    expect(w.wa.sent).toHaveLength(0);

    w.wa.members.push({ jid: '2@lid', lid: '2@lid', phone: '5511922223333' });
    await checkMembers(ctx);
    expect(w.wa.last()).toContain('+55 11 92222-3333');
    await checkMembers(ctx);
    expect(w.wa.sent).toHaveLength(1);

    // saiu e voltou: boas-vindas de novo
    w.wa.members.pop();
    await checkMembers(ctx);
    w.wa.members.push({ jid: '2@lid', lid: '2@lid', phone: '5511922223333' });
    await checkMembers(ctx);
    expect(w.wa.sent).toHaveLength(2);
  });

  it('usa o aviso de histórico compartilhado com quem entrou, sem repetir na conferência', async () => {
    w.wa.members = [{ jid: '9@lid', lid: '9@lid', phone: '5511988887777' }];
    const raw = {
      event: {
        Info: { ID: 'ABC', Chat: GROUP, IsGroup: true, IsFromMe: false, Sender: '5@lid', SenderAlt: '5511900000001@s.whatsapp.net', Timestamp: '2026-11-09T12:00:00Z' },
        Message: { messageHistoryNotice: { messageHistoryMetadata: { historyReceivers: ['9@lid'], messageCount: 100 } } },
      },
    };
    const msg = parseWhatsmeowEvent(raw)!;
    expect(msg).toMatchObject({ type: 'join', joined: ['9@lid'], id: 'join:ABC' });
    await w.runtime.handle(w.connectionId, msg, async () => {});
    await w.runtime.idle();
    expect(w.wa.last()).toContain('+55 11 98888-7777');
    const bot = (await w.runtime.activeBots())[0]!;
    await checkMembers(w.runtime.context(bot));
    expect(w.wa.sent).toHaveLength(1);
  });

  it('formata telefones', () => {
    expect(prettyPhone('551155554444')).toBe('+55 11 5555-4444');
    expect(prettyPhone('14155550000')).toBe('+14155550000');
  });
});
