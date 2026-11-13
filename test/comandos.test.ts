import { afterEach, describe, expect, it } from 'vitest';
import { normalizeCommand } from '../src/core/commands.js';
import { hashtags } from '../src/modules/splinter/rules.js';
import { world, type World } from './helpers.js';

const ANA = '5511911111111';
const ADMIN = '5511900000001';

describe('comandos sem diferença de maiúsculas e acentos', () => {
  it('normaliza só a primeira palavra quando ela é um comando', () => {
    expect(normalizeCommand('#Ranking')).toBe('#ranking');
    expect(normalizeCommand('#NÃOCURIAR')).toBe('#naocuriar');
    expect(normalizeCommand('!Motivação')).toBe('!motivacao');
    expect(normalizeCommand('/Corrigir A Pressão é -0,81')).toBe('/corrigir A Pressão é -0,81');
    expect(normalizeCommand('#Mascote Mestre Splinter')).toBe('#mascote Mestre Splinter');
    expect(normalizeCommand('?Açaí')).toBe('?Açaí');
    expect(normalizeCommand('Bom dia #Treino')).toBe('Bom dia #Treino');
  });

  it('hashtags da legenda ignoram maiúsculas e acentos', () => {
    expect(hashtags('Hoje #Hidratação e #TREINO')).toEqual(['#hidratacao', '#treino']);
  });

  let w: World;
  afterEach(async () => {
    await w?.sql.end();
  });

  it('aceita comandos em maiúsculas e sem acento', async () => {
    w = await world();
    await w.send({ phone: ANA, at: '2026-11-09T10:00:00Z', text: '#RANKING' });
    expect(w.wa.last()).toContain('Ranking');
    await w.send({ phone: ANA, at: '2026-11-09T10:01:00Z', text: '#Regras' });
    expect(w.wa.last()).toContain('Como fazer check-in');
    await w.send({ phone: ADMIN, at: '2026-11-09T10:02:00Z', text: '#ATIVIDADES' });
    expect(w.wa.last()).toContain('#treino');
    await w.send({ phone: ANA, at: '2026-11-09T10:03:00Z', image: { sha: 'x1', caption: 'bora #Treino' } });
    expect(w.wa.last()).toContain('localização');
  });
});
