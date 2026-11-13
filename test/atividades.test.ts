import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { parseCommand } from '../src/modules/splinter/rules.js';
import { resolveTarget } from '../src/modules/splinter/atividades.js';
import type { Rule } from '../src/modules/splinter/types.js';

const ANA = '5511911111111';
const ADMIN = '5511900000001';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

const status = async (id: string) => (await w.sql`select status, points::float8 as points from splinter_checkins where provider_msg_id = ${id}`)[0];

describe('comandos', () => {
  it('lê #ativar e #desativar sem confundir com #ativarBAN', () => {
    expect(parseCommand('#desativar #pose, cardio')).toEqual({ type: 'ativar', on: false, names: ['pose', 'cardio'] });
    expect(parseCommand('#ativar hidratação')).toEqual({ type: 'ativar', on: true, names: ['hidratação'] });
    expect(parseCommand('#ativarBAN')).toBeNull();
    expect(parseCommand('#atividades')).toEqual({ type: 'atividades' });
  });

  it('acha a atividade pela hashtag, pelo nome ou pelo tipo', () => {
    const rules = [
      { id: 1, category: 'Treino', hashtag: '#treino', kind: 'treino' },
      { id: 2, category: 'Hidratação', hashtag: '#agua', kind: 'outro' },
      { id: 3, category: 'Pose do dia', hashtag: '#pose', kind: 'pose' },
    ] as Rule[];
    const id = (n: string) => {
      const t = resolveTarget(n, rules);
      return t && 'rule' in t ? t.rule.id : t?.extra.flag;
    };
    expect(id('agua')).toBe(2);
    expect(id('Hidratacao')).toBe(2);
    expect(id('pose')).toBe(3);
    expect(id('resumo')).toBe('daily_summary');
    expect(id('localização')).toBe('require_location');
    expect(id('xyz')).toBeUndefined();
  });
});

describe('#ativar / #desativar no grupo', () => {
  it('só admin muda; atividade desativada não pontua e o bot avisa', async () => {
    w = await world({ challenge: { require_location: false } });

    await w.send({ phone: ANA, at: '2026-11-09T10:00:00Z', text: '#desativar pose' });
    expect(w.wa.last()).toContain('Só os admins');

    await w.send({ phone: ADMIN, at: '2026-11-09T10:01:00Z', text: '#desativar pose cardio banana' });
    expect(w.wa.last()).toContain('Desativado: Pose do dia (#pose), Cardio (#cardio)');
    expect(w.wa.last()).toContain('Não conheço: banana');

    await w.send({ id: 'C1', phone: ANA, at: '2026-11-09T10:02:00Z', image: { sha: 'h1', caption: '#cardio corrida' } });
    expect(await status('C1')).toBeUndefined();
    expect(w.wa.last()).toContain('*Cardio* está desativada');

    await w.send({ phone: ADMIN, at: '2026-11-09T10:03:00Z', text: '#atividades' });
    expect(w.wa.last()).toContain('⛔ #cardio - Cardio');
    expect(w.wa.last()).toContain('✅ #treino - Treino');

    await w.send({ phone: ADMIN, at: '2026-11-09T10:04:00Z', text: '#ativar cardio' });
    expect(w.wa.last()).toContain('Ativado: Cardio');
    await w.send({ id: 'C2', phone: ANA, at: '2026-11-09T10:05:00Z', image: { sha: 'h2', caption: '#cardio' } });
    expect(await status('C2')).toMatchObject({ status: 'valido', points: 1 });

    const regras = (await w.send({ phone: ANA, at: '2026-11-09T10:06:00Z', text: '#regras' }), w.wa.last());
    expect(regras).not.toContain('#pose -');
  });

  it('desliga o resumo das 4h e a localização do treino', async () => {
    w = await world();
    await w.send({ phone: ADMIN, at: '2026-11-09T10:00:00Z', text: '#desativar resumo localização' });
    const [ch] = await w.sql`select daily_summary, require_location from splinter_challenges where id = ${w.challengeId}`;
    expect(ch).toMatchObject({ daily_summary: false, require_location: false });

    await w.send({ id: 'T1', phone: ANA, at: '2026-11-09T10:01:00Z', image: { sha: 'h1', caption: '#treino' } });
    expect(await status('T1')).toMatchObject({ status: 'valido' });

    await w.send({ phone: ADMIN, at: '2026-11-09T10:02:00Z', text: '#desativar resumo' });
    expect(w.wa.last()).toContain('Já estava desativado: Resumo diário das 4h');
  });
});
