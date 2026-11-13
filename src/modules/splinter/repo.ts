import type { Sql } from '../../db.js';
import { digits, last8 } from '../../core/phone.js';
import type { Challenge, Checkin, CheckinStatus, Participant, Rule } from './types.js';

/** Acesso ao banco do módulo Splinter. */
export class SplinterRepo {
  constructor(private readonly sql: Sql) {}

  /** Desafio ativo do bot. */
  async activeChallenge(botId: string): Promise<Challenge | null> {
    const rows = await this.sql<Challenge[]>`
      select * from splinter_challenges where bot_id = ${botId} and status = 'ativo' limit 1`;
    return rows[0] ?? null;
  }

  /**
   * Desafio para os comandos: o ativo; senão o próximo em rascunho (para inscrever antes
   * de começar); senão o último encerrado (para ver o ranking final).
   */
  async currentChallenge(botId: string): Promise<Challenge | null> {
    const rows = await this.sql<Challenge[]>`
      select * from splinter_challenges where bot_id = ${botId}
      order by case status when 'ativo' then 0 when 'rascunho' then 1 else 2 end, starts_on desc limit 1`;
    return rows[0] ?? null;
  }

  rules(challengeId: string): Promise<Rule[]> {
    return this.sql<Rule[]>`
      select id, category, hashtag, kind, points, max_per_day, active from splinter_rules
      where challenge_id = ${challengeId} order by id`;
  }

  async setRuleActive(ruleId: number, active: boolean): Promise<void> {
    await this.sql`update splinter_rules set active = ${active} where id = ${ruleId}`;
  }

  /** Liga ou desliga uma das funções do desafio que ficam na própria tabela do desafio. */
  async setChallengeFlag(challengeId: string, flag: 'daily_summary' | 'persona_messages' | 'require_location', on: boolean): Promise<void> {
    await this.sql`update splinter_challenges set ${this.sql({ [flag]: on })} where id = ${challengeId}`;
  }

  async setPaused(challengeId: string, paused: boolean, by: string): Promise<void> {
    await this.sql`update splinter_challenges set paused = ${paused}, paused_at = ${paused ? new Date() : null},
      paused_by = ${paused ? by : null} where id = ${challengeId}`;
  }

  /** Passo da confirmação do #reiniciar (0 = nenhum pedido em andamento). */
  async setResetStep(challengeId: string, step: number, by: string | null, at: Date | null): Promise<void> {
    await this.sql`update splinter_challenges set reset_step = ${step}, reset_by = ${by}, reset_asked_at = ${at}
      where id = ${challengeId}`;
  }

  /**
   * Zera a pontuação: guarda o ranking de antes e uma cópia de todos os check-ins no arquivo,
   * depois tira os check-ins do desafio. Participantes, equipes, locais e poses continuam.
   */
  async resetScores(challengeId: string, by: string): Promise<{ checkins: number }> {
    const ranking = await this.ranking(challengeId);
    return this.sql.begin(async (tx) => {
      const [reset] = await tx<{ id: number }[]>`
        insert into splinter_resets (challenge_id, done_by, checkins, ranking)
        values (${challengeId}, ${by}, 0, ${tx.json(ranking as never)}) returning id`;
      const moved = await tx`
        insert into splinter_checkins_arquivo (reset_id, checkin, photo_sha256)
        select ${reset!.id}, to_jsonb(c), c.photo_sha256 from splinter_checkins c where c.challenge_id = ${challengeId}
        returning id`;
      await tx`delete from splinter_checkins where challenge_id = ${challengeId}`;
      await tx`update splinter_resets set checkins = ${moved.length} where id = ${reset!.id}`;
      await tx`update splinter_challenges set reset_step = 0, reset_by = null, reset_asked_at = null where id = ${challengeId}`;
      return { checkins: moved.length };
    });
  }

