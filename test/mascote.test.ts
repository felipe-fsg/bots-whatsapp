import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { buildPersona, callsMascot } from '../src/features/mascote/index.js';

const ANA = '5511911111111';
const ADMIN = '5511900000001';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

describe('mascote', () => {
  it('reconhece quando chamam o mascote pelo nome', () => {
    expect(callsMascot('Splinter, qual o treino de hoje?', 'Mestre Splinter')).toBe(true);
    expect(callsMascot('mestre splinter me ajuda', 'Mestre Splinter')).toBe(true);
    expect(callsMascot('Mestre, bom dia', 'Mestre Splinter')).toBe(false);
    expect(callsMascot('#ranking', 'Mestre Splinter')).toBe(false);
    expect(callsMascot('o splinter é demais', 'Mestre Splinter')).toBe(false);
    expect(buildPersona('Claro! Aqui está:\n\nVocê é o Seu Madruga...', 'Seu Madruga')).toMatch(/^Você é o Seu Madruga\.\.\.\n\nRegras fixas/);
  });

  it('começa com o Mestre Splinter, admin troca, todos conversam e #mascote padrão volta', async () => {
    w = await world();
    await w.send({ phone: ANA, at: '2026-11-09T12:00:00Z', text: '#mascote' });
    expect(w.wa.last()).toContain('O mascote do grupo é *Mestre Splinter*');

    await w.send({ phone: ANA, at: '2026-11-09T12:01:00Z', text: '#mascote Bob Esponja' });
    expect(w.wa.last()).toContain('Só os admins');

    w.ai.textAnswer = 'Você é Bob Esponja, a esponja mais animada da Fenda do Biquíni.';
    await w.send({ phone: ADMIN, at: '2026-11-09T12:02:00Z', text: '#mascote "Bob Esponja"' });
    expect(w.ai.prompts.at(-2)).toContain('Vamos dar vida a "Bob Esponja"');
    expect(w.wa.last()).toMatch(/^🎭 Novo mascote: \*Bob Esponja\*/);
    const [row] = await w.sql`select persona from bot_mascots`;
    expect(row?.persona).toContain('Regras fixas');

    // conversa: começa a mensagem com o nome do mascote
    w.ai.textAnswer = 'Ana, eu tô pronto! Eu tô pronto! 🧽';
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:03:00Z', text: 'Esponja, você está pronto?' });
    expect(w.ai.prompts.at(-1)).toContain('Ana falou com você no grupo: "Esponja, você está pronto?"');
    expect(w.wa.last()).toBe('Ana, eu tô pronto! Eu tô pronto! 🧽');

    // a motivação usa o mascote novo
    const sent = w.wa.sent.length;
    await w.send({ phone: ANA, at: '2026-11-09T12:04:00Z', text: '#motivação' });
    expect(w.wa.sent.length).toBe(sent + 1);

    // conversa normal não aciona o mascote
    await w.send({ phone: ANA, at: '2026-11-09T12:05:00Z', text: 'bom dia, pessoal' });
    expect(w.wa.sent.length).toBe(sent + 1);

    await w.send({ phone: ADMIN, at: '2026-11-09T12:06:00Z', text: '#mascote padrão' });
    expect(w.wa.last()).toContain('Voltamos ao mascote original: *Mestre Splinter*');
  });
});
