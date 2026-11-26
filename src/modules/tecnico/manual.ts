/** Transforma o texto de um manual em PDF (uma string por página) em fichas M para a base técnica. */
import type { FichaCarga } from './carga.js';

export interface ManualInfo {
  documento: string;
  fabricante: string;
  modelo: string;
}

/** Tamanho alvo de cada ficha, em caracteres. Página maior que isso vira mais de uma ficha. */
export const TAMANHO_FICHA = 2000;
/** Página com menos texto que isso é ignorada (capa, página em branco, só figura). */
export const MINIMO_PAGINA = 120;

export const mId = (n: number) => 'M' + String(n).padStart(5, '0');
export const mNumber = (id: unknown) => {
  const m = /^M(\d+)$/.exec(String(id ?? '').trim().toUpperCase());
  return m ? Number(m[1]) : null;
};

/** Separa a saída do pdftotext em páginas (ele usa \f entre elas). */
export function splitPages(raw: string): string[] {
  const pages = raw.split('\f');
  if (pages.length > 1 && !pages[pages.length - 1]!.trim()) pages.pop();
  return pages;
}

function clean(page: string): string {
  return page
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Linhas que se repetem em muitas páginas (rodapé, aviso de copyright) só atrapalham a busca. */
function repeatedLines(pages: string[]): Set<string> {
  const freq = new Map<string, number>();
  for (const p of pages) for (const l of new Set(p.split('\n'))) if (l.length > 3) freq.set(l, (freq.get(l) ?? 0) + 1);
  const limite = Math.max(5, pages.length * 0.3);
  return new Set([...freq].filter(([, n]) => n >= limite).map(([l]) => l));
}

/** Divide um texto longo em partes perto de `alvo`, de preferência entre parágrafos, depois entre linhas. */
export function splitText(text: string, alvo = TAMANHO_FICHA): string[] {
  if (text.length <= alvo * 1.3) return [text];
  const n = Math.ceil(text.length / alvo);
  const size = Math.ceil(text.length / n);
  const parts: string[] = [];
  let rest = text;
  while (rest.length > size * 1.3) {
    const janela = rest.slice(0, Math.round(size * 1.25));
    let cut = janela.lastIndexOf('\n\n');
    if (cut < size * 0.6) cut = janela.lastIndexOf('\n');
    if (cut < size * 0.6) cut = janela.lastIndexOf('. ') + 1;
    if (cut < size * 0.6) cut = size;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

/**
 * Gera as fichas do manual, numeradas a partir de `primeiroId` (ex.: 915 -> M00915).
 * O resultado é sempre o mesmo para o mesmo PDF, então dá para rodar de novo e continuar de onde parou.
 */
export function fichasDoManual(pagesRaw: string[], info: ManualInfo, primeiroId: number): FichaCarga[] {
  const pages = pagesRaw.map(clean);
  const rep = repeatedLines(pages);
  const fichas: FichaCarga[] = [];
  let n = primeiroId;
  pages.forEach((page, i) => {
    const text = page
      .split('\n')
      .filter((l) => !rep.has(l))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (text.replace(/\s/g, '').length < MINIMO_PAGINA) return;
    const pagina = 'p. ' + (i + 1);
    const parts = splitText(text);
    parts.forEach((part, k) => {
      const parte = parts.length > 1 ? ` (parte ${k + 1} de ${parts.length})` : '';
      fichas.push({
        content: `${info.documento}, ${pagina}${parte}\n${part}`,
        metadata: {
          id: mId(n++),
          tipo: 'manual',
          fabricante: info.fabricante,
          modelo: info.modelo,
          documento: info.documento,
          pagina,
          situacao: 'manual',
          confianca: 'alta',
          status_revisao: 'manual',
          quem_orientou: 'Manual ' + info.fabricante,
          alerta_seguranca: '',
        },
      });
    });
  });
  return fichas;
}
