import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { combinam, generoPeloNome, lerOrientacao } from '../src/features/romance/perfil.js';
import { lerCasais, SHIP_SEM_REPETIR } from '../src/features/romance/index.js';

const ANA = '5511911111111';
const BRUNO = '5511922222222';
const CARLA = '5511933333333';
const DIEGO = '5511944444444';
const ALEX = '5511955555555';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

function withMentions(x: World) {
  const mentioned: string[][] = [];
  Object.assign(x.wa, {
    sendTextMentions: async (chat: string, text: string, jids: string[]) => {
      mentioned.push(jids);
      x.wa.sent.push({ chat, text });
    },
  });
  return mentioned;
}

const member = (phone: string) => ({ jid: `${phone}@s.whatsapp.net`, phone });

describe('perfil (orientação)', () => {
  it('chuta o gênero pelo primeiro nome e deixa nomes neutros de fora', () => {
    expect(generoPeloNome('Ana Souza')).toBe('m');
    expect(generoPeloNome('Viviane')).toBe('m');
    expect(generoPeloNome('Beatriz 🌸')).toBe('m');
    expect(generoPeloNome('Dra. Paula')).toBe('m');
    expect(generoPeloNome('Bruno Lima')).toBe('h');
    expect(generoPeloNome('Felipe.')).toBe('h');
    expect(generoPeloNome('Luca')).toBe('h');
    expect(generoPeloNome('Alex')).toBeNull();
    expect(generoPeloNome('Dani')).toBeNull();
    expect(generoPeloNome('😎')).toBeNull();
    expect(generoPeloNome('')).toBeNull();
  });

  it('lê o que a pessoa escreve', () => {
    expect(lerOrientacao('mulher bi')).toEqual({ kind: 'ok', gender: 'm', orientation: 'bi' });
    expect(lerOrientacao('Homem heterossexual')).toEqual({ kind: 'ok', gender: 'h', orientation: 'hetero' });
    expect(lerOrientacao('lésbica')).toEqual({ kind: 'ok', gender: 'm', orientation: 'homo' });
    expect(lerOrientacao('gay')).toEqual({ kind: 'ok', gender: 'h', orientation: 'homo' });
    expect(lerOrientacao('não binário pan')).toEqual({ kind: 'ok', gender: 'nb', orientation: 'bi' });
    expect(lerOrientacao('hetero')).toEqual({ kind: 'ok', gender: null, orientation: 'hetero' });
    expect(lerOrientacao('fora')).toMatchObject({ kind: 'ok', orientation: 'fora' });
    expect(lerOrientacao('remover')).toEqual({ kind: 'remover' });
    expect(lerOrientacao('')).toEqual({ kind: 'mostrar' });
    expect(lerOrientacao('azul')).toEqual({ kind: 'invalido' });
  });

  it('só junta quem se interessa um pelo outro', () => {
    expect(combinam({ gender: 'h', orientation: 'hetero' }, { gender: 'm', orientation: 'hetero' })).toBe(true);
    expect(combinam({ gender: 'h', orientation: 'hetero' }, { gender: 'h', orientation: 'hetero' })).toBe(false);
    expect(combinam({ gender: 'h', orientation: 'homo' }, { gender: 'h', orientation: 'bi' })).toBe(true);
    expect(combinam({ gender: 'm', orientation: 'homo' }, { gender: 'h', orientation: 'bi' })).toBe(false);
    expect(combinam({ gender: 'm', orientation: 'bi' }, { gender: 'nb', orientation: 'bi' })).toBe(true);
    expect(combinam({ gender: 'm', orientation: 'hetero' }, { gender: 'nb', orientation: 'bi' })).toBe(false);
  });

  it('lê o JSON da IA mesmo com ``` em volta', () => {
    expect(lerCasais('```json\n{"casais":[{"a":"p1","b":"P2","motivo":"x"}]}\n```')).toEqual([{ a: 'P1', b: 'P2', motivo: 'x' }]);
    expect(lerCasais('nada')).toEqual([]);
    expect(lerCasais('{"casais": 3}')).toEqual([]);
  });
});

