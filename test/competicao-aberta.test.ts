import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { parseCommand } from '../src/modules/splinter/rules.js';
import { splinterJobs } from '../src/modules/splinter/jobs.js';

const ANA = '5511911111111';
const NOVO = '5511933333333';
const OUTRA = '5511944444444';
const ADMIN = '5511900000001';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

/** Mundo sem desafio nenhum (o grupo acabou de ganhar o bot fitness). */
async function semDesafio() {
  w = await world();
  await w.sql`delete from splinter_challenges`;
  await w.runtime.idle();
  return w;
}

const aberta = async () => (await w.sql`select * from splinter_challenges where open_mode`)[0];
const runCongrats = async () =>
  splinterJobs.find((j) => j.name === 'parabens-do-dia')!.run(w.runtime.context((await w.runtime.activeBots())[0]!));

describe('comandos da competição aberta', () => {
  it('reconhece os comandos, com e sem acento/espaço', () => {
    expect(parseCommand('#monitorartreinos')).toEqual({ type: 'monitorar', on: true });
    expect(parseCommand('#monitorar treinos')).toEqual({ type: 'monitorar', on: true });
    expect(parseCommand('#pararmonitoramento')).toEqual({ type: 'monitorar', on: false });
    expect(parseCommand('#pararmonitorartreinos')).toEqual({ type: 'monitorar', on: false });
    expect(parseCommand('#ficargostoso')).toEqual({ type: 'ficargostoso' });
    expect(parseCommand('#ficargostosa')).toEqual({ type: 'ficargostoso' });
    expect(parseCommand('#desativarparabens')).toEqual({ type: 'parabens', on: false });
    expect(parseCommand('#ativarparabéns')).toEqual({ type: 'parabens', on: true });
    expect(parseCommand('#desativar parabens')).toEqual({ type: 'parabens', on: false });
    expect(parseCommand('#desativar pose')).toEqual({ type: 'ativar', on: false, names: ['pose'] });
  });
});

