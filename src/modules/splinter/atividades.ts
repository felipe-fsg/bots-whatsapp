import type { BotContext, InboundMessage } from '../../core/types.js';
import type { SplinterRepo } from './repo.js';
import type { Challenge, Rule } from './types.js';
import * as M from './messages.js';

/** Funções do desafio que não são categorias de check-in, mas também podem ser ligadas e desligadas. */
export const EXTRAS = [
  { flag: 'daily_summary', label: 'Resumo diário das 4h', keys: ['resumo', 'resumodiario'] },
  { flag: 'persona_messages', label: 'Mensagens do mestre ao longo do dia', keys: ['mensagens', 'mensagem', 'mestre'] },
  { flag: 'require_location', label: 'Localização obrigatória no treino', keys: ['localizacao', 'local', 'gps'] },
] as const;

type Extra = (typeof EXTRAS)[number];
export type Target = { rule: Rule } | { extra: Extra };

/** 'Hidratação' -> 'hidratacao'. */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Acha a atividade pelo nome que o admin digitou: hashtag (com ou sem #), nome da categoria ou tipo. */
export function resolveTarget(name: string, rules: Rule[]): Target | null {
  const n = norm(name);
  if (!n) return null;
  const rule =
    rules.find((r) => norm(r.hashtag) === n) ??
    rules.find((r) => norm(r.category) === n) ??
    rules.find((r) => r.kind !== 'outro' && r.kind === n) ??
    rules.find((r) => norm(r.category).startsWith(n) && n.length >= 3);
  if (rule) return { rule };
  const extra = EXTRAS.find((e) => (e.keys as readonly string[]).includes(n));
  return extra ? { extra } : null;
}

export function activitiesText(ch: Challenge, rules: Rule[]): string {
  const L = [`🎛️ *Atividades - ${ch.name}*`, '', '📸 *Check-ins*'];
  for (const r of rules) L.push(`${r.active ? '✅' : '⛔'} ${r.hashtag} - ${r.category}`);
  L.push('', '⚙️ *Funções do desafio*');
  for (const e of EXTRAS) L.push(`${ch[e.flag] ? '✅' : '⛔'} ${e.label} (${e.keys[0]})`);
  L.push('', '🛡️ Admins: #desativar pose ou #ativar pose. Dá para mandar várias juntas: #desativar cardio resumo');
  return L.join('\n');
}

/** #ativar / #desativar: só admins. Vale para o desafio atual (o ativo ou o próximo em rascunho). */
export async function toggleActivities(ctx: BotContext, repo: SplinterRepo, ch: Challenge, msg: InboundMessage, on: boolean, names: string[]) {
  const word = on ? 'ativar' : 'desativar';
  if (!(await ctx.isAdmin(msg.senderPhone))) return ctx.reply(M.onlyAdmin(`${word} atividades do desafio`));
  const rules = await repo.rules(ch.id);
  if (!names.length) {
    return ctx.reply(`⚠️ Diga qual atividade quer ${word}. Ex.: #${word} pose\n\n${activitiesText(ch, rules)}`);
  }

  const changed: string[] = [];
  const already: string[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const t = resolveTarget(name, rules);
    if (!t) {
      unknown.push(name);
    } else if ('rule' in t) {
      if (t.rule.active === on) already.push(t.rule.category);
      else {
        await repo.setRuleActive(t.rule.id, on);
        t.rule.active = on;
        changed.push(`${t.rule.category} (${t.rule.hashtag})`);
      }
    } else if (ch[t.extra.flag] === on) {
      already.push(t.extra.label);
    } else {
      await repo.setChallengeFlag(ch.id, t.extra.flag, on);
      ch[t.extra.flag] = on;
      changed.push(t.extra.label);
    }
  }

  const L: string[] = [];
  if (changed.length) {
    L.push(on ? `✅ Ativado: ${changed.join(', ')}.` : `⛔ Desativado: ${changed.join(', ')}.`);
    L.push(on ? 'A partir de agora volta a valer.' : 'A partir de agora não vale ponto. O que já foi pontuado continua valendo.');
  }
  if (already.length) L.push(`ℹ️ Já estava ${on ? 'ativado' : 'desativado'}: ${[...new Set(already)].join(', ')}.`);
  if (unknown.length) {
    L.push(`⚠️ Não conheço: ${unknown.join(', ')}. Use o nome ou a hashtag que aparece no #atividades.`);
  }
  return ctx.reply(L.join('\n'));
}