  async participantByPhone(challengeId: string, phone: string): Promise<Participant | null> {
    if (digits(phone).length < 8) return null;
    const rows = await this.sql<Participant[]>`
      select id, phone, name, ranking_name, active, team_id from splinter_participants
      where challenge_id = ${challengeId} and right(phone, 8) = ${last8(phone)}
      order by active desc limit 1`;
    return rows[0] ?? null;
  }

  async countSameDay(challengeId: string, participantId: string, category: string, day: string): Promise<number> {
    const [r] = await this.sql<{ n: number }[]>`
      select count(*)::int as n from splinter_checkins
      where challenge_id = ${challengeId} and participant_id = ${participantId}
        and category = ${category} and day = ${day} and status <> 'recusado'`;
    return r?.n ?? 0;
  }

  /** Treinos não recusados na semana (o Postgres começa a semana na segunda). */
  async countWorkoutsWeek(challengeId: string, participantId: string, day: string): Promise<number> {
    const [r] = await this.sql<{ n: number }[]>`
      select count(*)::int as n from splinter_checkins
      where challenge_id = ${challengeId} and participant_id = ${participantId} and kind = 'treino'
        and status <> 'recusado' and date_trunc('week', day) = date_trunc('week', ${day}::date)`;
    return r?.n ?? 0;
  }

  /** A mesma foto (hash do WhatsApp) já foi usada em qualquer desafio deste bot, mesmo antes de um #reiniciar? */
  async photoUsed(botId: string, sha256: string): Promise<boolean> {
    if (!sha256) return false;
    const rows = await this.sql`
      select 1 from splinter_checkins c join splinter_challenges ch on ch.id = c.challenge_id
      where ch.bot_id = ${botId} and c.photo_sha256 = ${sha256}
      union all
      select 1 from splinter_checkins_arquivo a join splinter_resets r on r.id = a.reset_id
      join splinter_challenges ch on ch.id = r.challenge_id
      where ch.bot_id = ${botId} and a.photo_sha256 = ${sha256} limit 1`;
    return rows.length > 0;
  }

  async insertCheckin(c: {
    challengeId: string;
    participantId: string;
    rule: Rule;
    msgId: string;
    sentAt: Date;
    day: string;
    status: CheckinStatus;
    reason: string;
    points: number;
    sha256: string;
    aiAnalysis: string | null;
  }): Promise<Checkin | null> {
    const rows = await this.sql<Checkin[]>`
      insert into splinter_checkins
        (challenge_id, participant_id, rule_id, category, kind, provider_msg_id, sent_at, day, status, reason, points, photo_sha256, ai_analysis)
      values
        (${c.challengeId}, ${c.participantId}, ${c.rule.id}, ${c.rule.category}, ${c.rule.kind}, ${c.msgId}, ${c.sentAt},
         ${c.day}, ${c.status}, ${c.reason}, ${c.points}, ${c.sha256 || null}, ${c.aiAnalysis})
      on conflict (provider_msg_id) do nothing
      returning *`;
    return rows[0] ?? null;
  }

  /** Último treino do participante esperando localização, mandado depois de `since`. */
  async pendingLocation(challengeId: string, participantId: string, since: Date): Promise<Checkin | null> {
    const rows = await this.sql<Checkin[]>`
      select * from splinter_checkins
      where challenge_id = ${challengeId} and participant_id = ${participantId}
        and status = 'aguardando_localizacao' and sent_at >= ${since}
      order by sent_at desc limit 1`;
    return rows[0] ?? null;
  }

  async setLocationResult(id: string, place: { name: string; distance: number } | null): Promise<void> {
    if (place) {
      await this.sql`update splinter_checkins set status = 'valido', reason = '', place_name = ${place.name},
        distance_m = ${place.distance} where id = ${id}`;
    } else {
      await this.sql`update splinter_checkins set status = 'em_revisao',
        reason = 'Nenhum local de treino perto da localização enviada' where id = ${id}`;
    }
  }

