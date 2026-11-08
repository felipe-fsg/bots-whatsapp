import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { splinterJobs } from '../src/modules/splinter/jobs.js';

const ANA = '5511911111111';
const BRUNO = '5511922222222';
const ADMIN = '5511900000001';
const GYM = { lat: -23.5617, lng: -46.6559 };

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

const status = async (id: string) => (await w.sql`select status, reason, points::float8 as points, place_name from splinter_checkins where provider_msg_id = ${id}`)[0];

describe('check-in de treino com localização', () => {
  it('pede localização e valida perto de uma academia', async () => {
    w = await world();
    w.places.places = [{ name: 'Smart Fit Paulista', lat: GYM.lat + 0.0005, lng: GYM.lng }];

    await w.send({ id: 'T1', phone: ANA, at: '2026-11-09T10:00:00Z', image: { sha: 'h1', caption: '#treino' } });
    expect(await status('T1')).toMatchObject({ status: 'aguardando_localizacao', points: 1 });
    expect(w.wa.last()).toContain('mande sua localização');

    await w.send({ phone: ANA, at: '2026-11-09T10:03:00Z', location: GYM });
    expect(await status('T1')).toMatchObject({ status: 'valido', place_name: 'Smart Fit Paulista' });
    expect(w.wa.last()).toMatch(/treino validado em Smart Fit Paulista \(56 m\)/);

    // não guardamos a coordenada do participante
    const cols = await w.sql`select column_name from information_schema.columns where table_name = 'splinter_checkins'`;
    expect(cols.map((c) => c.column_name)).not.toContain('lat');
  });

  it('manda para revisão sem local perto ou sem localização no prazo', async () => {
    w = await world();
    await w.send({ id: 'T1', phone: ANA, at: '2026-11-09T10:00:00Z', image: { sha: 'h1', caption: '#treino' } });
    await w.send({ phone: ANA, at: '2026-11-09T10:01:00Z', location: GYM });
    expect(await status('T1')).toMatchObject({ status: 'em_revisao' });

    await w.send({ id: 'T2', phone: BRUNO, at: '2026-11-09T10:00:00Z', image: { sha: 'h2', caption: '#treino' } });
    w.now.value = new Date('2026-11-09T10:20:00Z');
    await splinterJobs.find((j) => j.name === 'localizacao-vencida')!.run(w.runtime.context((await w.runtime.activeBots())[0]!));
    expect(await status('T2')).toMatchObject({ status: 'em_revisao', reason: 'Localização não enviada no prazo' });
  });

  it('usa o local cadastrado pelo participante com #meulocal', async () => {
    w = await world();
    await w.send({ id: 'L1', phone: ANA, at: '2026-11-09T09:00:00Z', location: { lat: -23.6, lng: -46.7 } });
    await w.send({ phone: ANA, at: '2026-11-09T09:01:00Z', text: '#meulocal Academia do prédio', quoted: { id: 'L1', participant: `${ANA}@s.whatsapp.net`, location: { lat: -23.6, lng: -46.7 } } });
    expect(w.wa.last()).toContain('Academia do prédio');
    await w.send({ id: 'T1', phone: ANA, at: '2026-11-09T10:00:00Z', image: { sha: 'h1', caption: '#treino' } });
    await w.send({ phone: ANA, at: '2026-11-09T10:01:00Z', location: { lat: -23.6003, lng: -46.7 } });
    expect(await status('T1')).toMatchObject({ status: 'valido', place_name: 'Academia do prédio' });
  });
});