describe('#orientação', () => {
  it('registra, mostra, recusa o que não entende e apaga', async () => {
    w = await world();
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#orientação' });
    expect(w.wa.last()).toContain('ainda não registrou');

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:01:00Z', text: '#Orientação bi' });
    expect(w.wa.last()).toContain('*mulher, bi/pan*'); // gênero pelo nome
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:02:00Z', text: '#orientacao' });
    expect(w.wa.last()).toContain('o seu registro é: *mulher, bi/pan*');

    await w.send({ phone: ALEX, name: 'Alex', at: '2026-11-09T12:03:00Z', text: '#orientação hetero' });
    expect(w.wa.last()).toContain('homem, mulher ou não binário');
    await w.send({ phone: ALEX, name: 'Alex', at: '2026-11-09T12:04:00Z', text: '#orientação não binário hetero' });
    expect(w.wa.last()).toContain('use *bi* ou *pan*');
    await w.send({ phone: ALEX, name: 'Alex', at: '2026-11-09T12:05:00Z', text: '#orientação azul' });
    expect(w.wa.last()).toContain('Não entendi');

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:06:00Z', text: '#orientação remover' });
    expect(w.wa.last()).toContain('apaguei o seu registro');
    const rows = await w.sql`select 1 from member_orientations`;
    expect(rows).toHaveLength(0);
  });
});

describe('#datealeatorio', () => {
  it('sorteia um casal que combina, marca os dois e respeita o registro', async () => {
    w = await world();
    const mentioned = withMentions(w);
    w.wa.members = [member(ANA), member(BRUNO), member(CARLA), member(ALEX)];
    for (const [p, n] of [[ANA, 'Ana'], [BRUNO, 'Bruno'], [CARLA, 'Carla'], [ALEX, 'Alex']] as const)
      await w.send({ phone: p, name: n, at: '2026-11-09T11:00:00Z', text: 'oi' });
    // Ana é lésbica e Carla é bi: Ana só combina com Carla; Bruno (hétero pelo nome) também combina com Carla
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T11:01:00Z', text: '#orientação lésbica' });
    await w.send({ phone: CARLA, name: 'Carla', at: '2026-11-09T11:02:00Z', text: '#orientação mulher bi' });

    w.ai.textAnswer = '[P1] e [P2], vocês vão num karaokê! 🎤';
    const vistos = new Set<string>();
    for (let i = 0; i < 12; i++) {
      await w.send({ phone: DIEGO, name: 'Diego', at: `2026-11-09T12:${String(i).padStart(2, '0')}:00Z`, text: '#DateAleatorio' });
      const out = w.wa.last();
      expect(out).toContain('💘 *Date aleatório!*');
      expect(out).toContain('Só brincadeira');
      expect(out).not.toContain('(*Alex*)'); // nome neutro, sem registro: fica de fora
      const jids = mentioned.at(-1)!;
      expect(jids).toHaveLength(2);
      vistos.add(jids.map((j) => j.slice(0, 13)).sort().join('+'));
    }
    // Ana+Carla (as duas se interessam por mulher) e Bruno+Carla (Carla é bi); nunca Ana+Bruno
    expect([...vistos].sort()).toEqual([`${ANA}+${CARLA}`, `${BRUNO}+${CARLA}`]);
    expect(w.ai.prompts.at(-1)).not.toMatch(/55119/); // a IA não vê telefone
    expect(w.ai.prompts.at(-1)).not.toMatch(/lésbica|bi\b|hetero/);
  });

  it('avisa quando ninguém combina', async () => {
    w = await world();
    w.wa.members = [member(BRUNO), member(DIEGO)];
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T11:00:00Z', text: 'oi' });
    await w.send({ phone: DIEGO, name: 'Diego', at: '2026-11-09T11:00:00Z', text: 'oi' });
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:00:00Z', text: '#datealeatorio' });
    expect(w.wa.last()).toContain('Não achei um casal');
  });
});

