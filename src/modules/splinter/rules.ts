import type { Challenge, CheckinStatus, Rule } from './types.js';

/** Hashtags da legenda, em minúsculas ('Treino hoje #Treino #foco' -> ['#treino', '#foco']). */
export function hashtags(text: string): string[] {
  return (text.toLowerCase().match(/#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.normalize('NFC'));
}

/** Primeira regra ativa cuja hashtag aparece na legenda. */
export function findRule(text: string, rules: Rule[]): Rule | undefined {
  const tags = new Set(hashtags(text));
  return rules.find((r) => r.active && tags.has(r.hashtag.toLowerCase().trim()));
}

/** A foto vale para o dia em que foi mandada, até o horário limite, dentro das datas do desafio. */
export function inPeriod(day: string, time: string, ch: Pick<Challenge, 'starts_on' | 'ends_on' | 'checkin_deadline'>): boolean {
  return day >= ch.starts_on && day <= ch.ends_on && time <= ch.checkin_deadline;
}

export interface Counts {
  /** Check-ins não recusados da mesma categoria no mesmo dia. */
  sameDay: number;
  /** Treinos não recusados na mesma semana (segunda a domingo). */
  sameWeek: number;
  duplicatePhoto: boolean;
}

export interface Decision {
  status: CheckinStatus;
  reason: string;
  points: number;
}

export const REASONS = {
  duplicate: 'Foto já usada antes',
  dailyLimit: 'Categoria já pontuada hoje',
  weeklyLimit: 'Limite semanal de treinos atingido',
  foodUnhealthy: 'IA: prato não saudável',
  foodUnsure: 'IA: não foi possível confirmar',
  poseDifferent: 'IA: pose diferente da pose do dia',
  poseUnsure: 'IA: não foi possível confirmar a pose',
  poseMissing: 'Pose do dia ainda não cadastrada',
  noPlace: 'Nenhum local de treino perto da localização enviada',
  locationLate: 'Localização não enviada no prazo',
} as const;

/** Regras do desafio para uma foto com hashtag válida, de participante inscrito e dentro do prazo. */
export function decide(rule: Rule, ch: Pick<Challenge, 'require_location' | 'max_workouts_week'>, c: Counts): Decision {
  const weekly = rule.kind === 'treino' && ch.max_workouts_week > 0 && c.sameWeek >= ch.max_workouts_week;
  if (c.duplicatePhoto) return { status: 'recusado', reason: REASONS.duplicate, points: 0 };
  if (c.sameDay >= Math.max(1, rule.max_per_day)) return { status: 'recusado', reason: REASONS.dailyLimit, points: 0 };
  if (weekly) return { status: 'recusado', reason: REASONS.weeklyLimit, points: 0 };
  if (rule.kind === 'treino' && ch.require_location) return { status: 'aguardando_localizacao', reason: '', points: rule.points };
  return { status: 'valido', reason: '', points: rule.points };
}

/** Lê a resposta da IA no formato 'VEREDITO: X / MOTIVO: ...'. */
export function parseVerdict<T extends string>(text: string, options: readonly T[], fallback: T): { verdict: T; why: string } {
  const sorted = [...options].sort((a, b) => b.length - a.length); // NAO_SAUDAVEL antes de SAUDAVEL
  const m = text.match(new RegExp(`VEREDITO:\\s*\\**\\s*(${sorted.join('|')})`, 'i'));
  const why = text.match(/MOTIVO:\s*\**\s*(.+)/i)?.[1]?.replace(/\*+$/, '').trim() ?? '';
  return { verdict: (m?.[1]?.toUpperCase() as T) ?? fallback, why: why || 'Sem resposta da IA' };
}

export function applyFoodVerdict(d: Decision, verdict: 'SAUDAVEL' | 'NAO_SAUDAVEL' | 'DUVIDA'): Decision {
  if (verdict === 'SAUDAVEL') return d;
  if (verdict === 'NAO_SAUDAVEL') return { status: 'recusado', reason: REASONS.foodUnhealthy, points: 0 };
  return { ...d, status: 'em_revisao', reason: REASONS.foodUnsure };
}

export function applyPoseVerdict(d: Decision, verdict: 'MESMA_POSE' | 'POSE_DIFERENTE' | 'DUVIDA'): Decision {
  if (verdict === 'MESMA_POSE') return d;
  return { ...d, status: 'em_revisao', reason: verdict === 'POSE_DIFERENTE' ? REASONS.poseDifferent : REASONS.poseUnsure };
}

export type Command =
  | { type: 'ranking' }
  | { type: 'equipes' }
  | { type: 'regras' }
  | { type: 'alimento'; food: string }
  | { type: 'inscrever'; name: string }
  | { type: 'pendentes' }
  | { type: 'aprovar'; note: string }
  | { type: 'recusar'; note: string }
  | { type: 'equipe'; name: string }
  | { type: 'meulocal'; name: string };

/** Comandos de texto. '!' ainda é aceito nos comandos antigos. */
export function parseCommand(text: string): Command | null {
  const t = text.trim();
  if (/^[#!]ranking\b/i.test(t)) return { type: 'ranking' };
  if (/^[#!]equipes\b/i.test(t)) return { type: 'equipes' };
  if (/^[#!]regras\b/i.test(t)) return { type: 'regras' };
  if (/^[#!]pendentes\b/i.test(t)) return { type: 'pendentes' };
  if (/^\?\s*[^\s?]/.test(t)) return { type: 'alimento', food: t.replace(/^\?+/, '').trim() };
  if (/^#inscrever\b/i.test(t)) return { type: 'inscrever', name: clean(t.replace(/^#inscrever/i, ''), 60) };
  if (/^#aprovar\b/i.test(t)) return { type: 'aprovar', note: t.replace(/^#aprovar/i, '').trim() };
  if (/^#recusar\b/i.test(t)) return { type: 'recusar', note: t.replace(/^#recusar/i, '').trim() };
  if (/^#meulocal\b/i.test(t)) return { type: 'meulocal', name: clean(t.replace(/^#meulocal/i, ''), 60) };
  if (/^#equipe\b/i.test(t)) return { type: 'equipe', name: clean(t.replace(/^#equipe/i, '').replace(/@\S+/g, ''), 40) };
  return null;
}

function clean(s: string, max: number): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, max);
}

export const POSE_TAG = '#posedodia';
