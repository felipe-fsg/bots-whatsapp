import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { quemFallback } from '../src/features/quem/index.js';

const ANA = '5511911111111';
const BRUNO = '5511922222222';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

describe('#quem', () => {
  it('sorteia outra pessoa do grupo e marca na frase reescrita pela IA', async () => {
    w = await world();
    w.wa.members = [
      { jid: `${ANA}@s.whatsapp.net`, phone: ANA },
      { jid: `${BRUNO}@s.whatsapp.net`, phone: BRUNO },
    ];
    const mentioned: string[][] = [];
    Object.assign(w.wa, {
      sendTextMentions: async (chat: string, text: string, jids: string[]) => {
        mentioned.push(jids);
        w.wa.sent.push({ chat, text });
      },
    });

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#quem' });
    expect(w.wa.last()).toContain('Mande #quem e a pergunta');

    w.ai.textAnswer = '[SORTEADO] vai mandar um ifood para a Ana. 🍔';
    for (let i = 0; i < 5; i++) {
      await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:01:00Z', text: '#Quem vai mandar um ifood pra mim?' });
      expect(w.wa.last()).toBe(`🎲 @${BRUNO} vai mandar um ifood para a Ana. 🍔`);
      expect(mentioned.at(-1)).toEqual([`${BRUNO}@s.whatsapp.net`]);
    }
    expect(w.ai.prompts.at(-1)).toContain('vai mandar um ifood pra mim?');
    expect(w.ai.prompts.at(-1)).toContain('Ana');

    // IA sem o marcador: frase montada pelo bot
    w.ai.textAnswer = 'qualquer coisa';
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:02:00Z', text: '#quem paga a cerveja pra mim?' });
    expect(w.wa.last()).toBe(`🎲 @${BRUNO} paga a cerveja para Ana.`);
  });

  it('sem menções no provedor, manda o nome em negrito', async () => {
    w = await world();
    w.wa.members = [{ jid: `${BRUNO}@s.whatsapp.net`, phone: BRUNO }];
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:00:00Z', text: 'oi' });
    w.ai.textAnswer = '[SORTEADO] vai lavar a louça.';
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:01:00Z', text: '#quem vai lavar a louça?' });
    expect(w.wa.last()).toBe('🎲 *Bruno* vai lavar a louça.');
  });

  it('se a AvisaAPI não devolver o grupo, sorteia entre quem já falou', async () => {
    w = await world();
    w.wa.members = [];
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:00:00Z', text: 'oi' });
    w.ai.textAnswer = '[SORTEADO] vai pagar o açaí.';
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:01:00Z', text: '#quem vai pagar o açaí?' });
    expect(w.wa.last()).toBe('🎲 *Bruno* vai pagar o açaí.');
  });

  it('frase sem IA troca mim/comigo pelo nome', () => {
    expect(quemFallback('vai sair comigo hoje?', 'Felipe')).toBe('[SORTEADO] vai sair com Felipe hoje.');
  });
});
