import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { matchEvent, parseExplicit, parseWhen } from '../src/features/agenda/parse.js';
import { agenda } from '../src/features/agenda/index.js';

const ANA = '5511911111111';
const BRUNO = '5511922222222';
const ADMIN = '5511900000001';
const NAO_INSCRITO = '5511955555555';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

describe('leitura de datas e nomes', () => {
  it('entende o formato direto e acha o evento pelo nome', () => {
    expect(parseWhen('15/11 19h', '2026-11-09')).toEqual({ date: '2026-11-15', time: '19:00' });
    expect(parseWhen('05/01 às 8:30', '2026-11-09')).toEqual({ date: '2027-01-05', time: '08:30' });
    expect(parseExplicit('Trilha da Pedra Grande | 15/11 7h | Atibaia', '2026-11-09')).toMatchObject({ title: 'Trilha da Pedra Grande', place: 'Atibaia' });
    const evs = [{ title: 'Trilha da Pedra Grande' }, { title: 'Churrasco' }];
    expect(matchEvent(evs, '"trilha"')).toEqual(evs[0]);
    expect(matchEvent(evs, 'trilha')).toEqual(evs[0]);
    expect(matchEvent(evs, 'CHURRÁSCO')).toEqual(evs[1]);
    expect(matchEvent([evs[1]!], '')).toEqual(evs[1]);
  });
});

describe('agenda do grupo', () => {
  it('admin agenda a sugestão, pessoas confirmam, evento passado some', async () => {
    w = await world({ challenge: { status: 'encerrado' } }); // agenda funciona sem desafio rolando
    await w.send({ id: 'SUG', phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:00:00Z', text: 'Bora fazer uma trilha sábado de manhã na Pedra Grande?' });

    // só admin agenda
    await w.send({ phone: ANA, at: '2026-11-09T12:01:00Z', text: '#agendar', quoted: { id: 'SUG', participant: `${BRUNO}@s.whatsapp.net`, text: 'Bora fazer uma trilha sábado de manhã na Pedra Grande?' } });
    expect(w.wa.last()).toContain('Só os admins');

    w.ai.textAnswer = '{"title": "Trilha da Pedra Grande", "date": "2026-11-14", "time": "07:00", "place": "Pedra Grande, Atibaia", "organizer": null}';
    await w.send({ phone: ADMIN, at: '2026-11-09T12:02:00Z', text: '#agendar', quoted: { id: 'SUG', participant: `${BRUNO}@s.whatsapp.net`, text: 'Bora fazer uma trilha sábado de manhã na Pedra Grande?' } });
    expect(w.ai.prompts.at(-1)).toContain('Hoje é segunda-feira, 2026-11-09');
    expect(w.wa.last()).toBe('📅 Evento agendado: *Trilha da Pedra Grande*\n🗓️ sáb, 14/11 às 07:00\n📍 Pedra Grande, Atibaia\n🙋 Organização: Bruno\n\nQuem vai, mande: #comparecer Trilha da Pedra Grande');

    // agendar de novo a mesma sugestão não duplica
    await w.send({ phone: ADMIN, at: '2026-11-09T12:03:00Z', text: '#agendar', quoted: { id: 'SUG', participant: `${BRUNO}@s.whatsapp.net`, text: 'x' } });
    expect(w.wa.last()).toContain('já está na agenda');

    // formato direto, sem IA
    await w.send({ phone: ADMIN, name: 'Felipe', at: '2026-11-09T12:04:00Z', text: '#agendar Churrasco | 20/11 19h | Casa do Erick' });
    expect(w.wa.last()).toContain('*Churrasco*\n🗓️ sex, 20/11 às 19:00\n📍 Casa do Erick\n🙋 Organização: Felipe');

    // qualquer pessoa do grupo confirma, mesmo fora do desafio
    await w.send({ phone: NAO_INSCRITO, name: 'Carla', at: '2026-11-09T13:00:00Z', text: '#comparecer "trilha"' });
    expect(w.wa.last()).toBe('✅ Carla confirmou presença em *Trilha da Pedra Grande* (sáb, 14/11 às 07:00). Já são 1 confirmados.');
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T13:01:00Z', text: '#comparecer Trilha da Pedra Grande' });
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T13:02:00Z', text: '#comparecer churrasco' });
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T13:03:00Z', text: '#comparecer festa' });
    expect(w.wa.last()).toContain('Não achei esse evento');

    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T13:05:00Z', text: '#agenda' });
    expect(w.wa.last()).toBe(
      '📅 *Agenda do grupo*\n\n1. *Trilha da Pedra Grande* - sáb, 14/11 às 07:00\n   📍 Pedra Grande, Atibaia · 🙋 Bruno\n   ✅ Confirmados (2): Carla, Ana\n\n2. *Churrasco* - sex, 20/11 às 19:00\n   📍 Casa do Erick · 🙋 Felipe\n   ✅ Confirmados (1): Ana\n\nPara ir: #comparecer nome do evento',
    );

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T13:06:00Z', text: '#desistir churrasco' });
    expect(w.wa.last()).toContain('Ana saiu da lista de *Churrasco*');

    // no dia 15 a trilha (dia 14) já saiu da lista
    w.now.value = new Date('2026-11-15T12:00:00Z');
    await agenda.jobs![0]!.run(w.runtime.context((await w.runtime.activeBots())[0]!));
    await w.send({ phone: BRUNO, at: '2026-11-15T12:00:00Z', text: '#agenda' });
    expect(w.wa.last()).not.toContain('Trilha');
    expect(w.wa.last()).toContain('Churrasco');
    const [st] = await w.sql`select status from events where title = 'Trilha da Pedra Grande'`;
    expect(st?.status).toBe('passado');
  });
});

describe('comandos para todos', () => {
  it('#motivação e ?alimento funcionam sem desafio e para quem não está inscrito', async () => {
    w = await world({ challenge: { status: 'encerrado' } });
    w.ai.textAnswer = 'Carla, meu aluno, o caminho se faz caminhando. 🐀';
    await w.send({ phone: NAO_INSCRITO, name: 'Carla', at: '2026-11-09T12:00:00Z', text: '#motivação' });
    expect(w.ai.prompts.at(-1)).toContain('Carla mandou #motivação');
    expect(w.ai.prompts.at(-1)).toContain('Não há desafio rolando');
    expect(w.wa.last()).toBe('Carla, meu aluno, o caminho se faz caminhando. 🐀');

    w.ai.textAnswer = '✅ Saudável';
    await w.send({ phone: NAO_INSCRITO, at: '2026-11-09T12:01:00Z', text: '?granola' });
    expect(w.wa.last()).toBe('🥗 *granola*\n✅ Saudável');

    await w.send({ phone: NAO_INSCRITO, at: '2026-11-09T12:02:00Z', text: '#ajuda' });
    expect(w.wa.last()).toContain('#motivação');
  });

  it('#motivacao (sem acento) usa os pontos de quem está no desafio', async () => {
    w = await world({ challenge: { require_location: false } });
    await w.send({ phone: ANA, at: '2026-11-09T12:00:00Z', image: { sha: 'm1', caption: '#treino' } });
    await w.send({ phone: ANA, at: '2026-11-09T13:00:00Z', text: '#motivacao' });
    expect(w.ai.prompts.at(-1)).toContain('Ana tem 1 pontos (1º de 3). Check-ins válidos hoje: Treino');
  });
});