  /** Treinos sem localização depois do prazo vão para revisão. */
  async expireLocations(challengeId: string, before: Date): Promise<number> {
    const rows = await this.sql`
      update splinter_checkins set status = 'em_revisao', reason = 'Localização não enviada no prazo'
      where challenge_id = ${challengeId} and status = 'aguardando_localizacao' and sent_at < ${before}
      returning id`;
    return rows.length;
  }

  places(challengeId: string, participantId: string) {
    return this.sql<{ name: string; lat: number; lng: number }[]>`
      select name, lat, lng from splinter_places
      where challenge_id = ${challengeId} and (participant_id is null or participant_id = ${participantId})`;
  }

  async addPlace(challengeId: string, participantId: string | null, name: string, lat: number, lng: number): Promise<void> {
    await this.sql`insert into splinter_places (challenge_id, participant_id, name, lat, lng)
      values (${challengeId}, ${participantId}, ${name}, ${lat}, ${lng})`;
  }

  foods(challengeId: string) {
    return this.sql<{ name: string; verdict: 'saudavel' | 'nao_saudavel' }[]>`
      select name, verdict from splinter_foods where challenge_id = ${challengeId} order by name`;
  }

  async poseOfDay(challengeId: string, day: string) {
    const rows = await this.sql<{ title: string; image: Buffer | null; image_mime: string | null }[]>`
      select title, image, image_mime from splinter_poses where challenge_id = ${challengeId} and day = ${day}
      order by created_at desc limit 1`;
    return rows[0] ?? null;
  }

  async addPose(p: { challengeId: string; day: string; title: string; image?: Buffer; mime?: string; postedBy: string; msgId: string }) {
    await this.sql`insert into splinter_poses (challenge_id, day, title, image, image_mime, posted_by, provider_msg_id)
      values (${p.challengeId}, ${p.day}, ${p.title}, ${p.image ?? null}, ${p.mime ?? null}, ${p.postedBy}, ${p.msgId})`;
  }

  /** Inscreve ou corrige o nome (procura pelos 8 últimos dígitos do telefone). */
  async upsertParticipant(challengeId: string, phone: string, name: string): Promise<Participant> {
    const existing = await this.participantByPhone(challengeId, phone);
    if (existing) {
      const [p] = await this.sql<Participant[]>`
        update splinter_participants set name = ${name}, ranking_name = ${name}, active = true
        where id = ${existing.id} returning id, phone, name, ranking_name, active, team_id`;
      return p!;
    }
    const [p] = await this.sql<Participant[]>`
      insert into splinter_participants (challenge_id, phone, name, ranking_name)
      values (${challengeId}, ${digits(phone)}, ${name}, ${name})
      returning id, phone, name, ranking_name, active, team_id`;
    return p!;
  }

  async countActiveParticipants(challengeId: string): Promise<number> {
    const [r] = await this.sql<{ n: number }[]>`
      select count(*)::int as n from splinter_participants where challenge_id = ${challengeId} and active`;
    return r?.n ?? 0;
  }

  /** Cria a equipe (ou acha pelo nome) e coloca os integrantes nela. Devolve de onde cada um saiu. */
  async setTeam(challengeId: string, name: string, participantIds: string[]) {
    return this.sql.begin(async (tx) => {
      const [team] = await tx<{ id: string; name: string }[]>`
        insert into splinter_teams (challenge_id, name) values (${challengeId}, ${name})
        on conflict (challenge_id, lower(name)) do update set name = excluded.name
        returning id, name`;
      const before = await tx<{ id: string; old: string | null }[]>`
        select p.id, t.name as old from splinter_participants p left join splinter_teams t on t.id = p.team_id
        where p.id = any(${participantIds}::uuid[])`;
      await tx`update splinter_participants set team_id = ${team!.id} where id = any(${participantIds}::uuid[])`;
      // equipes que ficaram vazias somem do ranking
      await tx`delete from splinter_teams t where t.challenge_id = ${challengeId}
        and not exists (select 1 from splinter_participants p where p.team_id = t.id)`;
      return { team: team!, before };
    });
  }