describe('limites', () => {
  it('só uma foto por categoria por dia, sem foto repetida, até 5 treinos por semana', async () => {
    w = await world({ challenge: { require_location: false } });
    await w.send({ id: 'A1', phone: ANA, at: '2026-11-09T10:00:00Z', image: { sha: 'x1', caption: '#agua' } });
    await w.send({ id: 'A2', phone: ANA, at: '2026-11-09T11:00:00Z', image: { sha: 'x2', caption: '#agua' } });
    await w.send({ id: 'A3', phone: ANA, at: '2026-11-10T11:00:00Z', image: { sha: 'x1', caption: '#agua' } });
    expect((await status('A1'))!.status).toBe('valido');
    expect(await status('A2')).toMatchObject({ status: 'recusado', reason: 'Categoria já pontuada hoje' });
    expect(await status('A3')).toMatchObject({ status: 'recusado', reason: 'Foto já usada antes' });

    // segunda (09) a sexta (13) = 5 treinos; sábado (14) é o 6º
    for (let d = 9; d <= 14; d++) {
      await w.send({ id: `W${d}`, phone: ANA, at: `2026-11-${String(d).padStart(2, "0")}T12:00:00Z`, image: { sha: `w${d}`, caption: '#treino' } });
    }
    expect((await status('W13'))!.status).toBe('valido');
    expect(await status('W14')).toMatchObject({ status: 'recusado', reason: 'Limite semanal de treinos atingido' });
    // segunda seguinte abre semana nova
    await w.send({ id: 'W16', phone: ANA, at: '2026-11-16T12:00:00Z', image: { sha: 'w16', caption: '#treino' } });
    expect((await status('W16'))!.status).toBe('valido');
  });

  it('avisa quem não está inscrito e quem manda depois do horário', async () => {
    w = await world({ challenge: { checkin_deadline: '22:00' } });
    await w.send({ phone: '5511933333333', name: 'Zé', at: '2026-11-09T10:00:00Z', image: { sha: 'z', caption: '#agua' } });
    expect(w.wa.last()).toContain('não encontrei seu número');
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-10T01:30:00Z', image: { sha: 'z2', caption: '#agua' } }); // 22:30 em SP
    expect(w.wa.last()).toContain('depois de 22:00');
  });

  it('ignora foto sem hashtag, mensagem repetida e grupos sem bot', async () => {
    w = await world();
    await w.send({ phone: ANA, at: '2026-11-09T10:00:00Z', image: { sha: 'n', caption: 'olha que dia lindo' } });
    expect(w.wa.sent).toHaveLength(0);
    expect(await w.send({ id: 'R1', phone: ANA, at: '2026-11-09T10:00:00Z', text: '#ranking' })).toBe('handled');
    expect(await w.send({ id: 'R1', phone: ANA, at: '2026-11-09T10:00:00Z', text: '#ranking' })).toBe('ignored');
    expect(await w.send({ phone: ANA, chat: 'outro@g.us', at: '2026-11-09T10:00:00Z', text: '#ranking' })).toBe('ignored');
  });
});

describe('IA', () => {
  it('julga o prato e respeita a pose do dia', async () => {
    w = await world();
    w.ai.visionAnswer = 'VEREDITO: NAO_SAUDAVEL\nMOTIVO: tem batata frita.';
    await w.send({ id: 'C1', phone: ANA, at: '2026-11-09T15:00:00Z', image: { sha: 'c1', caption: '#comida' } });
    expect(await status('C1')).toMatchObject({ status: 'recusado', reason: 'IA: prato não saudável' });
    expect(w.wa.last()).toContain('tem batata frita');

    // pose sem foto de referência -> revisão
    await w.send({ id: 'P1', phone: BRUNO, at: '2026-11-09T15:00:00Z', image: { sha: 'p1', caption: '#pose' } });
    expect(await status('P1')).toMatchObject({ status: 'em_revisao', reason: 'Pose do dia ainda não cadastrada' });

    // não-admin não cadastra pose; admin cadastra
    await w.send({ phone: BRUNO, at: '2026-11-09T15:10:00Z', image: { sha: 'ref0', caption: '#posedodia' } });
    expect(w.wa.last()).toContain('Só os admins');
    await w.send({ phone: ADMIN, at: '2026-11-09T15:10:00Z', image: { sha: 'ref', caption: '#posedodia Guerreiro' } });
    expect(w.wa.last()).toContain('pose do dia está lançada');

    w.ai.visionAnswer = 'VEREDITO: MESMA_POSE\nMOTIVO: braços e pernas iguais.';
    await w.send({ id: 'P2', phone: ANA, at: '2026-11-09T16:00:00Z', image: { sha: 'p2', caption: '#pose' } });
    expect(await status('P2')).toMatchObject({ status: 'valido' });
  });

  it('responde ?alimento usando a lista dos admins', async () => {
    w = await world();
    await w.sql`insert into splinter_foods (challenge_id, name, verdict) values (${w.challengeId}, 'Tapioca', 'saudavel')`;
    w.ai.textAnswer = '✅ Saudável\n**Feita de mandioca.**';
    await w.send({ phone: ANA, at: '2026-11-09T15:00:00Z', text: '?tapioca' });
    expect(w.ai.prompts.at(-1)).toContain('SAUDÁVEIS: Tapioca');
    expect(w.wa.last()).toBe('🥗 *tapioca*\n✅ Saudável\n*Feita de mandioca.*');
  });
});

