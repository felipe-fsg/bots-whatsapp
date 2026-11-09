import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { resumo } from '../src/features/resumo/index.js';

const ANA = '5511911111111';
const BRUNO = '5511922222222';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

describe('#resumo', () => {
  it('resume as mensagens de hoje, ignora comandos e apaga as antigas', async () => {
    w = await world({ challenge: { status: 'encerrado' } });
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-08T20:00:00Z', text: 'mensagem de ontem' });
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T11:00:00Z', text: 'Gente, o churrasco vai ser no sábado?' });
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T11:05:00Z', text: 'Sim, 13h na casa do Erick' });
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T11:06:00Z', text: '#ranking' });
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T11:07:00Z', location: { lat: -23.5, lng: -46.6 } });
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T11:08:00Z', image: { sha: 'r1', caption: 'olha a vista' } });

    w.now.value = new Date('2026-11-09T15:00:00Z'); // 12h em SP
    w.ai.textAnswer = 'Meus alunos, eis o que rolou:\n🍖 **Churrasco** sábado 13h na casa do Erick (Bruno).';
    await w.send({ phone: ANA, at: '2026-11-09T15:00:00Z', text: '#resumo' });

    const prompt = w.ai.prompts.at(-1)!;
    expect(prompt).toContain('de hoje (09/11) até as 12:00');
    expect(prompt).toContain('08:00 Ana: Gente, o churrasco vai ser no sábado?');
    expect(prompt).toContain('08:07 Bruno: [localização]');
    expect(prompt).toContain('08:08 Ana: [foto] olha a vista');
    expect(prompt).not.toContain('#ranking');
    expect(prompt).not.toContain('mensagem de ontem');
    expect(prompt).not.toContain('-23.5');
    expect(w.wa.last()).toBe('📝 *Resumo de hoje (09/11) até as 12:00* (4 mensagens)\n\nMeus alunos, eis o que rolou:\n🍖 *Churrasco* sábado 13h na casa do Erick (Bruno).');

    await w.send({ phone: ANA, at: '2026-11-09T15:01:00Z', text: '#resumo ontem' });
    expect(w.wa.last()).toContain('Quase não teve conversa ontem');

    // depois de 3 dias as mensagens são apagadas
    await w.sql`update group_messages set sent_at = sent_at - interval '4 days' where text like 'Gente%'`;
    await resumo.jobs![0]!.run(w.runtime.context((await w.runtime.activeBots())[0]!));
    const [n] = await w.sql`select count(*)::int as n from group_messages where text like 'Gente%'`;
    expect(n?.n).toBe(0);
  });
});
