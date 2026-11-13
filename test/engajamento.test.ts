import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';

const ANA = '5511911111111';
const BRUNO = '5511922222222';
const CAIO = '5511933333333';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

describe('ranking #engajamento', () => {
  it('conta mensagens de texto, foto e localização e mostra em ordem, com empates', async () => {
    w = await world();
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#engajamento' });
    // o próprio comando já conta
    expect(w.wa.last()).toContain('Ana: 1 mensagem');

    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:01:00Z', text: 'bom dia' });
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:02:00Z', image: { sha: 'abc' } });
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:03:00Z', location: { lat: -23.5, lng: -46.6 } });
    await w.send({ phone: CAIO, name: 'Caio', at: '2026-11-09T12:04:00Z', text: 'oi' });
    w.wa.clear();
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:05:00Z', text: '#Engajamento' });
    const r = w.wa.sent.find((s) => s.text.includes('Ranking de engajamento'))!.text;
    expect(r).toContain('🥇 Bruno: 3 mensagens');
    expect(r).toContain('🥈 Ana: 2 mensagens');
    expect(r).toContain('🥉 Caio: 1 mensagem');
    expect(r).toContain('desde 09/11');
    expect(r).toContain('Total: 6 mensagens de 3 pessoas');

    await w.send({ phone: CAIO, name: 'Caio', at: '2026-11-09T12:06:00Z', text: 'tudo bem?' });
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:07:00Z', text: '!engajamento' });
    // Ana 3, Bruno 3 empatados em 1º; Caio 2 em 3º
    expect(w.wa.last()).toMatch(/🥇 (Ana|Bruno): 3[\s\S]*🥇 (Ana|Bruno): 3[\s\S]*🥉 Caio: 2/);
  });

  it('mensagem repetida (mesmo id) conta uma vez só', async () => {
    w = await world();
    await w.send({ id: 'X1', phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:01:00Z', text: 'oi' });
    await w.send({ id: 'X1', phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:01:00Z', text: 'oi' });
    const [row] = await w.sql<{ messages: number }[]>`select messages from member_message_counts`;
    expect(row!.messages).toBe(1);
  });

  it('não conta nem responde no grupo técnico', async () => {
    w = await world();
    await w.sql`update bots set module = 'tecnico' where id = ${w.botId}`;
    w.runtime.invalidate();
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#engajamento' });
    expect(w.wa.sent.some((s) => s.text.includes('engajamento'))).toBe(false);
    expect(await w.sql`select 1 from member_message_counts`).toHaveLength(0);
  });
});
