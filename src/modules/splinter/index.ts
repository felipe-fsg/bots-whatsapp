import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { distanceM } from '../../core/geo.js';
import { samePhone } from '../../core/phone.js';
import { local, localDay, localTime } from '../../core/time.js';
import { SplinterRepo } from './repo.js';
import {
  POSE_TAG,
  REASONS,
  applyFoodVerdict,
  applyPoseVerdict,
  decide,
  findRule,
  hashtags,
  inPeriod,
  parseCommand,
  parseVerdict,
  type Command,
  type Decision,
} from './rules.js';
import * as M from './messages.js';
import * as P from './prompts.js';
import { displayName, type Challenge, type Participant, type Rule } from './types.js';
import { splinterJobs } from './jobs.js';

export const splinter: BotModule = {
  id: 'splinter',
  defaultMascot: { name: 'Mestre Splinter', persona: P.SPLINTER_PERSONA },
  jobs: splinterJobs,
  async handle(ctx, msg) {
    const repo = new SplinterRepo(ctx.sql);
    const command = msg.type === 'text' ? parseCommand(msg.text) : null;

    if (command) {
      // estes valem para todo mundo do grupo, com ou sem desafio rolando
      if (command.type === 'motivacao') return motivate(ctx, repo, msg);
      if (command.type === 'alimento') return answerFood(ctx, repo, await repo.currentChallenge(ctx.bot.id), command.food);
      if (command.type === 'ajuda') return ctx.reply(M.helpText());
      const ch = await repo.currentChallenge(ctx.bot.id);
      if (ch) await runCommand(ctx, repo, ch, msg, command);
      return;
    }

    const ch = await repo.activeChallenge(ctx.bot.id);
    if (!ch) return;
    if (msg.type === 'image') {
      if (hashtags(msg.text).includes(POSE_TAG)) return postPose(ctx, repo, ch, msg);
      return checkinPhoto(ctx, repo, ch, msg);
    }
    if (msg.type === 'location') return checkinLocation(ctx, repo, ch, msg);
  },
};

async function checkinPhoto(ctx: BotContext, repo: SplinterRepo, ch: Challenge, msg: InboundMessage) {
  const rule = findRule(msg.text, await repo.rules(ch.id));
  if (!rule) return; // foto sem hashtag de categoria é conversa normal

  const participant = await repo.participantByPhone(ch.id, msg.senderPhone);
  const day = localDay(msg.timestamp, ch.timezone);
  if (!participant?.active) return ctx.reply(M.notEnrolled(msg.pushName));
  if (!inPeriod(day, localTime(msg.timestamp, ch.timezone), ch)) return ctx.reply(M.outOfPeriod(msg.pushName, ch.checkin_deadline));

  const sha = msg.image?.sha256 ?? '';
  let d: Decision = decide(rule, ch, {
    duplicatePhoto: await repo.photoUsed(ctx.bot.id, sha),
    sameDay: await repo.countSameDay(ch.id, participant.id, rule.category, day),
    sameWeek: rule.kind === 'treino' ? await repo.countWorkoutsWeek(ch.id, participant.id, day) : 0,
  });

  let analysis: string | null = null;
  if (d.status === 'valido' && ch.ai_photo_check && rule.kind === 'comida') {
    ({ d, analysis } = await judgeFood(ctx, repo, ch, msg, d));
  } else if (d.status === 'valido' && ch.ai_photo_check && ch.require_pose && rule.kind === 'pose') {
    ({ d, analysis } = await judgePose(ctx, repo, ch, msg, d, day));
  }

  const saved = await repo.insertCheckin({
    challengeId: ch.id,
    participantId: participant.id,
    rule,
    msgId: msg.id,
    sentAt: msg.timestamp,
    day,
    ...d,
    sha256: sha,
    aiAnalysis: analysis,
  });
  if (!saved) return;

  if (d.status !== 'valido' || ch.confirm_valid) {
    await ctx.reply(
      M.photoReply({
        name: displayName(participant),
        category: rule.category,
        ...d,
        aiWhy: analysis?.replace(/^[A-Z_]+ - /, '') ?? '',
        ch,
      }),
    );
  }
}

