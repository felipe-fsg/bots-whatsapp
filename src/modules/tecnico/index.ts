import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { local } from '../../core/time.js';
import { samePhone } from '../../core/phone.js';
import { Claude, GeminiEmbeddings, QdrantBase, type Ficha, type TecnicoDeps } from './clients.js';
import { SYSTEM, cardNumber, shortName, splitSources, stillValid, userMessage, type CardState } from './prompt.js';

export type ReviewCommand = 'correto' | 'corrigir' | 'excluir' | 'acrescentar' | 'restaurar';

export type TecnicoCommand =
  | { type: 'duvida'; question: string }
  | { type: 'review'; cmd: ReviewCommand; text: string }
  | { type: 'ajuda' };

const REVIEW: Record<string, ReviewCommand> = {
  correto: 'correto',
  corrigir: 'corrigir',
  excluir: 'excluir',
  acrescentar: 'acrescentar',
  acresentar: 'acrescentar',
  acrecentar: 'acrescentar',
  restaurar: 'restaurar',
};

const noAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** /duvida (ou /dúvida, \duvida, #duvida), comandos de revisão e #ajuda. */
export function parseTecnico(raw: string): TecnicoCommand | null {
  const txt = raw.normalize('NFC').trim();
  const plain = noAccents(txt);
  const ask = plain.match(/^[/\\#]duvida(?![a-z0-9])[\s:,.-]*/i);
  if (ask) return { type: 'duvida', question: txt.slice(ask[0].length).trim() };
  const m = plain.match(/^[/\\#]([a-z]+)(?![a-z0-9])[\s:,.-]*/i);
  if (!m) return null;
  const word = m[1]!.toLowerCase();
  if (word === 'ajuda' || word === 'comandos') return { type: 'ajuda' };
  const cmd = REVIEW[word];
  return cmd ? { type: 'review', cmd, text: txt.slice(m[0].length).trim() } : null;
}

export function helpText(): string {
  return [
    '🔧 *Bot de dúvidas técnicas*',
    '',
    '• /duvida + sua pergunta: equipamento, modelo, código de erro e o que já foi feito. Ex.: /duvida 4008S dando F04 na desinfecção',
    '• Também vale mandar uma *foto* (tela, placa) com /duvida na legenda',
    '• #resumo - o que rolou no grupo hoje (#resumo ontem para o dia anterior)',
    '• #agenda - próximos eventos do grupo',
    '• ?pesquisa + o que procurar - pesquisa na internet. Ex.: ?pesquisa manual da 5008S',
    '',
    '🛡️ *Sêniores* (respondendo à mensagem do bot)',
    '• /correto - confirma a resposta',
    '• /corrigir texto - registra a orientação certa',
    '• /acrescentar texto - completa a resposta',
    '• /excluir - tira a resposta de uso (vai para a lixeira)',
    '• /restaurar - traz de volta uma resposta excluída',
  ].join('\n');
}

const REVIEWED_STATUS = ['revisada_correta', 'corrigida', 'acrescentada'];

async function answer(ctx: BotContext, deps: TecnicoDeps, msg: InboundMessage, question: string): Promise<void> {
  const name = msg.pushName || (await ctx.nameOf(msg.senderPhone)) || 'Técnico';
  let fichas: Ficha[];
  try {
    fichas = await deps.kb.search(question || 'duvida tecnica sem descricao', 10);
  } catch (err) {
    ctx.log.error({ err: String(err) }, 'falha ao buscar fichas');
    await ctx.reply('⚠️ Não consegui consultar a base técnica agora. Tente de novo em alguns minutos ou acione um sênior.');
    return;
  }

  // Fichas C só valem se forem a versão atual do card (revisão ou exclusão vigente).
  const ids = [...new Set(fichas.map((f) => (f.metadata.tipo === 'card_revisado' ? cardNumber(f.metadata.id) : null)).filter((n): n is number => n !== null))];
  const states = ids.length
    ? await ctx.sql<CardState[]>`select id, status, reviewed_at, deleted_at from tecnico_cards where id in ${ctx.sql(ids)}`
    : [];
  const cards = new Map(states.map((c) => [c.id, c]));
  const valid = fichas.filter((f) => stillValid(f, cards));
  const reviewed = valid
    .map((f) => f.metadata as Record<string, any>)
    .filter((m) => m.tipo === 'card_revisado' && m.situacao !== 'descartada')
    .map((m) => ({ id: String(m.id).toUpperCase(), by: String(m.revisado_por ?? ''), on: String(m.data_revisao ?? '') }));

  const img = msg.type === 'image' ? msg.image : undefined;
  const photo = img?.data ? 'sim' : msg.type === 'image' ? 'perdida' : 'nao';
  const images = img?.data && /^image\/(jpeg|png|gif|webp)$/.test(img.mime) ? [{ data: img.data, mime: img.mime }] : [];
  let text: string;
  try {
    text = await deps.llm.answer(SYSTEM, userMessage(name, question, valid, photo), images);
  } catch (err) {
    ctx.log.error({ err: String(err) }, 'Claude falhou');
    await ctx.reply('⚠️ Não consegui montar a resposta agora. Tente de novo em alguns minutos ou acione um sênior.');
    return;
  }
  const { body, sources } = splitSources(text);
  const used = reviewed.filter((r) => sources.includes(r.id));
  const status = used.length
    ? `✅ _Baseada em resposta revisada por ${used[0]!.by} em ${used[0]!.on}._`
    : '⚠️ _Resposta não revisada._';
  const header = question ? `*Dúvida de ${name}:* ${question}\n\n` : '';
  const footer = '\n\n_Sêniores: respondam a esta mensagem com /correto, /corrigir, /excluir ou /acrescentar._';

  const botMsgId = await ctx.replyWithId(`${status}\n\n${header}${body}${footer}`);
  if (!botMsgId) ctx.log.warn({ messageId: msg.id }, 'AvisaAPI não devolveu o id da resposta; ela não poderá ser revisada');
  await ctx.sql`
    insert into tecnico_cards (bot_id, question_msg_id, bot_msg_id, asked_by_name, asked_by_phone, question, answer, sources)
    values (${ctx.bot.id}, ${msg.id}, ${botMsgId || null}, ${name}, ${msg.senderPhone || null}, ${question}, ${body}, ${sources.join(', ')})`;
}

interface CardRow {
  id: number;
  question: string;
  answer: string;
  sources: string;
  status: string;
  previous_status: string | null;
  correction: string | null;
  addition: string | null;
}

async function review(ctx: BotContext, deps: TecnicoDeps, msg: InboundMessage, cmd: ReviewCommand, text: string): Promise<void> {
  const admins = await ctx.sql<{ phone: string; name: string | null }[]>`select phone, name from bot_admins where bot_id = ${ctx.bot.id}`;
  const senior = admins.find((a) => msg.senderPhone && samePhone(a.phone, msg.senderPhone));
  if (!senior) return ctx.reply('⚠️ Só sêniores cadastrados podem revisar respostas do bot.');
  if (!msg.quoted?.messageId) return ctx.reply('⚠️ Para revisar, use o comando *respondendo* (citando) a mensagem do bot.');
  const [card] = await ctx.sql<CardRow[]>`
    select id, question, answer, sources, status, previous_status, correction, addition
    from tecnico_cards where bot_id = ${ctx.bot.id} and bot_msg_id = ${msg.quoted.messageId}`;
  if (!card) {
    return ctx.reply('⚠️ Não encontrei o card dessa mensagem. Use o comando respondendo a uma resposta do bot (as que têm o rodapé de revisão).');
  }
  if ((cmd === 'corrigir' || cmd === 'acrescentar') && !text) {
    return ctx.reply(`⚠️ Escreva o texto depois do comando. Ex.: /${cmd} a causa era ...`);
  }

  const who = shortName(senior.name || msg.pushName || senior.phone);
  const fullName = senior.name || who;
  const now = ctx.now();
  const today = local(now, ctx.timezone).toFormat('dd/MM/yyyy');
  const docId = 'C' + String(card.id).padStart(5, '0');
  const q = 'PERGUNTA DO TÉCNICO: ' + (card.question || '') + '\n\n';
  const meta = (situacao: string) => ({
    id: docId,
    tipo: 'card_revisado',
    situacao,
    confianca: 'alta',
    status_revisao: 'revisada',
    revisado_por: who,
    data_revisao: today,
    revisao_em: now.toISOString(),
    quem_orientou: who,
    data: today,
    alerta_seguranca: '',
    depende_de_midia: 'false',
  });
  const fail = () => ctx.reply(`⚠️ Não consegui registrar o comando /${cmd} agora (falha no sistema). Nada foi alterado. Tente de novo em alguns minutos.`);

  if (cmd === 'restaurar') {
    if (card.status !== 'lixeira') return ctx.reply('⚠️ Essa resposta não está na lixeira.');
    const back = card.previous_status || 'nao_revisada';
    await ctx.sql`update tecnico_cards set status = ${back} where id = ${card.id}`;
    return ctx.reply(
      `♻️ *Resposta restaurada* por ${who} em ${today}. Ela volta a valer como estava antes da exclusão${back === 'nao_revisada' ? ' (não revisada).' : '.'}`,
    );
  }

  if (cmd === 'excluir') {
    if (card.status === 'lixeira') return ctx.reply('⚠️ Essa resposta já está na lixeira. Para trazer de volta, responda a ela com /restaurar.');
    // Ordem: grava na base primeiro; a ficha só passa a valer quando o card é atualizado.
    try {
      await deps.kb.insert(
        q +
          `ATENÇÃO: o sênior ${who} marcou em ${today} como ERRADA a resposta automática a esta pergunta (baseada nas fichas ${card.sources || 'nenhuma'}). Não repita essa orientação; peça para o técnico acionar um sênior.`,
        meta('descartada'),
      );
    } catch (err) {
      ctx.log.error({ err: String(err) }, 'falha ao gravar exclusão na base');
      return fail();
    }
    await ctx.sql`update tecnico_cards set status = 'lixeira', previous_status = ${card.status}, deleted_by = ${fullName}, deleted_at = ${now}
      where id = ${card.id}`;
    return ctx.reply(
      `🗑️ *Resposta tirada de uso* por ${who} em ${today}. Técnico: não siga a resposta acima; aguarde a orientação de um sênior.\n_Ela foi para a lixeira. Se foi engano, responda à resposta do bot com /restaurar._`,
    );
  }

  let status: string;
  let doc: string;
  let confirm: string;
  let correction = card.correction ?? '';
  let addition = card.addition ?? '';
  if (cmd === 'correto') {
    status = 'revisada_correta';
    doc = q + `RESPOSTA CONFIRMADA PELO SÊNIOR ${who} em ${today}:\n` + card.answer;
    confirm = `✅ *Resposta confirmada* por ${who} em ${today}. Ela passa a valer como referência revisada para dúvidas parecidas.`;
  } else if (cmd === 'corrigir') {
    status = 'corrigida';
    correction = text;
    doc =
      q +
      `ORIENTAÇÃO CORRETA DADA PELO SÊNIOR ${who} em ${today}:\n${text}\n\n(A resposta automática anterior a esta pergunta foi considerada incorreta por este sênior e não deve ser repetida.)`;
    confirm = `✅ *Correção registrada* por ${who} em ${today}:\n${text}`;
  } else {
    status = 'acrescentada';
    addition = text;
    doc = q + `RESPOSTA REVISADA PELO SÊNIOR ${who} em ${today}:\n${card.answer}\n\nACRÉSCIMO DO SÊNIOR:\n${text}`;
    confirm = `✅ *Acréscimo registrado* por ${who} em ${today}:\n${text}`;
  }
  try {
    await deps.kb.insert(doc, meta('confirmada'));
  } catch (err) {
    ctx.log.error({ err: String(err) }, 'falha ao gravar revisão na base');
    return fail();
  }
  await ctx.sql`update tecnico_cards set status = ${status}, reviewed_by = ${fullName}, reviewed_at = ${now},
    correction = ${correction}, addition = ${addition} where id = ${card.id}`;
  await ctx.reply(confirm);
}

/** Lê as chaves do .env na primeira dúvida (o servidor sobe mesmo sem elas). */
function depsFromEnv(env: NodeJS.ProcessEnv = process.env): TecnicoDeps {
  const embeddings = new GeminiEmbeddings(env.GEMINI_API_KEY, env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2');
  return {
    kb: new QdrantBase(env.QDRANT_URL, env.QDRANT_API_KEY, env.QDRANT_COLLECTION || 'gss_base_tecnica', embeddings),
    llm: new Claude(env.ANTHROPIC_API_KEY, env.TECNICO_MODEL || 'claude-sonnet-5-5'),
  };
}

/** Bot de dúvidas técnicas (migrado do n8n): /duvida responde com base nas fichas e os sêniores revisam. */
export function createTecnico(given?: TecnicoDeps): BotModule {
  let deps = given;
  const get = () => (deps ??= depsFromEnv());
  return {
    id: 'tecnico',
    defaultMascot: {
      name: 'Assistente Técnico',
      persona:
        'Você é o assistente técnico de um grupo de WhatsApp de técnicos de manutenção de equipamentos. Seja cordial, direto e profissional. Escreva em português do Brasil, em mensagens curtas. Formatação de WhatsApp: *negrito* com um asterisco só, sem títulos com # e sem links.',
    },
    // Num grupo de trabalho, o mascote não entra: só agenda e resumo.
    features: ['agenda', 'resumo', 'pesquisa'],
    // Quem usa o próprio número do bot no celular também pode perguntar e revisar.
    acceptsFromMe: (msg) => (msg.type === 'text' || msg.type === 'image') && parseTecnico(msg.text) !== null,
    async handle(ctx, msg) {
      if (msg.type !== 'text' && msg.type !== 'image') return;
      const cmd = parseTecnico(msg.text);
      if (!cmd) return;
      if (cmd.type === 'ajuda') return ctx.reply(helpText());
      if (cmd.type === 'duvida') return answer(ctx, get(), msg, cmd.question);
      if (msg.type === 'text') return review(ctx, get(), msg, cmd.cmd, cmd.text);
    },
  };
}

export const tecnico = createTecnico();
