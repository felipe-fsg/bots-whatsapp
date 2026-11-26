import { foldCommand } from '../../core/commands.js';

export type Genero = 'h' | 'm' | 'nb';
export type Orientacao = 'hetero' | 'homo' | 'bi' | 'fora';

export interface Perfil {
  gender: Genero;
  orientation: Orientacao;
}

// ---------- Gênero pelo primeiro nome (quando a pessoa não registrou) ----------

/** Nomes femininos que não terminam em "a". */
const FEMININOS = new Set(
  (
    'beatriz isabel raquel rachel ester esther rute ruth carmen ingrid miriam lourdes mercedes ines alice simone denise aline ' +
    'gisele michele michelle daniele danielle gabriele gabrielle isabele isabelle rafaele raffaele kelly kelli nicole ellen karen ' +
    'evelyn evelin jennifer jenifer kimberly shirley sueli suely nely deise thais lais iris beth ivone cleide neide maite liz lis ' +
    'anne ane mabel cibele irene solange marlene ivete yasmin jasmin jasmine ketlyn ketlin carol mel babi gabi mari nati lari ' +
    'pati tati cami isa bia ju dri lu flor luz noemi abigail rosimeire rosemeire rosimeri rose rosane elaine helen hellen ' +
    'jaqueline jacqueline caroline carolina gislaine viviane cristiane juliane luciane tatiane eliane rosiane daiane dayane ' +
    'joyce agnes doris ilze lucimar lucineide edileuza'
  ).split(' '),
);

/** Nomes masculinos que parecem femininos pela terminação. */
const MASCULINOS = new Set(
  (
    'luca lucca joshua josua nikita mattia juca zeca dida garrincha costa rene maurice jose jorge felipe alexandre guilherme ' +
    'henrique vicente duarte davi levi ravi henri rudi andre mike jake luke george jaime noa'
  ).split(' '),
);

/** Nomes ou apelidos usados por homens e mulheres: melhor não chutar. */
const AMBIGUOS = new Set(
  (
    'andrea sasha alex ariel darci darcy jaci juraci cris chris dani rafa fran nic kim sam jo val eli ale fer gui ' +
    'sol rubi akira yuri iuri juju dudu lele'
  ).split(' '),
);

/** Terminações típicas de nomes femininos que não acabam em "a" (Viviane, Denise, Michele...). */
const SUFIXOS_FEMININOS = ['iane', 'ane', 'ene', 'ine', 'ele', 'elle', 'ete', 'ette', 'eide', 'ice', 'ise', 'lyn', 'lin'];

/** Primeiro nome "limpo" (sem acento, emoji, Dr./Dra.). Vazio se não tiver letras. */
export function primeiroNome(name: string): string {
  const words = foldCommand(name)
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const skip = new Set(['dr', 'dra', 'prof', 'profa', 'sr', 'sra', 'tio', 'tia', 'pastor', 'pr']);
  return words.find((x) => !skip.has(x)) ?? '';
}

/** Chuta o gênero pelo primeiro nome. null quando não dá para saber (nome neutro, apelido, emoji). */
export function generoPeloNome(name: string): 'h' | 'm' | null {
  const raw = foldCommand(name)
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (raw.some((x) => ['dra', 'profa', 'sra', 'tia'].includes(x))) return 'm';
  if (raw.some((x) => ['dr', 'prof', 'sr', 'tio', 'pastor', 'pr'].includes(x))) return 'h';
  const n = primeiroNome(name);
  if (n.length < 2 || AMBIGUOS.has(n)) return null;
  if (MASCULINOS.has(n)) return 'h';
  if (FEMININOS.has(n)) return 'm';
  if (n.endsWith('a')) return 'm';
  if (SUFIXOS_FEMININOS.some((s) => n.endsWith(s) && n.length > s.length + 1)) return 'm';
  // "Dani", "Davi", "Kely": terminação em i/y serve para os dois
  if (/[iy]$/.test(n)) return null;
  return 'h';
}

// ---------- O que a pessoa escreve no #orientação ----------

export type LeituraOrientacao =
  | { kind: 'remover' }
  | { kind: 'mostrar' }
  | { kind: 'ok'; gender: Genero | null; orientation: Orientacao }
  | { kind: 'invalido' };

/**
 * Lê "#orientação hetero", "mulher bi", "homem gay", "lésbica", "não binário pan", "fora", "remover"...
 * gender null = a pessoa não disse (o bot tenta pelo nome).
 */
export function lerOrientacao(text: string): LeituraOrientacao {
  const t = ` ${foldCommand(text).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (t.trim() === '') return { kind: 'mostrar' };
  if (/ (remover|remove|apagar|apaga|tirar|tira|excluir|deletar|esquecer) /.test(t)) return { kind: 'remover' };

  let gender: Genero | null = null;
  if (/ (nao binari[oae]|nb|enby|naobinari[oae]) /.test(t)) gender = 'nb';
  else if (/ (mulher|feminino|fem|f|moca|garota|menina|trans mulher|mulher trans) /.test(t)) gender = 'm';
  else if (/ (homem|masculino|masc|h|cara|rapaz|garoto|menino) /.test(t)) gender = 'h';

  let orientation: Orientacao | null = null;
  if (/ (fora|nao participo|nao quero|nao jogo|sai|sair|assexual|ace) /.test(t)) orientation = 'fora';
  else if (/ (bi|bissexual|pan|pansexual|fluido|tanto faz) /.test(t)) orientation = 'bi';
  else if (/ (gay|lesbica|homo|homossexual|homosexual|sapatao|viado) /.test(t)) orientation = 'homo';
  else if (/ (hetero|heterossexual|heterosexual|htero|het) /.test(t)) orientation = 'hetero';

  if (!orientation) return { kind: 'invalido' };
  if (/ lesbica /.test(t) && !gender) gender = 'm';
  if (/ (gay|viado) /.test(t) && !gender) gender = 'h';
  return { kind: 'ok', gender, orientation };
}

// ---------- Quem combina com quem ----------

/** Gêneros por quem a pessoa se interessa. Não-binário hetero/homo não fica claro, então não entra. */
function interesse(p: Perfil): Genero[] {
  switch (p.orientation) {
    case 'bi':
      return ['h', 'm', 'nb'];
    case 'hetero':
      return p.gender === 'h' ? ['m'] : p.gender === 'm' ? ['h'] : [];
    case 'homo':
      return p.gender === 'nb' ? [] : [p.gender];
    default:
      return [];
  }
}

/** Os dois se interessam um pelo outro. */
export function combinam(a: Perfil, b: Perfil): boolean {
  return interesse(a).includes(b.gender) && interesse(b).includes(a.gender);
}

/** Perfil de quem não registrou: nome masculino = homem hetero, feminino = mulher hetero; nome neutro fica de fora. */
export function perfilPeloNome(name: string): Perfil | null {
  const g = generoPeloNome(name);
  return g ? { gender: g, orientation: 'hetero' } : null;
}

export function rotulo(p: Perfil): string {
  const g = { h: 'homem', m: 'mulher', nb: 'não binário' }[p.gender];
  const o = { hetero: 'hétero', homo: p.gender === 'm' ? 'lésbica' : 'gay', bi: 'bi/pan', fora: 'fora das brincadeiras' }[p.orientation];
  return p.orientation === 'fora' ? o : `${g}, ${o}`;
}
