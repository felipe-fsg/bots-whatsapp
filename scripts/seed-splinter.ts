/**
 * Cadastra (ou atualiza) um bot Splinter a partir de um arquivo JSON.
 * Formato em seed/exemplo-splinter.json. Quem roda é scripts/cadastrar.ts.
 */
import { z } from 'zod';
import type { Sql } from '../src/db.js';
import { digits } from '../src/core/phone.js';
import { BaseSeed, upsertBase } from './seed-base.js';

const Seed = BaseSeed.extend({
  desafio: z.object({
    nome: z.string(),
    inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(['rascunho', 'ativo', 'encerrado']).default('rascunho'),
    horario_limite: z.string().default('23:59'),
    exigir_localizacao_no_treino: z.boolean().default(true),
    prazo_localizacao_min: z.number().default(10),
    raio_metros: z.number().default(150),
    tipos_de_local: z.array(z.string()).default(['gym']),
    confirmar_validos_no_grupo: z.boolean().default(false),
    max_treinos_semana: z.number().default(5),
    bonus_dupla: z.number().default(1),
    ia_nas_fotos: z.boolean().default(true),
    exigir_pose_do_dia: z.boolean().default(true),
    resumo_4h: z.boolean().default(true),
    mensagens_ao_longo_do_dia: z.boolean().default(true),
    intervalo_mensagens_horas: z.number().default(1),
  }),
  pontuacao: z.array(
    z.object({
      categoria: z.string(),
      hashtag: z.string().startsWith('#'),
      tipo: z.enum(['treino', 'comida', 'pose', 'outro']).default('outro'),
      pontos: z.number(),
      max_por_dia: z.number().default(1),
      ativa: z.boolean().default(true),
    }),
  ),
  participantes: z
    .array(z.object({ nome: z.string(), telefone: z.string(), nome_no_ranking: z.string().optional(), ativo: z.boolean().default(true), equipe: z.string().optional() }))
    .default([]),
  locais: z.array(z.object({ telefone: z.string().optional(), nome: z.string(), lat: z.number(), lng: z.number() })).default([]),
  alimentos: z.array(z.object({ nome: z.string(), classificacao: z.enum(['saudavel', 'nao_saudavel']) })).default([]),
});

export async function seedSplinter(sql: Sql, input: unknown): Promise<{ botId: string; challengeId: string; connectionId: string }> {
  const s = Seed.parse(input);
  return sql.begin(async (tx) => {
    const { botId, connectionId } = await upsertBase(tx, { ...s, bot: { ...s.bot, modulo: 'splinter' } });
    const bot = { id: botId };
    const conn = { id: connectionId };

    const d = s.desafio;
    const chRow = {
      bot_id: bot!.id,
      name: d.nome,
      starts_on: d.inicio,
      ends_on: d.fim,
      status: d.status,
      checkin_deadline: d.horario_limite,
      require_location: d.exigir_localizacao_no_treino,
      location_window_min: d.prazo_localizacao_min,
      location_radius_m: d.raio_metros,
      place_types: d.tipos_de_local,
      confirm_valid: d.confirmar_validos_no_grupo,
      max_workouts_week: d.max_treinos_semana,
      team_bonus_points: d.bonus_dupla,
      ai_photo_check: d.ia_nas_fotos,
      require_pose: d.exigir_pose_do_dia,
      daily_summary: d.resumo_4h,
      persona_messages: d.mensagens_ao_longo_do_dia,
      persona_interval_h: d.intervalo_mensagens_horas,
    };
    if (d.status === 'ativo') {
      // só um desafio ativo por bot
      await tx`update splinter_challenges set status = 'encerrado' where bot_id = ${bot!.id} and status = 'ativo' and name <> ${d.nome}`;
    }
    const existingCh = (await tx`select id from splinter_challenges where bot_id = ${bot!.id} and name = ${d.nome}`)[0];
    const ch = existingCh
      ? (await tx`update splinter_challenges set ${tx(chRow)} where id = ${existingCh.id} returning id`)[0]!
      : (await tx`insert into splinter_challenges ${tx(chRow)} returning id`)[0]!;

    for (const r of s.pontuacao) {
      await tx`insert into splinter_rules (challenge_id, category, hashtag, kind, points, max_per_day, active)
        values (${ch.id}, ${r.categoria}, ${r.hashtag.toLowerCase()}, ${r.tipo}, ${r.pontos}, ${r.max_por_dia}, ${r.ativa})
        on conflict (challenge_id, hashtag) do update set category = excluded.category, kind = excluded.kind,
          points = excluded.points, max_per_day = excluded.max_per_day, active = excluded.active`;
    }

    for (const p of s.participantes) {
      let teamId: string | null = null;
      if (p.equipe) {
        const [t] = await tx`insert into splinter_teams (challenge_id, name) values (${ch.id}, ${p.equipe})
          on conflict (challenge_id, lower(name)) do update set name = excluded.name returning id`;
        teamId = t!.id;
      }
      await tx`insert into splinter_participants (challenge_id, phone, name, ranking_name, active, team_id)
        values (${ch.id}, ${digits(p.telefone)}, ${p.nome}, ${p.nome_no_ranking ?? p.nome}, ${p.ativo}, ${teamId})
        on conflict (challenge_id, phone) do update set name = excluded.name, ranking_name = excluded.ranking_name,
          active = excluded.active, team_id = coalesce(excluded.team_id, splinter_participants.team_id)`;
    }

    await tx`delete from splinter_places where challenge_id = ${ch.id}`;
    for (const l of s.locais) {
      const owner = l.telefone
        ? (await tx`select id from splinter_participants where challenge_id = ${ch.id} and right(phone, 8) = ${digits(l.telefone).slice(-8)}`)[0]
        : undefined;
      if (l.telefone && !owner) continue; // local de alguém que não está inscrito
      await tx`insert into splinter_places (challenge_id, participant_id, name, lat, lng)
        values (${ch.id}, ${owner?.id ?? null}, ${l.nome}, ${l.lat}, ${l.lng})`;
    }

    for (const f of s.alimentos) {
      await tx`insert into splinter_foods (challenge_id, name, verdict) values (${ch.id}, ${f.nome}, ${f.classificacao})
        on conflict (challenge_id, lower(name)) do update set verdict = excluded.verdict`;
    }
    return { botId: bot!.id, challengeId: ch.id, connectionId: conn.id };
  });
}
