import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { parabensJob, parseNascimento, signoDe, signoPorNome } from '../src/features/aniversario/index.js';

const ANA = '5511911111111';
const BRUNO = '5511922222222';
const FELIPE = '5511900000001';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

const ctxOf = async (w: World) => w.runtime.context((await w.runtime.activeBots())[0]!);

function tagging(w: World) {
  const mentioned: string[][] = [];
  Object.assign(w.wa, {
    sendTextMentions: async (chat: string, text: string, jids: string[]) => {
      mentioned.push(jids);
      w.wa.sent.push({ chat, text });
    },
  });
  return mentioned;
}

describe('datas e signos', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  it('entende vários jeitos de escrever a data', () => {
    expect(parseNascimento('15/03', now)).toEqual({ day: 15, month: 3, year: null });
    expect(parseNascimento('15/03/1990', now)).toEqual({ day: 15, month: 3, year: 1990 });
    expect(parseNascimento('5-3-90', now)).toEqual({ day: 5, month: 3, year: 1990 });
    expect(parseNascimento('5.3.05', now)).toEqual({ day: 5, month: 3, year: 2005 });
    expect(parseNascimento('15 de Março', now)).toEqual({ day: 15, month: 3, year: null });
    expect(parseNascimento('1 de janeiro de 2000', now)).toEqual({ day: 1, month: 1, year: 2000 });
    expect(parseNascimento('29/02', now)).toEqual({ day: 29, month: 2, year: null });
    for (const bad of ['31/04', '29/02/2023', '10/13', '15/03/2030', 'amanhã', '15 de marçalo']) expect(parseNascimento(bad, now)).toBeNull();
  });

  it('acha o signo pela data e pelo nome', () => {
    expect(signoDe(1, 1).name).toBe('Capricórnio');
    expect(signoDe(19, 1).name).toBe('Capricórnio');
    expect(signoDe(20, 1).name).toBe('Aquário');
    expect(signoDe(20, 3).name).toBe('Peixes');
    expect(signoDe(21, 3).name).toBe('Áries');
    expect(signoDe(23, 7).name).toBe('Leão');
    expect(signoDe(21, 12).name).toBe('Sagitário');
    expect(signoDe(22, 12).name).toBe('Capricórnio');
    expect(signoPorNome('leao')?.name).toBe('Leão');
    expect(signoPorNome('GÊMEOS')?.name).toBe('Gêmeos');
    expect(signoPorNome('dragão')).toBeNull();
  });
});

describe('#nascimento', () => {
  it('registra, mostra, troca e apaga', async () => {
    w = await world();
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#nascimento' });
    expect(w.wa.last()).toContain('#nascimento 15/03');

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#Nascimento 23/07/1990' });
    expect(w.wa.last()).toContain('*23/07*');
    expect(w.wa.last()).toContain('Leão');
    expect(w.wa.last()).toContain('não mostro a idade');
    const [row] = await w.sql`select day, month, year, phone from birthdays`;
    expect(row).toMatchObject({ day: 23, month: 7, year: 1990, phone: ANA });

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#nascimento' });
    expect(w.wa.last()).toContain('está registrado: *23/07*');

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#nascimento 31/02' });
    expect(w.wa.last()).toContain('Não entendi a data');

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#nascimento apagar' });
    expect(w.wa.last()).toContain('apaguei');
    expect(await w.sql`select 1 from birthdays`).toHaveLength(0);
  });

  it('admin respondendo a alguém registra a data dessa pessoa', async () => {
    w = await world();
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:00:00Z', text: 'oi' });
    await w.send({
      phone: FELIPE,
      name: 'Felipe',
      at: '2026-11-09T12:01:00Z',
      text: '#nascimento 10/11',
      quoted: { id: 'X', participant: `${BRUNO}@s.whatsapp.net`, text: 'oi' },
    });
    expect(w.wa.last()).toContain('aniversário de *Bruno*');
    const [row] = await w.sql`select phone from birthdays`;
    expect(row!.phone).toBe(BRUNO);
  });

  it('#aniversariantes lista os do mês sem o ano', async () => {
    w = await world();
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#nascimento 09/11/1990' });
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:00:00Z', text: '#nascimento 25/11' });
    await w.send({ phone: FELIPE, name: 'Felipe', at: '2026-11-09T12:00:00Z', text: '#nascimento 01/01' });
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#aniversariantes' });
    const out = w.wa.last();
    expect(out).toContain('novembro');
    expect(out).toContain('09/11 - Ana 🎉 hoje!');
    expect(out).toContain('25/11 - Bruno');
    expect(out).not.toContain('Felipe');
    expect(out).not.toContain('1990');
  });
});