describe('admins, equipes e ranking', () => {
  it('inscreve, monta dupla, dá bônus e revisa', async () => {
    w = await world({ challenge: { require_location: false } });
    const CARLA = '5511944444444';

    // não-admin não inscreve
    await w.send({ phone: ANA, at: '2026-11-09T10:00:00Z', text: '#inscrever', quoted: { id: 'X', participant: `${CARLA}@s.whatsapp.net`, text: 'Carla' } });
    expect(w.wa.last()).toContain('Só os admins');

    // admin responde à mensagem da Carla (que vem como LID) -> resolve pela lista do grupo
    w.wa.members = [{ jid: `${CARLA}@s.whatsapp.net`, lid: '777@lid', phone: CARLA }];
    await w.send({ phone: ADMIN, at: '2026-11-09T10:00:00Z', text: '#inscrever', quoted: { id: 'X', participant: '777@lid', text: 'Carla Dias' } });
    expect(w.wa.last()).toContain('Seja bem-vindo ao dojô, *Carla Dias*');

    // equipe com menções (uma por telefone, outra por LID)
    await w.send({ phone: ADMIN, at: '2026-11-09T10:05:00Z', text: '#equipe Tartarugas @x @y', mentions: [`${ANA}@s.whatsapp.net`, '777@lid'] });
    expect(w.wa.last()).toContain('*Tartarugas*\nIntegrantes: Ana e Carla Dias');

    // as duas treinam no mesmo dia -> +1 de bônus
    await w.send({ id: 'E1', phone: ANA, at: '2026-11-09T11:00:00Z', image: { sha: 'e1', caption: '#treino' } });
    await w.send({ id: 'E2', phone: CARLA, at: '2026-11-09T21:00:00Z', image: { sha: 'e2', caption: '#treino' } });
    await w.send({ phone: ANA, at: '2026-11-09T22:00:00Z', text: '#equipes' });
    expect(w.wa.last()).toContain('1. Tartarugas (Ana e Carla Dias) - 3 pts');

    // foto de comida em dúvida -> admin aprova respondendo à foto
    w.ai.visionAnswer = 'VEREDITO: DUVIDA\nMOTIVO: foto escura.';
    await w.send({ id: 'C9', phone: BRUNO, at: '2026-11-09T12:00:00Z', image: { sha: 'c9', caption: '#comida' } });
    await w.send({ phone: ADMIN, at: '2026-11-09T12:30:00Z', text: '#pendentes' });
    expect(w.wa.last()).toContain('Bruno - Alimentação');
    await w.send({ phone: ADMIN, name: 'Felipe', at: '2026-11-09T12:31:00Z', text: '#aprovar', quoted: { id: 'C9', participant: `${BRUNO}@s.whatsapp.net` } });
    expect(await status('C9')).toMatchObject({ status: 'valido', points: 1, reason: 'Aprovado por Felipe' });

    await w.send({ phone: ANA, at: '2026-11-09T22:00:00Z', text: '#ranking' });
    expect(w.wa.last()).toBe('🏆 Ranking - Desafio de Novembro\n\n1. Ana - 1 pts\n1. Bruno - 1 pts\n1. Carla Dias - 1 pts\n4. Felipe - 0 pts');
  });
});

describe('Mestre Splinter', () => {
  it('manda o resumo às 4h com os dados de ontem', async () => {
    w = await world({ challenge: { require_location: false } });
    await w.send({ phone: ANA, at: '2026-11-09T12:00:00Z', image: { sha: 's1', caption: '#treino' } });
    w.now.value = new Date('2026-11-10T07:00:00Z'); // 4h em SP
    await splinterJobs.find((j) => j.name === 'mestre-splinter')!.run(w.runtime.context((await w.runtime.activeBots())[0]!));
    expect(w.ai.prompts.at(-1)).toContain('resumo diário');
    expect(w.ai.prompts.at(-1)).toContain('Check-ins válidos de ontem (09/11/2026): Ana: 1 pts (Treino)');
    expect(w.wa.last()).toBe('Muito bem, meus alunos! 🐀');
  });
});