describe('#shippar', () => {
  async function conversa(x: World) {
    x.wa.members = [member(ANA), member(BRUNO), member(CARLA), member(DIEGO)];
    const falas: [string, string, string][] = [
      [ANA, 'Ana', 'alguém quer pizza hoje?'],
      [BRUNO, 'Bruno', 'eu quero! pizza de calabresa'],
      [ANA, 'Ana', 'Bruno você sempre topa kkk'],
      [CARLA, 'Carla', 'vou levar o violão'],
      [DIEGO, 'Diego', 'Carla toca aquela música de novo'],
      [CARLA, 'Carla', 'só se você cantar Diego'],
    ];
    let min = 0;
    for (const [p, n, t] of falas) await x.send({ phone: p, name: n, at: `2026-11-09T10:${String(min++).padStart(2, '0')}:00Z`, text: t });
  }

  it('a IA escolhe entre os casais permitidos, o bot marca e explica, sem telefone na IA', async () => {
    w = await world();
    const mentioned = withMentions(w);
    await conversa(w);
    w.ai.textAnswer = JSON.stringify({
      casais: [
        { a: 'P1', b: 'P3', motivo: 'proibido: as duas são héteros' },
        { a: 'P1', b: 'P2', motivo: 'P1 chamou e P2 topou a pizza na hora 🍕' },
        { a: 'P3', b: 'P4', motivo: 'Carla toca, Diego canta 🎸' },
      ],
    });
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#Shippar' });
    const out = w.wa.last();
    expect(out).toContain('Shippômetro');
    expect(out).toContain(`1️⃣ @${ANA} (*Ana*) + @${BRUNO} (*Bruno*)`);
    expect(out).toContain('_Ana chamou e Bruno topou a pizza na hora 🍕_');
    expect(out).toContain(`2️⃣ @${CARLA} (*Carla*) + @${DIEGO} (*Diego*)`);
    expect(out).not.toContain('proibido');
    expect(out).toContain('3️⃣'); // o 3º casal repete uma pessoa (só há 4 pessoas), com motivo reserva
    expect(out).toContain('Só brincadeira');
    expect(mentioned.at(-1)).toHaveLength(4); // sem repetir o mesmo @
    const prompt = w.ai.prompts.at(-1)!;
    expect(prompt).not.toMatch(/55119/);
    expect(prompt).toContain('P1: Ana');
    expect(prompt).toContain('P2: eu quero! pizza de calabresa');
    expect(prompt).not.toContain('P1+P3');
  });

  it(`não repete casal por ${SHIP_SEM_REPETIR} rodadas`, async () => {
    w = await world();
    await conversa(w);
    w.ai.textAnswer = 'sem json';
    // héteros: Ana+Bruno, Ana+Diego, Carla+Bruno, Carla+Diego = 4 casais possíveis
    const saiu: string[] = [];
    for (let i = 0; i < 3; i++) {
      await w.send({ phone: ANA, name: 'Ana', at: `2026-11-09T12:0${i}:00Z`, text: '#shippar' });
      saiu.push(w.wa.last());
    }
    const casais = saiu.flatMap((t) => [...t.matchAll(/\*(\w+)\* \+ \*(\w+)\*/g)].map((m) => [m[1], m[2]].sort().join('+')));
    expect(new Set(casais).size).toBe(casais.length);
    expect(casais).toHaveLength(4);
    expect(saiu.at(-1)).toContain('Não achei casal novo');
    const rows = await w.sql`select count(distinct run_at)::int as n from romance_pairs where kind = 'ship'`;
    expect(rows[0]!.n).toBe(2);
  });

  it('quem está "fora" não entra e pouca conversa avisa', async () => {
    w = await world();
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T10:00:00Z', text: 'oi' });
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#shippar' });
    expect(w.wa.last()).toContain('Quase não teve conversa');

    await conversa(w);
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T11:00:00Z', text: '#orientação fora' });
    await w.send({ phone: DIEGO, name: 'Diego', at: '2026-11-09T11:01:00Z', text: '#orientação fora' });
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:01:00Z', text: '#shippar' });
    expect(w.wa.last()).toContain('Não achei casal novo');
  });
});
