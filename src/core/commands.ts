/** Tira acentos e deixa em minúsculas ('#NãoCuriar' -> '#naocuriar'). */
export function foldCommand(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Caracteres que não aparecem na tela mas vêm grudados no texto: espaço de
 * largura zero, marcas de direção do texto (teclados em árabe/hebraico, texto
 * colado), BOM, hífen invisível, espaço que não quebra etc. Se vierem antes do
 * #, o bot não reconhecia o comando.
 */
const INVISIBLE = /[\u00A0\u00AD\u034F\u061C\u115F\u1160\u180E\u200B-\u200F\u202A-\u202F\u205F-\u206F\u3000\u3164\uFEFF\uFFA0]/gu;

/** Versões "de outro alfabeto" dos símbolos de comando (ex.: ＃ de teclado japonês/chinês). */
const LOOKALIKES: Record<string, string> = { '\uFF03': '#', '\uFE5F': '#', '\uFF01': '!', '\uFE57': '!', '\uFF1F': '?', '\uFE56': '?', '\uFF0F': '/' };

const LEADING = /^[\s\u00A0\u00AD\u034F\u061C\u115F\u1160\u180E\u200B-\u200F\u202A-\u202F\u205F-\u206F\u3000\u3164\uFEFF\uFFA0]+/u;

/**
 * Limpa o começo da mensagem: tira espaços e caracteres invisíveis e troca
 * símbolos parecidos (＃) pelo normal. Se a primeira palavra for comando, tira
 * também invisíveis do meio dela ('#ran​king' -> '#ranking'). O resto do
 * texto fica como a pessoa escreveu (emojis compostos usam caractere invisível).
 */
export function cleanStart(text: string): string {
  let t = text.replace(LEADING, '');
  const first = t.charAt(0);
  if (LOOKALIKES[first]) t = LOOKALIKES[first] + t.slice(1);
  const m = /^[#!?/\\]\S*/u.exec(t);
  if (m) t = m[0].replace(INVISIBLE, '') + t.slice(m[0].length);
  return t;
}

/**
 * Comandos não diferenciam maiúsculas nem acentos: se a mensagem começa com
 * #, !, / ou \, a primeira palavra vira minúscula e sem acento
 * ('#Ranking' -> '#ranking', '#NÃOCURIAR' -> '#naocuriar'). O resto do texto
 * (nomes, perguntas) fica como a pessoa escreveu. Espaços e caracteres
 * invisíveis antes do comando são tirados.
 */
export function normalizeCommand(text: string): string {
  const clean = cleanStart(text);
  const m = /^[#!/\\]\S*/u.exec(clean);
  if (!m) return clean;
  return foldCommand(m[0]) + clean.slice(m[0].length);
}
