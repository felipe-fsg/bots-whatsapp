import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';

const ANA = '5511911111111';
const BRUNO = '5511922222222';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

describe('#estadocivil e #pista', () => {
  it('grava, troca, apaga e lista com comentário do mascote', async () => {
    w = await world();
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#pista' });
    expect(w.wa.last()).toContain('pista está vazia');

    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:01:00Z', text: '#EstadoCivil Solteiro' });
    expect(w.wa.last()).toContain('*Bruno*: Solteiro');
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:02:00Z', text: '#estadocivil casada' });
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:03:00Z', text: '#estado civil solteiro' });

    w.ai.textAnswer = 'A pista está bombando, galera! 💃';
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:04:00Z', text: '#Pista' });
    const list = w.wa.last();
    expect(list).toContain('(2)');
    expect(list).toContain('• Ana: solteiro');
    expect(list).not.toContain('casada');
    expect(list.indexOf('• Ana')).toBeLessThan(list.indexOf('• Bruno'));
    expect(list).toContain('A pista está bombando');
    expect(w.ai.prompts.at(-1)).toContain('- solteiro: 2'); // agrupa "Solteiro" e "solteiro"
    expect(w.ai.prompts.at(-1)).not.toContain('Ana');

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:05:00Z', text: '#estadocivil apagar' });
    expect(w.wa.last()).toContain('saiu da lista');
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:06:00Z', text: '#estadocivil ' + 'x'.repeat(50) });
    expect(w.wa.last()).toContain('Resume aí');
  });
});