async function judgeFood(ctx: BotContext, repo: SplinterRepo, ch: Challenge, msg: InboundMessage, d: Decision) {
  if (!msg.image?.data) return { d: applyFoodVerdict(d, 'DUVIDA'), analysis: 'DUVIDA - Foto não recebida' };
  try {
    const answer = await ctx.ai.vision(P.foodPhotoPrompt(await repo.foods(ch.id)), [{ data: msg.image.data, mime: msg.image.mime }]);
    const { verdict, why } = parseVerdict(answer, ['SAUDAVEL', 'NAO_SAUDAVEL', 'DUVIDA'] as const, 'DUVIDA');
    return { d: applyFoodVerdict(d, verdict), analysis: `${verdict} - ${why}` };
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou ao analisar prato');
    return { d: applyFoodVerdict(d, 'DUVIDA'), analysis: 'DUVIDA - IA indisponível' };
  }
}

async function judgePose(ctx: BotContext, repo: SplinterRepo, ch: Challenge, msg: InboundMessage, d: Decision, day: string) {
  const pose = await repo.poseOfDay(ch.id, day);
  if (!pose?.image) return { d: { ...d, status: 'em_revisao' as const, reason: REASONS.poseMissing }, analysis: null };
  if (!msg.image?.data) return { d: applyPoseVerdict(d, 'DUVIDA'), analysis: 'DUVIDA - Foto não recebida' };
  try {
    const answer = await ctx.ai.vision(P.posePrompt(pose.title), [
      { data: pose.image, mime: pose.image_mime ?? 'image/jpeg' },
      { data: msg.image.data, mime: msg.image.mime },
    ]);
    const { verdict, why } = parseVerdict(answer, ['MESMA_POSE', 'POSE_DIFERENTE', 'DUVIDA'] as const, 'DUVIDA');
    return { d: applyPoseVerdict(d, verdict), analysis: `${verdict} - ${why}` };
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou ao comparar pose');
    return { d: applyPoseVerdict(d, 'DUVIDA'), analysis: 'DUVIDA - IA indisponível' };
  }
}

