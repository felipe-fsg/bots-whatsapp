import type { BotContext, BotModule, PlaceResult, WebSource } from '../../core/types.js';
import { local } from '../../core/time.js';
import { normalize } from '../agenda/parse.js';

/** ?pesquisa (ou #pesquisa, !pesquisa, ?pesquisar) seguido do que procurar. Devolve null se não for o comando. */
export function parsePesquisa(text: string): string | null {
  const m = /^[?#!]\s*pesquis(?:a|ar)(?![\p{L}\p{N}])\s*(.*)$/isu.exec(text.trim());
  return m ? m[1]!.trim().slice(0, 300) : null;
}

const PLACE_WORDS = [
  'restaurante', 'restaurantes', 'bar', 'bares', 'boteco', 'botecos', 'lanchonete', 'lanchonetes', 'pizzaria', 'pizzarias',
  'hamburgueria', 'hamburguerias', 'churrascaria', 'churrascarias', 'padaria', 'padarias', 'cafeteria', 'cafeterias',
  'sorveteria', 'sorveterias', 'doceria', 'docerias', 'hotel', 'hoteis', 'pousada', 'pousadas', 'hostel', 'academia',
  'academias', 'farmacia', 'farmacias', 'supermercado', 'supermercados', 'loja', 'lojas',
  'parque', 'parques', 'praia', 'praias', 'balada', 'baladas', 'rodizio', 'rodizios', 'temakeria', 'temakerias',
  'cinema', 'cinemas', 'shopping', 'shoppings', 'posto', 'postos', 'clinica', 'clinicas', 'hospital', 'hospitais',
];

/** A pergunta é por lugares? Aí o Google Maps traz nomes, notas e endereços reais. */
export function isPlaceQuery(query: string): boolean {
  const t = normalize(query);
  if (/\bonde (comer|tomar|beber|almocar|jantar|ficar|tem|fica|encontro|encontrar|comprar)\b/.test(t)) return true;
  if (/\b(perto d[aeo]s?|proximo d[aeo]s?|lugares?( para| pra| de)?)\b/.test(t)) return true;
  return t.split(/[^a-z0-9]+/).some((w) => PLACE_WORDS.includes(w));
}

export function placesText(query: string, places: PlaceResult[]): string {
  const L = [`📍 *${query}*`, ''];
  places.forEach((p, i) => {
    const stars = p.rating ? ` ⭐ ${p.rating.toFixed(1).replace('.', ',')}${p.ratings ? ` (${p.ratings.toLocaleString('pt-BR')})` : ''}` : '';
    L.push(`${i + 1}. *${p.name}*${stars}`);
    if (p.address) L.push(`   ${p.address}`);
    if (p.mapsUrl) L.push(`   ${p.mapsUrl}`);
  });
  L.push('', '_Fonte: Google Maps_');
  return L.join('\n');
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Fontes sem repetir o mesmo site, no máximo 3. */
export function sourcesText(sources: WebSource[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const s of sources) {
    const key = host(s.url) || s.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // link de redirecionamento do Google é enorme: mostra só o nome do site
    lines.push(s.url.includes('grounding-api-redirect') ? `• ${s.title || key}` : `• ${s.url}`);
    if (lines.length === 3) break;
  }
  return lines.length ? `\n\n🔗 *Fontes*\n${lines.join('\n')}` : '';
}

/** Deixa a resposta no formato do WhatsApp: negrito com um asterisco, sem títulos e sem links em markdown. */
export function tidy(text: string): string {
  return text
    .replace(/\*\*/g, '*')
    .replace(/^#{1,6}\s+(.*)$/gm, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/\[\d+(?:,\s*\d+)*\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function researchPrompt(query: string, today: string): string {
  return `Pesquise na internet e responda à pergunta de alguém num grupo de WhatsApp: "${query}"

Hoje é ${today}. Responda em português do Brasil, com informação atual e verificada na pesquisa, em no máximo 10 linhas curtas (listas com • são bem-vindas). Se forem lugares, traga nome, bairro e o que se destaca. Se não achar informação confiável, diga isso em vez de inventar. Formatação de WhatsApp: *negrito* com um asterisco só, sem títulos com # e sem links (as fontes vão separadas).`;
}

const USAGE = '🔎 Escreva o que quer pesquisar depois do comando. Ex.: ?pesquisa restaurantes de sushi na Liberdade';

async function search(ctx: BotContext, query: string): Promise<void> {
  if (isPlaceQuery(query)) {
    try {
      const places = await ctx.places.search(query, 5);
      if (places.length) return ctx.reply(placesText(query, places));
    } catch (err) {
      ctx.log.warn({ err: String(err) }, 'Google Places falhou na pesquisa; usando a pesquisa na internet');
    }
  }
  const today = local(ctx.now(), ctx.timezone).toFormat('dd/MM/yyyy');
  try {
    const answer = await ctx.ai.research(researchPrompt(query, today));
    const text = tidy(answer.text);
    if (!text) throw new Error('resposta vazia');
    await ctx.reply(`🔎 *${query}*\n\n${text}${sourcesText(answer.sources)}`);
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou na pesquisa na internet');
    await ctx.reply('😕 Não consegui pesquisar agora. Tente de novo em alguns minutos.');
  }
}

/** Pesquisa na internet: função do núcleo, vale para todos os bots. */
export const pesquisa: BotModule = {
  id: 'pesquisa',
  async handle(ctx, msg) {
    if (msg.type !== 'text') return false;
    const query = parsePesquisa(msg.text);
    if (query === null) return false;
    if (!query) await ctx.reply(USAGE);
    else await search(ctx, query);
    return true;
  },
};
