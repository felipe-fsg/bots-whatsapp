import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { ARCANOS, tirarCartas } from '../src/features/tarot/index.js';

const ANA = '5511911111111';
const FELIPE = '5511900000001';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

describe('#tarot', () => {
  it('tira 3 cartas diferentes dos Arcanos Maiores', () => {
    for (let i = 0; i < 50; i++) {
      const cards = tirarCartas();
      expect(cards).toHaveLength(3);
      expect(new Set(cards.map((c) => c.name)).size).toBe(3);
      for (const c of cards) expect(ARCANOS.some((a) => a.name === c.name)).toBe(true);
    }
    // com o sorteio fixo, sai sempre o mesmo jogo
    const fixed = tirarCartas((n) => n - 1);
    expect(fixed.map((c) => c.reversed)).toEqual([true, true, true]);
  });

  it('marca quem pediu, mostra as cartas e a leitura da IA, uma vez por dia', async () => {
    w = await world();
    const mentioned: string[][] = [];
    Object.assign(w.wa, {
      sendTextMentions: async (chat: string, text: string, jids: string[]) => {
        mentioned.push(jids);
        w.wa.sent.push({ chat, text });
      },
    });
    w.ai.textAnswer = 'Ana, o passado foi de coragem... **Vai dar bom!**';

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#Tarôt vou passar no concurso?' });
    const out = w.wa.last();
    expect(out).toContain(`@${ANA} (*Ana*)`);
    expect(out).toContain('Pergunta: _vou passar no concurso?_');
    expect(out.match(/🃏/g)).toHaveLength(3);
    expect(out).toContain('*Vai dar bom!*');
    expect(out).toContain('Só brincadeira');
    expect(mentioned.at(-1)).toEqual([`${ANA}@s.whatsapp.net`]);
    expect(w.ai.prompts.at(-1)).toContain('vou passar no concurso?');
    expect(w.ai.prompts.at(-1)).toContain('Passado:');

    // segunda vez no mesmo dia: as cartas descansam
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T20:00:00Z', text: '#tarot' });
    expect(w.wa.last()).toContain('já falaram com você hoje');

    // no dia seguinte pode de novo, sem pergunta
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-10T12:00:00Z', text: '#tarot' });
    expect(w.wa.last()).toContain('🃏 *Futuro:*');
    expect(w.wa.last()).not.toContain('Pergunta:');
    expect(w.ai.prompts.at(-1)).toContain('leitura geral');
  });

  it('admin não tem limite e, sem IA, a leitura sai com os significados das cartas', async () => {
    w = await world();
    w.ai.textAnswer = '';
    for (let i = 0; i < 3; i++) {
      await w.send({ phone: FELIPE, name: 'Felipe', at: '2026-11-09T12:00:00Z', text: '#tarot' });
      expect(w.wa.last()).toContain('🔮 *Felipe*, embaralhei as cartas');
      expect(w.wa.last()).toContain('Presente: ');
      expect(w.wa.last()).toContain('o universo está do seu lado');
    }
  });
});
