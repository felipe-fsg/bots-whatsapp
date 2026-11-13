/** Tira acentos e deixa em minúsculas ('#NãoCuriar' -> '#naocuriar'). */
export function foldCommand(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Comandos não diferenciam maiúsculas nem acentos: se a mensagem começa com
 * #, !, / ou \, a primeira palavra vira minúscula e sem acento
 * ('#Ranking' -> '#ranking', '#NÃOCURIAR' -> '#naocuriar'). O resto do texto
 * (nomes, perguntas) fica como a pessoa escreveu.
 */
export function normalizeCommand(text: string): string {
  const m = /^(\s*)([#!/\\]\S*)/u.exec(text);
  if (!m) return text;
  return m[1]! + foldCommand(m[2]!) + text.slice(m[0].length);
}