  ranking(challengeId: string) {
    return this.sql<{ name: string; points: number }[]>`
      select coalesce(nullif(p.ranking_name, ''), p.name) as name,
             coalesce(sum(c.points) filter (where c.status = 'valido'), 0)::float8 as points
      from splinter_participants p
      left join splinter_checkins c on c.participant_id = p.id
      where p.challenge_id = ${challengeId} and p.active
      group by p.id order by points desc, name`;
  }

  /** Soma dos integrantes + bônus nos dias em que todos da equipe treinaram (treino válido). */
  teamRanking(challengeId: string, bonus: number) {
    return this.sql<{ name: string; members: string; points: number; bonus_days: number }[]>`
      with members as (
        select t.id as team_id, t.name, p.id as participant_id, coalesce(nullif(p.ranking_name, ''), p.name) as pname
        from splinter_teams t join splinter_participants p on p.team_id = t.id and p.active
        where t.challenge_id = ${challengeId}
      ),
      size as (select team_id, count(*) as n from members group by team_id),
      pts as (
        select m.team_id, coalesce(sum(c.points), 0) as points
        from members m left join splinter_checkins c on c.participant_id = m.participant_id and c.status = 'valido'
        group by m.team_id
      ),
      days as (
        select m.team_id, c.day from members m
        join splinter_checkins c on c.participant_id = m.participant_id and c.status = 'valido' and c.kind = 'treino'
        group by m.team_id, c.day
        having count(distinct m.participant_id) = (select n from size s where s.team_id = m.team_id)
      ),
      bonus as (
        select d.team_id, count(*)::int as bonus_days from days d join size s using (team_id) where s.n >= 2 group by d.team_id
      )
      select max(m.name) as name, string_agg(m.pname, ' e ' order by m.pname) as members,
             (max(pts.points) + coalesce(max(b.bonus_days), 0) * ${bonus})::float8 as points,
             coalesce(max(b.bonus_days), 0)::int as bonus_days
      from members m join pts using (team_id) left join bonus b using (team_id)
      group by m.team_id order by points desc, name`;
  }

  inReview(challengeId: string) {
    return this.sql<{ name: string; category: string; sent_at: Date; reason: string }[]>`
      select coalesce(nullif(p.ranking_name, ''), p.name) as name, c.category, c.sent_at, c.reason
      from splinter_checkins c join splinter_participants p on p.id = c.participant_id
      where c.challenge_id = ${challengeId} and c.status = 'em_revisao' order by c.sent_at`;
  }

  async checkinByMessage(challengeId: string, msgId: string) {
    const rows = await this.sql<(Checkin & { name: string; rule_points: number | null })[]>`
      select c.*, coalesce(nullif(p.ranking_name, ''), p.name) as name, r.points as rule_points
      from splinter_checkins c join splinter_participants p on p.id = c.participant_id
      left join splinter_rules r on r.id = c.rule_id
      where c.challenge_id = ${challengeId} and c.provider_msg_id = ${msgId}`;
    return rows[0] ?? null;
  }

  async review(id: string, approve: boolean, points: number, reason: string, reviewer: string): Promise<void> {
    await this.sql`update splinter_checkins set status = ${approve ? 'valido' : 'recusado'}, points = ${approve ? points : 0},
      reason = ${reason}, reviewed_by = ${reviewer} where id = ${id}`;
  }

  /** Check-ins válidos com nome, para o Mestre Splinter comentar. */
  validCheckins(challengeId: string, fromDay: string, toDay: string) {
    return this.sql<{ name: string; category: string; points: number; day: string; sent_at: Date }[]>`
      select coalesce(nullif(p.ranking_name, ''), p.name) as name, c.category, c.points::float8 as points, c.day, c.sent_at
      from splinter_checkins c join splinter_participants p on p.id = c.participant_id
      where c.challenge_id = ${challengeId} and c.status = 'valido' and c.day between ${fromDay} and ${toDay}
      order by c.sent_at`;
  }
}
