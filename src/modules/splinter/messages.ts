import { br } from '../../core/time.js';
import { REASONS } from './rules.js';
import type { Challenge, Rule } from './types.js';

/** Resposta no grupo depois de uma foto de check-in. */
export function photoReply(p: {
  name: string;
  category: string;
  status: string;
  reason: string;
  points: number;
  aiWhy: string;
  ch: Pick<Challenge, 'max_workouts_week' | 'location_window_min'>;
}): string {
  const { name, category, aiWhy } = p;
  switch (p.reason) {
    case REASONS.duplicate:
      return `⚠️ ${name}, essa foto já foi usada antes e não vale ponto.`;
    case REASONS.dailyLimit:
      return `⚠️ ${name}, você já pontuou em ${category} hoje. Só vale uma foto por categoria por dia.`;
    case REASONS.weeklyLimit:
      return `😴 ${name}, você já tem ${p.ch.max_workouts_week} treinos nesta semana. Os outros dias são de descanso, então esse não vale ponto.`;
    case REASONS.foodUnhealthy:
      return `🍟 ${name}, esse prato não conta como alimentação saudável. ${aiWhy} Se discordar, fale com um admin.`;
    case REASONS.foodUnsure:
      return `🔎 ${name}, não consegui confirmar se o prato é saudável. Ele foi para a revisão dos admins.`;
    case REASONS.poseDifferent:
      return `🔎 ${name}, sua foto não parece com a pose de hoje. ${aiWhy} Ela foi para a revisão dos admins.`;
    case REASONS.poseUnsure:
      return `🔎 ${name}, não consegui conferir sua pose. Ela foi para a revisão dos admins.`;
    case REASONS.poseMissing:
      return `🔎 ${name}, a pose de hoje ainda não foi postada pelos admins. Sua foto foi para a revisão deles.`;
  }
  if (p.status === 'aguardando_localizacao') {
    return `📍 ${name}, treino recebido! Agora mande sua localização (clipe > Localização) em até ${p.ch.location_window_min} minutos para validar.`;
  }
  return `✅ ${name}, ${category} registrado! +${p.points} ponto(s).`;
}

export const notEnrolled = (pushName: string) =>
  `🙋 ${pushName || 'Jovem guerreiro'}, você ainda não está inscrito no desafio. Para entrar, fale com um dos admins do grupo: mande seu nome aqui e um admin faz sua inscrição.`;

export const outOfPeriod = (pushName: string, deadline: string) =>
  `⏰ ${pushName}, essa foto chegou fora do período ou depois de ${deadline} e não vale ponto.`;

export const locationOk = (name: string, place: string, dist: number, points: number) =>
  `✅ ${name}, treino validado em ${place} (${dist} m). +${points} ponto(s).`;

export const locationNoPlace = (name: string) =>
  `🔎 ${name}, não achei um local de treino perto dessa localização. Seu treino foi para a revisão dos admins.`;

export function rankingText(challengeName: string, rows: { name: string; points: number }[]): string {
  const lines = positions(rows).map(({ pos, row }) => `${pos}. ${row.name} - ${fmt(row.points)} pts`);
  return `🏆 Ranking - ${challengeName}\n\n${lines.join('\n') || 'Ninguém inscrito ainda.'}`;
}

export function teamRankingText(challengeName: string, rows: { name: string; members: string; points: number }[]): string {
  const lines = positions(rows).map(({ pos, row }) => `${pos}. ${row.name} (${row.members}) - ${fmt(row.points)} pts`);
  return `👥 Ranking de equipes - ${challengeName}\n\n${lines.join('\n') || 'Nenhuma equipe cadastrada ainda.'}`;
}