async function checkinLocation(ctx: BotContext, repo: SplinterRepo, ch: Challenge, msg: InboundMessage) {
  if (!msg.location) return;
  const participant = await repo.participantByPhone(ch.id, msg.senderPhone);
  if (!participant) return;
  const since = new Date(msg.timestamp.getTime() - ch.location_window_min * 60_000);
  const pending = await repo.pendingLocation(ch.id, participant.id, since);
  if (!pending) return; // localização sem treino esperando: conversa normal

  const { lat, lng } = msg.location;
  const own = (await repo.places(ch.id, participant.id))
    .map((p) => ({ name: p.name, distance: distanceM(lat, lng, p.lat, p.lng) }))
    .sort((a, b) => a.distance - b.distance)[0];

  let place = own && own.distance <= ch.location_radius_m ? own : null;
  if (!place) {
    try {
      const found = (await ctx.places.nearby(lat, lng, ch.location_radius_m, ch.place_types))
        .map((p) => ({ name: p.name, distance: distanceM(lat, lng, p.lat, p.lng) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (found && found.distance <= ch.location_radius_m) place = found;
    } catch (err) {
      ctx.log.warn({ err: String(err) }, 'Google Places falhou');
    }
  }

  await repo.setLocationResult(pending.id, place);
  const name = displayName(participant);
  await ctx.reply(place ? M.locationOk(name, place.name, place.distance, pending.points) : M.locationNoPlace(name));
}

async function postPose(ctx: BotContext, repo: SplinterRepo, ch: Challenge, msg: InboundMessage) {
  if (!(await ctx.isAdmin(msg.senderPhone))) return ctx.reply(M.onlyAdmin('cadastrar a pose do dia'));
  const title = msg.text.replace(/#posedodia/gi, '').trim();
  await repo.addPose({
    challengeId: ch.id,
    day: localDay(msg.timestamp, ch.timezone),
    title: title || 'Pose do dia',
    image: msg.image?.data,
    mime: msg.image?.mime,
    postedBy: msg.pushName,
    msgId: msg.id,
  });
  const poseTag = (await repo.rules(ch.id)).find((r) => r.kind === 'pose' && r.active)?.hashtag ?? '#pose';
  await ctx.reply(
    `🐀 A pose do dia está lançada, meus alunos!${title ? ` (${title})` : ''}\nImitem a foto acima e mandem com ${poseTag} até ${ch.checkin_deadline}.`,
  );
}

async function runCommand(ctx: BotContext, repo: SplinterRepo, ch: Challenge, msg: InboundMessage, cmd: Command) {
  switch (cmd.type) {
    case 'ranking':
      return ctx.reply(M.rankingText(ch.name, await repo.ranking(ch.id)));
    case 'equipes':
      return ctx.reply(M.teamRankingText(ch.name, await repo.teamRanking(ch.id, ch.team_bonus_points)));
    case 'regras':
      return ctx.reply(M.rulesText(ch, await repo.rules(ch.id)));
    case 'meulocal':
      return saveOwnPlace(ctx, repo, ch, msg, cmd.name);
  }

  // daqui para baixo, só admins
  const what: Record<string, string> = {
    inscrever: 'inscrever participantes',
    pendentes: 'revisar check-ins',
    aprovar: 'revisar check-ins',
    recusar: 'revisar check-ins',
    equipe: 'montar equipes',
  };
  if (!what[cmd.type]) return;
  if (!(await ctx.isAdmin(msg.senderPhone))) return ctx.reply(M.onlyAdmin(what[cmd.type]!));

  switch (cmd.type) {
    case 'inscrever':
      return enroll(ctx, repo, ch, msg, cmd.name);
    case 'pendentes':
      return listReview(ctx, repo, ch);
    case 'aprovar':
    case 'recusar':
      return review(ctx, repo, ch, msg, cmd.type === 'aprovar', cmd.note);
    case 'equipe':
      return makeTeam(ctx, repo, ch, msg, cmd.name);
  }
}

async function answerFood(ctx: BotContext, repo: SplinterRepo, ch: Challenge | null, food: string) {
  let text: string;
  try {
    const foods = ch ? await repo.foods(ch.id) : [];
    text = await ctx.ai.text(P.foodQuestionPrompt(food, foods), { search: true, temperature: 0.3 });
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou na pergunta de alimento');
    text = '';
  }
  await ctx.reply(`🥗 *${food}*\n${P.whatsappFormat(text || 'Não consegui responder agora. Tente de novo em alguns minutos.')}`);
}

async function motivate(ctx: BotContext, repo: SplinterRepo, msg: InboundMessage) {
  const ch = await repo.activeChallenge(ctx.bot.id);
  const p = ch ? await repo.participantByPhone(ch.id, msg.senderPhone) : null;
  const name = p ? displayName(p) : (await ctx.nameOf(msg.senderPhone)) || msg.pushName || 'jovem guerreiro';
  let facts = 'Não há desafio rolando agora no grupo.';
  if (ch && p) {
    const ranking = await repo.ranking(ch.id);
    const pos = ranking.findIndex((r) => r.name === name);
    const todayCats = (await repo.validCheckins(ch.id, localDay(ctx.now(), ch.timezone), localDay(ctx.now(), ch.timezone)))
      .filter((c) => c.name === name)
      .map((c) => c.category);
    facts = `Desafio ${ch.name} em andamento. ${name} tem ${ranking[pos]?.points ?? 0} pontos (${pos + 1}º de ${ranking.length}). Check-ins válidos hoje: ${todayCats.join(', ') || 'nenhum ainda'}.`;
  } else if (ch) {
    facts = `Desafio ${ch.name} em andamento, mas ${name} não está inscrito.`;
  }
  const hour = local(ctx.now(), ctx.timezone).hour;
  let text = '';
  try {
    text = P.whatsappFormat(await ctx.ai.text(P.motivationPrompt(name, hour, facts), { system: (await ctx.mascot()).persona, temperature: 1 }));
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou na motivação');
  }
  await ctx.reply(text || `🐀 ${name}, o bambu que se curva ao vento não quebra. Um treino de cada vez, meu aluno. 🥋`);
}

async function saveOwnPlace(ctx: BotContext, repo: SplinterRepo, ch: Challenge, msg: InboundMessage, name: string) {
  const participant = await repo.participantByPhone(ch.id, msg.senderPhone);
  if (!participant) return ctx.reply(M.notEnrolled(msg.pushName));
  const loc = msg.quoted?.location;
  if (!loc || !name) {
    return ctx.reply('📍 Para cadastrar seu local de treino, mande sua localização e depois responda a ela com #meulocal Nome do local. Ex.: #meulocal Academia do prédio');
  }
  await repo.addPlace(ch.id, participant.id, name, loc.lat, loc.lng);
  await ctx.reply(`📍 ${displayName(participant)}, guardei *${name}* como seu local de treino. Os próximos treinos ali valem direto.`);
}

async function enroll(ctx: BotContext, repo: SplinterRepo, ch: Challenge, msg: InboundMessage, typedName: string) {
  const name = (typedName || msg.quoted?.text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const phone = msg.quoted ? await ctx.contacts.phoneOf(msg.quoted.participant, msg.chatJid) : '';
  if (name.length < 2 || phone.length < 10) {
    return ctx.reply('⚠️ Para inscrever, responda à mensagem da pessoa com #inscrever (o nome vem da mensagem dela) ou #inscrever Nome Sobrenome.');
  }
  await repo.upsertParticipant(ch.id, phone, name);
  await ctx.reply(`🐀 Seja bem-vindo ao dojô, *${name}*! Sua inscrição no ${ch.name} está feita. Mande #regras para saber como pontuar.`);
}

async function listReview(ctx: BotContext, repo: SplinterRepo, ch: Challenge) {
  const rows = await repo.inReview(ch.id);
  if (!rows.length) return ctx.reply('✅ Nenhum check-in em revisão. O dojô está em ordem.');
  const L = [`📝 *Check-ins em revisão* (${rows.length})`];
  rows.slice(0, 20).forEach((r, i) => {
    const when = r.sent_at.toLocaleString('pt-BR', { timeZone: ch.timezone, dateStyle: 'short', timeStyle: 'short' });
    L.push(`${i + 1}. ${r.name} - ${r.category} - ${when}${r.reason ? ` - ${r.reason}` : ''}`);
  });
  if (rows.length > 20) L.push(`... e mais ${rows.length - 20}.`);
  L.push('', 'Para decidir, responda à foto do check-in com #aprovar ou #recusar seguido do motivo.');
  return ctx.reply(L.join('\n'));
}

async function review(ctx: BotContext, repo: SplinterRepo, ch: Challenge, msg: InboundMessage, approve: boolean, note: string) {
  const row = msg.quoted ? await repo.checkinByMessage(ch.id, msg.quoted.messageId) : null;
  if (!row) return ctx.reply('⚠️ Não achei esse check-in. Responda direto à foto do participante com #aprovar ou #recusar.');
  const points = approve ? Number(row.rule_points ?? row.points) || 0 : 0;
  const reason = `${approve ? 'Aprovado' : 'Recusado'} por ${msg.pushName}${note ? `: ${note}` : ''}`;
  await repo.review(row.id, approve, points, reason, msg.senderPhone);
  const day = row.day.split('-').reverse().join('/');
  await ctx.reply(
    approve
      ? `✅ Check-in de *${row.name}* (${row.category}, ${day}) aprovado. +${points} ponto(s). O mestre reconhece seu esforço! 🐀`
      : `❌ Check-in de *${row.name}* (${row.category}, ${day}) recusado.${note ? ` Motivo: ${note}` : ''}`,
  );
}

async function makeTeam(ctx: BotContext, repo: SplinterRepo, ch: Challenge, msg: InboundMessage, name: string) {
  if (!name) return ctx.reply('⚠️ Faltou o nome da equipe. Ex.: #equipe Tartarugas @pessoa1 @pessoa2');
  if (!msg.mentions.length) return ctx.reply('⚠️ Faltou marcar os integrantes com @.');

  const members: Participant[] = [];
  const missing: string[] = [];
  for (const jid of msg.mentions) {
    const phone = await ctx.contacts.phoneOf(jid, msg.chatJid);
    const p = phone ? await repo.participantByPhone(ch.id, phone) : null;
    if (p && !members.some((m) => samePhone(m.phone, p.phone))) members.push(p);
    else if (!p) missing.push(phone ? `+${phone}` : 'uma pessoa marcada');
  }
  if (missing.length) return ctx.reply(`⚠️ Não encontrei: ${missing.join(', ')}. Inscreva antes com #inscrever.`);

  const { team, before } = await repo.setTeam(ch.id, name, members.map((m) => m.id));
  const moves = before
    .filter((b) => b.old && b.old.toLowerCase() !== team.name.toLowerCase())
    .map((b) => `${displayName(members.find((m) => m.id === b.id)!)} saiu de ${b.old}`);
  await ctx.reply(
    `🐢 Nasce uma nova equipe no dojô: *${team.name}*\nIntegrantes: ${members.map(displayName).join(' e ')}` +
      (moves.length ? `\n(${moves.join('; ')})` : '') +
      '\nTreinem juntos no mesmo dia para ganhar o bônus de dupla!',
  );
}

export type { Rule };