describe('parabéns automático', () => {
  it('marca os aniversariantes do dia uma vez só', async () => {
    w = await world();
    const mentioned = tagging(w);
    w.ai.textAnswer = 'Parabéns, Ana e Bruno! **Festa!**';
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-01T12:00:00Z', text: '#nascimento 09/11/1990' });
    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-01T12:00:00Z', text: '#nascimento 9 de novembro' });
    await w.send({ phone: FELIPE, name: 'Felipe', at: '2026-11-01T12:00:00Z', text: '#nascimento 10/11' });
    w.wa.clear();

    w.now.value = new Date('2026-11-09T12:00:00Z');
    await parabensJob(await ctxOf(w));
    expect(w.wa.sent).toHaveLength(1);
    const out = w.wa.last();
    expect(out).toContain(`@${ANA} (*Ana*)`);
    expect(out).toContain(`@${BRUNO} (*Bruno*)`);
    expect(out).not.toContain('Felipe');
    expect(out).toContain('*Festa!*');
    expect(mentioned.at(-1)).toEqual(expect.arrayContaining([`${ANA}@s.whatsapp.net`, `${BRUNO}@s.whatsapp.net`]));
    expect(w.ai.prompts.at(-1)).not.toContain('1990');

    await parabensJob(await ctxOf(w));
    expect(w.wa.sent).toHaveLength(1);

    // no ano seguinte, de novo
    w.now.value = new Date('2027-11-09T12:00:00Z');
    await parabensJob(await ctxOf(w));
    expect(w.wa.sent).toHaveLength(2);
  });

  it('29/02 comemora em 28/02 quando o ano não é bissexto; sem IA usa texto pronto', async () => {
    w = await world();
    w.ai.textAnswer = '';
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-01T12:00:00Z', text: '#nascimento 29/02' });
    w.wa.clear();
    w.now.value = new Date('2027-02-28T12:00:00Z');
    await parabensJob(await ctxOf(w));
    expect(w.wa.last()).toContain('🎂 *Ana*');
    expect(w.wa.last()).toContain('Parabéns, Ana');
  });
});

describe('#horoscopo', () => {
  it('pede o aniversário, depois lê o signo da pessoa marcando ela, uma vez por dia', async () => {
    w = await world();
    const mentioned = tagging(w);
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#horóscopo' });
    expect(w.wa.last()).toContain('ainda não sei o seu signo');

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#nascimento 23/07' });
    w.ai.textAnswer = 'Ana, hoje o sol brilha! **Amor:** tudo lindo.';
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#Horóscopo' });
    const out = w.wa.last();
    expect(out).toContain(`@${ANA} (*Ana*)`);
    expect(out).toContain('♌ *Horóscopo de Leão*');
    expect(out).toContain('*Amor:*');
    expect(out).toContain('Só brincadeira');
    expect(mentioned.at(-1)).toEqual([`${ANA}@s.whatsapp.net`]);
    expect(w.ai.prompts.at(-1)).toContain('O signo dessa pessoa é Leão');

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T20:00:00Z', text: '#horoscopo peixes' });
    expect(w.wa.last()).toContain('já falaram com você hoje');
  });

  it('aceita o nome do signo e admin não tem limite', async () => {
    w = await world();
    for (let i = 0; i < 2; i++) {
      await w.send({ phone: FELIPE, name: 'Felipe', at: '2026-11-09T12:00:00Z', text: '#horoscopo Escorpiao' });
      expect(w.wa.last()).toContain('♏ *Horóscopo de Escorpião*');
    }
    await w.send({ phone: FELIPE, name: 'Felipe', at: '2026-11-09T12:00:00Z', text: '#horoscopo dragão' });
    expect(w.wa.last()).toContain('Não conheço o signo');
  });
});
