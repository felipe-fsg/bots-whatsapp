import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { GitHubIssues } from '../src/core/github.js';

const ADMIN = '5511900000001';
const ANA = '5511911111111';

let w: World;
afterEach(async () => {
  await w?.sql.end();
});

describe('#suporte', () => {
  it('só admin abre; guarda o pedido (com a mensagem citada) e responde com o número', async () => {
    w = await world();
    await w.send({ phone: ANA, name: 'Ana', at: '2026-11-12T12:00:00Z', text: '#suporte o bot não respondeu' });
    expect(w.wa.last()).toContain('Só os admins');

    await w.send({ phone: ADMIN, name: 'Felipe', at: '2026-11-12T12:01:00Z', text: '#suporte' });
    expect(w.wa.last()).toContain('Ex.: #suporte');

    await w.send({ phone: ADMIN, name: 'Felipe', at: '2026-11-12T12:02:00Z', text: '#Suporte o ranking não contou o treino de ontem' });
    expect(w.wa.last()).toContain('nº 1 anotado');
    await w.send({
      phone: ADMIN,
      name: 'Felipe',
      at: '2026-11-12T12:03:00Z',
      text: '#suporte isso aqui deveria valer ponto',
      quoted: { id: 'X1', participant: `${ANA}@s.whatsapp.net`, text: '#treino corrida 5 km' },
    });
    expect(w.wa.last()).toContain('nº 2 anotado');

    const rows = await w.sql<{ text: string; name: string; issue_number: number | null }[]>`select text, name, issue_number from support_requests order by id`;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text).toBe('o ranking não contou o treino de ontem');
    expect(rows[1]!.text).toContain('Mensagem citada: "#treino corrida 5 km"');
    expect(rows[1]!.name).toBe('Felipe');
    expect(rows[0]!.issue_number).toBeNull(); // sem token do GitHub, fica só no banco
  });
});

describe('issues no GitHub', () => {
  it('cria a issue com a etiqueta e tenta sem ela se o GitHub recusar', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      if (body.labels) return new Response('{"message":"Validation Failed"}', { status: 422 });
      return new Response(JSON.stringify({ number: 7, html_url: 'https://github.com/o/r/issues/7' }), { status: 201 });
    }) as typeof fetch;
    const gh = new GitHubIssues('o/r', 'tok', fake);
    const out = await gh.create({ title: 't', body: 'b', labels: ['suporte'] });
    expect(out).toEqual({ number: 7, url: 'https://github.com/o/r/issues/7' });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('https://api.github.com/repos/o/r/issues');
    expect(calls[1]!.body.labels).toBeUndefined();
  });
});