/** Empates ficam na mesma posição (1, 2, 2, 4). */
function positions<T extends { points: number }>(rows: T[]): { pos: number; row: T }[] {
  let pos = 0;
  return rows.map((row, i) => {
    if (i === 0 || row.points !== rows[i - 1]!.points) pos = i + 1;
    return { pos, row };
  });
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

export function rulesText(ch: Challenge, rules: Rule[]): string {
  const cats = rules.filter((r) => r.active);
  const food = cats.find((r) => r.kind === 'comida');
  const pose = cats.find((r) => r.kind === 'pose');
  const L: string[] = [];
  L.push(`📋 *Regras - ${ch.name}*`);
  L.push(`📅 De ${br(ch.starts_on)} a ${br(ch.ends_on)}. O check-in vale até ${ch.checkin_deadline} do mesmo dia.`);
  L.push('', '📝 *Inscrição*', 'Mande seu nome aqui no grupo. Um admin responde sua mensagem e o bot faz a inscrição.');
  L.push('', '📸 *Como fazer check-in*', 'Mande uma foto com a hashtag da categoria na legenda:');
  for (const r of cats) L.push(`• ${r.hashtag} - ${r.category}: ${fmt(r.points)} ponto(s)`);
  L.push('Só vale 1 foto por categoria por dia, e foto repetida não conta.');
  if (ch.require_location || ch.max_workouts_week > 0) {
    L.push('', '🏋️ *Treino*');
    if (ch.require_location)
      L.push(
        `• Depois da foto, mande sua localização (clipe > Localização) em até ${ch.location_window_min} minutos. Ela precisa ser de uma academia, parque ou outro local de treino.`,
      );
    if (ch.max_workouts_week > 0)
      L.push(`• Valem até ${ch.max_workouts_week} treinos por semana (segunda a domingo). Os outros dias são de descanso.`);
  }
  if (food && ch.ai_photo_check) {
    L.push('', '🥗 *Alimentação*');
    L.push(`• A IA confere a foto do ${food.hashtag}. Fritura, embutidos (linguiça, bacon, salsicha) e ultraprocessados não valem ponto.`);
    L.push('• Na dúvida, pergunte antes: ? seguido do alimento. Ex.: ?tapioca');
  }
  if (pose) {
    L.push('', '🤸 *Pose do dia*');
    L.push(`• Todo dia um admin posta a foto da pose. Imite a pose e mande sua foto com ${pose.hashtag}.`);
    if (ch.ai_photo_check && ch.require_pose)
      L.push('• A IA compara sua foto com a pose do dia. Se ficar diferente, o check-in vai para revisão dos admins.');
  }
  L.push('', '👥 *Equipes*');
  L.push(
    '• Cada dupla soma os pontos dos dois.' +
      (ch.team_bonus_points > 0 ? ` Quando os dois treinam no mesmo dia, a equipe ganha +${fmt(ch.team_bonus_points)} ponto(s).` : ''),
  );
  L.push('', '🔎 *Revisão*');
  L.push('• Check-ins com dúvida ficam "em revisão" e um admin aprova ou recusa. Você recebe o resultado aqui no grupo.');
  L.push('', '💬 *Comandos de todos*');
  L.push('• #ranking - ranking individual', '• #equipes - ranking das equipes', '• ?alimento - diz se um alimento é saudável. Ex.: ?granola', '• #motivação - uma palavra do Mestre Splinter para você', '• #agenda - eventos do grupo', '• #regras - estas regras');
  L.push('', '🛡️ *Comandos dos admins*');
  L.push('• #inscrever - responda à mensagem com o nome da pessoa. Para corrigir o nome: #inscrever Nome Sobrenome');
  L.push('• #equipe Nome da Equipe @pessoa1 @pessoa2 - monta ou troca uma equipe');
  L.push('• #posedodia - mande a foto da pose do dia com essa hashtag (pode escrever o nome da pose junto)');
  L.push('• #pendentes - lista os check-ins em revisão');
  L.push('• #aprovar - responda à foto do check-in para aprovar');
  L.push('• #recusar motivo - responda à foto do check-in para recusar. Ex.: #recusar foto sem a pose');
  L.push('', '🐀 O Mestre Splinter manda um resumo às 4h e passa por aqui ao longo do dia para acompanhar o treino dos alunos.');
  L.push('', 'Dúvidas ou correção de pontos: fale com um admin.');
  return L.join('\n');
}

export const activityOff = (name: string, category: string) =>
  `⛔ ${name || 'Jovem guerreiro'}, a atividade *${category}* está desativada pelos admins neste momento. Esta foto não vale ponto.`;

export const paused = (name: string) =>
  `⏸️ ${name || 'Jovem guerreiro'}, a competição está pausada pelos admins. Essa foto não vale ponto. Assim que voltar, eu aviso aqui.`;
export const PAUSED_NOTE = '\n\n⏸️ Competição pausada: as fotos não estão valendo ponto agora.';

export const onlyAdmin = (what: string) => `🛡️ Só os admins podem ${what}.`;

/** #ajuda: comandos que valem a qualquer momento, com ou sem desafio. */
export function helpText(): string {
  return [
    '🐀 *Comandos do Mestre Splinter*',
    '',
    '💬 *Para todos, a qualquer momento*',
    '• #motivação - uma palavra do mestre para você',
    '• ?alimento - diz se é saudável. Ex.: ?tapioca',
    '• ?pesquisa + o que procurar - pesquisa na internet. Ex.: ?pesquisa restaurantes de sushi na Liberdade',
    '• #resumo - o que rolou no grupo hoje (#resumo ontem para o dia anterior)',
    '• #agenda - próximos eventos do grupo',
    '• #mascote - mostra quem é o mascote. Para falar com ele, comece a mensagem pelo nome dele',
    '• #comparecer nome do evento - confirma sua presença',
    '• #desistir nome do evento - tira seu nome da lista',
    '• #insta @usuario - coloca seu Instagram na lista do grupo (#removeinsta tira, #listainsta mostra todos)',
    '• #estadocivil + sua situação - entra na lista da #pista, que mostra o estado civil da galera',
    '• #engajamento - ranking de quem mais manda mensagens no grupo',
    '• #quem + pergunta - sorteia alguém do grupo. Ex.: #quem vai mandar um ifood pra mim?',
    '',
    '🏋️ *Durante o desafio*',
    '• #regras, #ranking e #equipes',
    '• #atividades - mostra quais atividades estão valendo ponto',
    '',
    '🛡️ *Admins*',
    '• #agendar - responda à sugestão de evento (ou: #agendar Nome | 15/11 19h | Local)',
    '• #cancelarevento nome do evento',
    '• #mascote Nome do personagem - troca o mascote (#mascote padrão volta ao Mestre Splinter)',
    '• #boasvindas - mostra ou troca a mensagem para quem entra no grupo',
    '• #promover @pessoa / #demover @pessoa - dá ou tira a função de admin do bot (#admins lista)',
    '• #suporte + o problema ou a melhoria - manda o pedido para a equipe do bot resolver',
    '• #ban - respondendo à mensagem de alguém, tira a pessoa do grupo',
    '• #fechargrupo / #abrirgrupo - só admins mandam mensagens / libera para todos',
    '• #ativarBAN / #desativarBAN - aviso semanal de quem está sumido há 7 dias (sai do grupo depois do 3º aviso)',
    '• #curiar / #nãocuriar - liga ou desliga o pedido de fotos às 10h, 15h e 21h',
    '• #ativar / #desativar + atividade - liga ou desliga uma atividade do desafio. Ex.: #desativar pose, #ativar cardio, #desativar resumo',
    '• #pausar / #despausar - pausa a competição (fotos não valem ponto) e retoma',
    '• #reiniciar - zera a pontuação da competição (o bot pergunta 3 vezes antes)',
  ].join('\n');
}
