import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { parseHandle } from '../src/features/instagram/index.js';

const ANA = '5511911111111';
const BRUNO = '5511922222222';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

describe('lista de Instagram', () => {
  it('entende @, nome solto e link do perfil', () => {
    expect(parseHandle('@Ana.Souza')).toBe('ana.souza');
    expect(parseHandle('ana_souza')).toBe('ana_souza');
    expect(parseHandle('https://www.instagram.com/ana.souza/?hl=pt-br')).toBe('ana.souza');
    expect(parseHandle('instagram.com/ana_s')).toBe('ana_s');
    expect(parseHandle('não tenho')).toBe('');
    expect(parseHandle('@a..b')).toBe('');
  });

  it('#insta grava, troca e remove; #listainsta mostra em ordem de nome', async () => {
    w = await world();
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:00:00Z', text: '#listainsta' });
    expect(w.wa.last()).toContain('Ninguém colocou');

    await w.send({ phone: BRUNO, name: 'Bruno', at: '2026-11-09T12:01:00Z', text: '#Insta @bruno.lima' });
    expect(w.wa.last()).toContain('@bruno.lima');
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:02:00Z', text: '#insta https://instagram.com/ana_old' });
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:03:00Z', text: '#insta @ana.souza' });
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:04:00Z', text: '#ListaInsta' });
    const list = w.wa.last();
    expect(list).toContain('(2)');
    expect(list).not.toContain('ana_old');
    expect(list.indexOf('instagram.com/ana.souza')).toBeLessThan(list.indexOf('instagram.com/bruno.lima'));

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:05:00Z', text: '#removeInsta' });
    expect(w.wa.last()).toContain('saiu da lista');
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:06:00Z', text: '#listainsta' });
    expect(w.wa.last()).toContain('(1)');
    expect(w.wa.last()).not.toContain('ana.souza');

    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-09T12:07:00Z', text: '#insta' });
    expect(w.wa.last()).toContain('Ex.: #insta @fulano');
  });
});
