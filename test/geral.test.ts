import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';

const AMIGOS = '1203630000000077@g.us';
const ANA = '5511911111111';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

describe('bot geral (grupo de conversa)', () => {
  it('usa agenda, resumo e mascote no mesmo número, sem misturar com o Splinter', async () => {
    w = await world();
    const [t] = await w.sql`select tenant_id from bots limit 1`;
    await w.sql`insert into bots (tenant_id, connection_id, name, module, chat_jid)
      values (${t!.tenant_id}, ${w.connectionId}, 'Rolês da Turma', 'geral', ${AMIGOS})`;
    w.runtime.invalidate();

    await w.send({ phone: ANA, chat: AMIGOS, at: '2026-11-09T12:00:00Z', text: '#ajuda' });
    expect(w.wa.sent.at(-1)).toEqual({ chat: AMIGOS, text: expect.stringContaining('Comandos do Mascote da Turma') });

    await w.send({ phone: ANA, chat: AMIGOS, at: '2026-11-09T12:01:00Z', text: '#mascote' });
    expect(w.wa.last()).toContain('*Mascote da Turma*');

    await w.send({ phone: ANA, chat: AMIGOS, at: '2026-11-09T12:02:00Z', text: '#agenda' });
    expect(w.wa.last()).toContain('Nenhum evento');

    // foto com #treino no grupo de amigos não vira check-in
    const before = w.wa.sent.length;
    await w.send({ phone: ANA, chat: AMIGOS, at: '2026-11-09T12:03:00Z', image: { sha: 'g1', caption: '#treino' } });
    expect(w.wa.sent.length).toBe(before);
    const [n] = await w.sql`select count(*)::int as n from splinter_checkins`;
    expect(n?.n).toBe(0);

    // o Splinter continua com o mascote dele
    await w.send({ phone: ANA, at: '2026-11-09T12:04:00Z', text: '#mascote' });
    expect(w.wa.sent.at(-1)).toEqual({ chat: expect.stringContaining('886664'), text: expect.stringContaining('Mestre Splinter') });
  });
});