describe('#monitorartreinos', () => {
  it('não liga por cima de uma competição normal em andamento, e só admin liga', async () => {
    w = await world();
    await w.send({ phone: ADMIN, at: '2026-11-09T12:00:00Z', text: '#monitorartreinos' });
    expect(w.wa.last()).toContain('já tem a competição *Desafio de Novembro*');
    expect(await aberta()).toBeUndefined();

    await w.sql`delete from splinter_challenges`;
    await w.send({ phone: ANA, at: '2026-11-09T12:01:00Z', text: '#monitorartreinos' });
    expect(w.wa.last()).toContain('Só os admins');
    expect(await aberta()).toBeUndefined();
  });

  it('liga, qualquer um entra com #ficargostoso e as fotos pontuam; sem equipes', async () => {
    await semDesafio();
    await w.send({ phone: ADMIN, at: '2026-11-09T12:00:00Z', text: '#monitorartreinos' });
    expect(w.wa.last()).toContain('Competição aberta de treinos ligada');
    expect(w.wa.last()).toContain('#ficargostoso');
    const ch = await aberta();
    expect(ch).toMatchObject({ status: 'ativo', daily_congrats: true, persona_messages: false, daily_summary: false });
    expect(Number(ch!.team_bonus_points)).toBe(0);
    const rules = await w.sql`select hashtag, active from splinter_rules where challenge_id = ${ch!.id} order by id`;
    expect(rules.map((r) => r.hashtag)).toEqual(['#treino', '#comida', '#agua', '#cardio', '#pose']);

    await w.send({ phone: ADMIN, at: '2026-11-09T12:01:00Z', text: '#monitorartreinos' });
    expect(w.wa.last()).toContain('já está ligada');

    // foto antes de entrar: orienta a usar #ficargostoso
    await w.send({ id: 'F0', phone: NOVO, name: 'Carla', at: '2026-11-09T12:05:00Z', image: { sha: 'f0', caption: '#agua' } });
    expect(w.wa.last()).toContain('#ficargostoso');

    await w.send({ phone: NOVO, name: 'Carla', at: '2026-11-09T12:06:00Z', text: '#ficargostosa' });
    expect(w.wa.last()).toContain('*Carla* entrou na competição');
    await w.send({ phone: NOVO, name: 'Carla', at: '2026-11-09T12:07:00Z', text: '#ficargostosa' });
    expect(w.wa.last()).toContain('já está na competição');

    await w.send({ id: 'F1', phone: NOVO, name: 'Carla', at: '2026-11-09T12:10:00Z', image: { sha: 'f1', caption: '#agua' } });
    expect(w.wa.last()).toContain('Hidratação registrado');
    await w.send({ phone: NOVO, at: '2026-11-09T12:11:00Z', text: '#ranking' });
    expect(w.wa.last()).toContain('1. Carla - 1 pts');

    await w.send({ phone: NOVO, at: '2026-11-09T12:12:00Z', text: '#equipes' });
    expect(w.wa.last()).toContain('não tem duplas nem equipes');
    await w.send({ phone: NOVO, at: '2026-11-09T12:13:00Z', text: '#regras' });
    expect(w.wa.last()).toContain('#ficargostoso');
    expect(w.wa.last()).not.toContain('Cada dupla');
  });

  it('copia as categorias e regras do último desafio do grupo', async () => {
    w = await world({ challenge: { require_location: false, max_workouts_week: 4 } });
    await w.sql`update splinter_challenges set status = 'encerrado'`;
    await w.sql`update splinter_rules set points = 5 where hashtag = '#treino'`;
    await w.send({ phone: ADMIN, at: '2026-11-09T12:00:00Z', text: '#monitorartreinos' });
    const ch = await aberta();
    expect(ch).toMatchObject({ require_location: false, max_workouts_week: 4 });
    const [treino] = await w.sql`select points::float8 as p from splinter_rules where challenge_id = ${ch!.id} and hashtag = '#treino'`;
    expect(treino!.p).toBe(5);
    // participantes do desafio antigo não entram sozinhos
    const [n] = await w.sql`select count(*)::int as n from splinter_participants where challenge_id = ${ch!.id}`;
    expect(n!.n).toBe(0);
  });

  it('#pararmonitoramento encerra e religar mantém inscritos e pontos', async () => {
    await semDesafio();
    await w.send({ phone: ADMIN, at: '2026-11-09T12:00:00Z', text: '#monitorartreinos' });
    await w.send({ phone: NOVO, name: 'Carla', at: '2026-11-09T12:01:00Z', text: '#ficargostosa' });
    await w.send({ id: 'G1', phone: NOVO, at: '2026-11-09T12:02:00Z', image: { sha: 'g1', caption: '#cardio' } });

    await w.send({ phone: ANA, at: '2026-11-09T12:03:00Z', text: '#pararmonitoramento' });
    expect(w.wa.last()).toContain('Só os admins');
    await w.send({ phone: ADMIN, at: '2026-11-09T12:04:00Z', text: '#pararmonitoramento' });
    expect(w.wa.last()).toContain('Competição aberta encerrada');
    await w.send({ id: 'G2', phone: NOVO, at: '2026-11-09T12:05:00Z', image: { sha: 'g2', caption: '#agua' } });
    expect((await w.sql`select 1 from splinter_checkins where provider_msg_id = 'G2'`).length).toBe(0);

    await w.send({ phone: ADMIN, at: '2026-11-09T12:06:00Z', text: '#monitorartreinos' });
    expect(w.wa.last()).toContain('religada');
    await w.send({ phone: NOVO, at: '2026-11-09T12:07:00Z', text: '#ranking' });
    expect(w.wa.last()).toContain('1. Carla - 1 pts');
    expect((await w.sql`select 1 from splinter_challenges`).length).toBe(1);
  });
});

