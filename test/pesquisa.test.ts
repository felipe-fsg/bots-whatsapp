import { afterEach, describe, expect, it } from 'vitest';
import { world, type World } from './helpers.js';
import { isPlaceQuery, parsePesquisa, sourcesText, tidy } from '../src/features/pesquisa/index.js';
import { Gemini } from '../src/core/ai/gemini.js';
import { GooglePlaces } from '../src/core/places.js';

const ANA = '5511911111111';

let w: World | undefined;
afterEach(async () => {
  await w?.sql.end();
  w = undefined;
});

describe('pesquisa na internet', () => {
  it('reconhece o comando e o tipo de pergunta', () => {
    expect(parsePesquisa('?pesquisa restaurantes de sushi na Liberdade')).toBe('restaurantes de sushi na Liberdade');
    expect(parsePesquisa('#Pesquisar  previsão do tempo amanhã')).toBe('previsão do tempo amanhã');
    expect(parsePesquisa('!pesquisa')).toBe('');
    expect(parsePesquisa('?pesquisas')).toBeNull();
    expect(parsePesquisa('?tapioca')).toBeNull();
    expect(parsePesquisa('vou pesquisar isso')).toBeNull();

    expect(isPlaceQuery('restaurantes de sushi na Liberdade')).toBe(true);
    expect(isPlaceQuery('onde comer pastel em Santos')).toBe(true);
    expect(isPlaceQuery('Farmácia 24h perto da Paulista')).toBe(true);
    expect(isPlaceQuery('quem ganhou o jogo do Palmeiras ontem')).toBe(false);
    expect(isPlaceQuery('mercado financeiro hoje')).toBe(false);
  });

  it('formata a resposta e as fontes para o WhatsApp', () => {
    expect(tidy('## Dica\n**Sushi** bom [1, 2] em [Liberdade](https://x.com)')).toBe('*Dica*\n*Sushi* bom  em Liberdade');
    expect(
      sourcesText([
        { title: 'a.com', url: 'https://www.a.com/1' },
        { title: 'a.com', url: 'https://a.com/2' },
        { title: 'b.com.br', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz' },
        { title: 'c.com', url: 'https://c.com' },
        { title: 'd.com', url: 'https://d.com' },
      ]),
    ).toBe('\n\n🔗 *Fontes*\n• https://www.a.com/1\n• b.com.br\n• https://c.com');
    expect(sourcesText([])).toBe('');
  });

  it('lugares vêm do Google Maps; o resto, da pesquisa no Google pelo Gemini', async () => {
    w = await world();
    w.places.found = [
      { name: 'Sushi Kodai', address: 'R. Galvão Bueno, 100 - Liberdade, São Paulo - SP', rating: 4.7, ratings: 1234, mapsUrl: 'https://maps.google.com/?cid=1' },
      { name: 'Temakeria Sol', address: 'R. dos Estudantes, 5 - Liberdade', mapsUrl: 'https://maps.google.com/?cid=2' },
    ];
    await w.send({ phone: ANA, at: '2026-11-09T12:00:00Z', text: '?pesquisa restaurantes de sushi na Liberdade' });
    expect(w.places.searches).toEqual(['restaurantes de sushi na Liberdade']);
    const reply = w.wa.last();
    expect(reply).toContain('📍 *restaurantes de sushi na Liberdade*');
    expect(reply).toContain('1. *Sushi Kodai* ⭐ 4,7 (1.234)');
    expect(reply).toContain('https://maps.google.com/?cid=1');
    expect(reply).toContain('2. *Temakeria Sol*\n');
    // não virou pergunta de alimento do Splinter
    expect(w.wa.sent).toHaveLength(1);

    w.ai.researchAnswer = { text: 'O **Palmeiras** venceu por 2 a 1.', sources: [{ title: 'ge.globo', url: 'https://ge.globo.com/jogo' }] };
    await w.send({ phone: ANA, at: '2026-11-09T12:01:00Z', text: '?pesquisa quem ganhou o jogo do Palmeiras ontem' });
    expect(w.ai.prompts.at(-1)).toContain('Hoje é 09/11/2026');
    expect(w.wa.last()).toBe('🔎 *quem ganhou o jogo do Palmeiras ontem*\n\nO *Palmeiras* venceu por 2 a 1.\n\n🔗 *Fontes*\n• https://ge.globo.com/jogo');

    // lugar sem resultado no Maps cai na pesquisa na internet
    w.places.found = [];
    await w.send({ phone: ANA, at: '2026-11-09T12:02:00Z', text: '?pesquisa pizzaria em Marte' });
    expect(w.wa.last()).toMatch(/^🔎 \*pizzaria em Marte\*/);

    await w.send({ phone: ANA, at: '2026-11-09T12:03:00Z', text: '?pesquisa' });
    expect(w.wa.last()).toContain('Ex.: ?pesquisa');

    w.ai.researchAnswer = new Error('quota');
    await w.send({ phone: ANA, at: '2026-11-09T12:04:00Z', text: '#pesquisa cotação do dólar' });
    expect(w.wa.last()).toContain('Não consegui pesquisar agora');

    await w.send({ phone: ANA, at: '2026-11-09T12:05:00Z', text: '#ajuda' });
    expect(w.wa.last()).toContain('?pesquisa');
  });
});

describe('clientes do Google', () => {
  it('Gemini liga o Google Search e troca o redirecionamento pelo link da página', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('grounding-api-redirect')) return new Response(null, { status: 302, headers: { location: 'https://site.com/pagina' } });
      return Response.json({
        candidates: [
          {
            content: { parts: [{ text: 'Resposta' }] },
            groundingMetadata: { groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'site.com' } }] },
          },
        ],
      });
    }) as unknown as typeof fetch;
    const r = await new Gemini('chave', 'modelo', fakeFetch).research('pergunta');
    expect(r).toEqual({ text: 'Resposta', sources: [{ title: 'site.com', url: 'https://site.com/pagina' }] });
    expect(JSON.parse(String(calls[0]!.init!.body)).tools).toEqual([{ google_search: {} }]);
  });

  it('Places busca por texto', async () => {
    let body: any;
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init!.body));
      return Response.json({
        places: [{ displayName: { text: 'Sushi X' }, formattedAddress: 'Rua A', rating: 4.5, userRatingCount: 10, googleMapsUri: 'https://maps.google.com/?cid=9' }],
      });
    }) as unknown as typeof fetch;
    const r = await new GooglePlaces('chave', fakeFetch).search('sushi', 3);
    expect(body).toMatchObject({ textQuery: 'sushi', regionCode: 'BR', pageSize: 3 });
    expect(r).toEqual([{ name: 'Sushi X', address: 'Rua A', rating: 4.5, ratings: 10, mapsUrl: 'https://maps.google.com/?cid=9' }]);
  });
});