describe('parabéns do dia', () => {
  async function dia() {
    await semDesafio();
    await w.send({ phone: ADMIN, at: '2026-11-09T12:00:00Z', text: '#monitorartreinos' });
    await w.send({ phone: NOVO, name: 'Carla', at: '2026-11-09T12:01:00Z', text: '#ficargostosa' });
    await w.send({ phone: OUTRA, name: 'Duda', at: '2026-11-09T12:01:00Z', text: '#ficargostoso' });
    await w.send({ id: 'H1', phone: NOVO, at: '2026-11-09T13:00:00Z', image: { sha: 'h1', caption: '#agua' } });
    await w.send({ id: 'H2', phone: NOVO, at: '2026-11-09T13:01:00Z', image: { sha: 'h2', caption: '#cardio' } });
    await w.send({ id: 'H3', phone: OUTRA, at: '2026-11-09T13:02:00Z', image: { sha: 'h3', caption: '#agua' } });
    w.now.value = new Date('2026-11-10T09:00:00Z'); // 6h do dia seguinte em Brasília
    w.wa.clear();
  }

  it('às 6h o mascote parabeniza quem mais pontuou no dia anterior, marcando pelo telefone', async () => {
    await dia();
    const tagged: { text: string; jids: string[] }[] = [];
    w.wa.sendTextMentions = async (_chat: string, text: string, jids: string[]) => {
      tagged.push({ text, jids });
    };
    w.ai.textAnswer = 'Carla brilhou hoje no dojô! 🐀';
    await runCongrats();
    expect(tagged).toHaveLength(1);
    expect(tagged[0]!.text).toContain('Destaque de ontem (09/11/2026)');
    expect(tagged[0]!.text).toContain(`@${NOVO} (*Carla*) - 2 pts (Hidratação, Cardio)`);
    expect(tagged[0]!.text).toContain('Carla brilhou hoje');
    expect(tagged[0]!.text).not.toContain('Duda');
    expect(tagged[0]!.jids).toEqual([`${NOVO}@s.whatsapp.net`]);
    expect(w.ai.prompts.at(-1)).toContain('Carla: 2 pontos (Hidratação, Cardio)');
    expect(w.ai.prompts.at(-1)).not.toContain(NOVO);
  });

  it('empate parabeniza todos; sem marcação manda só com os nomes', async () => {
    await dia();
    await w.sql`update splinter_checkins set status = 'recusado' where provider_msg_id = 'H2'`;
    await runCongrats();
    expect(w.wa.last()).toContain('Destaques de ontem');
    expect(w.wa.last()).toContain('*Carla* - 1 pts');
    expect(w.wa.last()).toContain('*Duda* - 1 pts');
  });

  it('#desativarparabens desliga (só admin) e #ativarparabens religa', async () => {
    await dia();
    await w.send({ phone: NOVO, at: '2026-11-10T02:00:00Z', text: '#desativarparabens' });
    expect(w.wa.last()).toContain('Só os admins');
    await w.send({ phone: ADMIN, at: '2026-11-10T02:01:00Z', text: '#desativarparabens' });
    expect(w.wa.last()).toContain('Parabéns do dia desligados');
    w.wa.clear();
    await runCongrats();
    expect(w.wa.sent).toHaveLength(0);

    await w.send({ phone: ADMIN, at: '2026-11-10T02:02:00Z', text: '#ativarparabens' });
    expect(w.wa.last()).toContain('Parabéns do dia ligados');
    await runCongrats();
    expect(w.wa.last()).toContain('Destaque de ontem');
  });

  it('ninguém pontuou: fica em silêncio; competição normal não recebe parabéns', async () => {
    await semDesafio();
    await w.send({ phone: ADMIN, at: '2026-11-09T12:00:00Z', text: '#monitorartreinos' });
    w.wa.clear();
    w.now.value = new Date('2026-11-10T09:00:00Z');
    await runCongrats();
    expect(w.wa.sent).toHaveLength(0);

    await w.sql.end();
    w = await world({ challenge: { require_location: false } });
    await w.send({ id: 'N1', phone: ANA, at: '2026-11-09T13:00:00Z', image: { sha: 'n1', caption: '#agua' } });
    w.now.value = new Date('2026-11-10T09:00:00Z');
    w.wa.clear();
    await runCongrats();
    expect(w.wa.sent).toHaveLength(0);
    await w.send({ phone: ADMIN, at: '2026-11-10T02:59:00Z', text: '#desativarparabens' });
    expect(w.wa.last()).toContain('são da competição aberta');
  });
});

describe('#ajuda e #regras separados', () => {
  it('#ajuda só tem comandos gerais; #regras tem os do desafio fitness', async () => {
    w = await world();
    await w.send({ phone: ANA, at: '2026-11-09T12:00:00Z', text: '#ajuda' });
    const ajuda = w.wa.last();
    expect(ajuda).toContain('#motivação');
    expect(ajuda).toContain('#regras');
    for (const cmd of ['#ranking', '#atividades', '#pausar', '#reiniciar', '#monitorartreinos', '#ficargostoso', '#desativar pose']) {
      expect(ajuda).not.toContain(cmd);
    }
    await w.send({ phone: ANA, at: '2026-11-09T12:01:00Z', text: '#regras' });
    const regras = w.wa.last();
    for (const cmd of ['#ranking', '#equipes', '#atividades', '#pausar', '#reiniciar', '#inscrever']) expect(regras).toContain(cmd);
    for (const cmd of ['#motivação', '#agenda', '#tarot']) expect(regras).not.toContain(cmd);
  });

  it('#regras sem competição mostra como ligar a competição aberta', async () => {
    await semDesafio();
    await w.send({ phone: ANA, at: '2026-11-09T12:00:00Z', text: '#regras' });
    expect(w.wa.last()).toContain('Não há competição rolando');
    expect(w.wa.last()).toContain('#monitorartreinos');
  });
});
