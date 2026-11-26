import { randomInt } from 'node:crypto';
import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { digits, last8 } from '../../core/phone.js';
import { mentionableMembers } from '../../core/members.js';
import { prettyPhone } from '../boasvindas/index.js';
import { combinam, generoPeloNome, lerOrientacao, perfilPeloNome, rotulo, type Perfil } from './perfil.js';

/** O #shippar não repete um casal que saiu nas últimas 50 rodadas. */
export const SHIP_SEM_REPETIR = 50;
/** O #datealeatorio evita os últimos 10 casais sorteados. */
export const DATE_SEM_REPETIR = 10;
/** Quantos dias de conversa o #shippar lê (é o que o grupo guarda para o #resumo). */
const DIAS_CONVERSA = 3;
const MAX_CHARS = 60_000;
const CASAIS = 3;

const COMO_REGISTRAR = [
  'Exemplos:',
  '• #orientação homem hetero',
  '• #orientação mulher bi',
  '• #orientação gay / #orientação lésbica',
  '• #orientação não binário pan',
  '• #orientação fora (não entra nas brincadeiras)',
  '• #orientação remover (apaga o seu registro)',
].join('\n');

const AVISO_SEM_REGISTRO =
  'Quem não registrou entra pelo nome: nome masculino conta como homem hétero e feminino como mulher hétero (nome que não dá para saber fica de fora).';

// ---------- Pessoas e casais ----------

interface Pessoa {
  key: string;
  phone: string;
  jid: string;
  name: string;
  perfil: Perfil;
}

const parKey = (a: Pessoa, b: Pessoa) => [a.key, b.key].sort().join('|');

/** Membros que dá para marcar, com o perfil registrado (ou o chute pelo nome). Quem está "fora" não entra. */
async function pessoas(ctx: BotContext, label: string): Promise<Pessoa[]> {
  const members = await mentionableMembers(ctx, label);
  const regs = await ctx.sql<{ member_key: string; gender: Perfil['gender']; orientation: Perfil['orientation'] }[]>`
    select member_key, gender, orientation from member_orientations where bot_id = ${ctx.bot.id}`;
  const byKey = new Map(regs.map((r) => [r.member_key, { gender: r.gender, orientation: r.orientation } as Perfil]));
  const out: Pessoa[] = [];
  for (const m of members) {
    const key = last8(m.phone);
    const name = (await ctx.nameOf(m.phone)) || m.name || '';
    const perfil = byKey.get(key) ?? perfilPeloNome(name);
    if (!perfil || perfil.orientation === 'fora') continue;
    out.push({ key, phone: m.phone, jid: m.jid, name, perfil });
  }
  return out;
}

function paresPossiveis(list: Pessoa[], evitar: Set<string>): [Pessoa, Pessoa][] {
  const out: [Pessoa, Pessoa][] = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      if (combinam(list[i]!.perfil, list[j]!.perfil) && !evitar.has(parKey(list[i]!, list[j]!))) out.push([list[i]!, list[j]!]);
  return out;
}

/** Casais das últimas `runs` rodadas. */
async function recentes(ctx: BotContext, kind: 'ship' | 'date', runs: number): Promise<Set<string>> {
  const rows = await ctx.sql<{ pair_key: string }[]>`
    select pair_key from romance_pairs
    where bot_id = ${ctx.bot.id} and kind = ${kind} and run_at >= (
      select coalesce(min(run_at), 'epoch') from (
        select distinct run_at from romance_pairs where bot_id = ${ctx.bot.id} and kind = ${kind} order by run_at desc limit ${runs}
      ) r
    )`;
  return new Set(rows.map((r) => r.pair_key));
}

/** Guarda a rodada e apaga o que passou do limite (não precisa guardar mais que isso). */
async function guardar(ctx: BotContext, kind: 'ship' | 'date', at: Date, pares: [Pessoa, Pessoa][], runs: number): Promise<void> {
  for (const [a, b] of pares)
    await ctx.sql`
      insert into romance_pairs (bot_id, kind, run_at, pair_key) values (${ctx.bot.id}, ${kind}, ${at}, ${parKey(a, b)})
      on conflict do nothing`;
  await ctx.sql`
    delete from romance_pairs where bot_id = ${ctx.bot.id} and kind = ${kind} and run_at < (
      select coalesce(min(run_at), 'epoch') from (
        select distinct run_at from romance_pairs where bot_id = ${ctx.bot.id} and kind = ${kind} order by run_at desc limit ${runs}
      ) r
    )`;
}

const tag = (p: Pessoa) => `@${p.phone}${p.name ? ` (*${p.name}*)` : ''}`;
const plain = (p: Pessoa) => `*${p.name || prettyPhone(p.phone)}*`;

/** Manda marcando as pessoas pelo telefone (como no #quem); se não der, manda com os nomes em negrito. */
async function enviar(ctx: BotContext, build: (fmt: (p: Pessoa) => string) => string, people: Pessoa[]): Promise<void> {
  if (typeof ctx.wa.sendTextMentions === 'function') {
    try {
      const jids = [...new Set(people.map((p) => `${p.phone}@s.whatsapp.net`))];
      return await ctx.wa.sendTextMentions(ctx.bot.chatJid, build(tag), jids);
    } catch (err) {
      ctx.log.warn({ err: String(err) }, 'não consegui marcar no #shippar/#datealeatorio; mandando sem marcar');
    }
  }
  await ctx.reply(build(plain));
}

const limpar = (s: string) => s.replace(/\*\*/g, '*').trim();

// ---------- #orientação ----------

async function orientacao(ctx: BotContext, msg: InboundMessage, arg: string): Promise<void> {
  const phone = digits(msg.senderPhone);
  const name = (await ctx.nameOf(msg.senderPhone)) || msg.pushName || '';
  const quem = name || 'você';
  if (phone.length < 8) {
    await ctx.reply('🏳️‍🌈 Não consegui ver o seu número agora. Tente de novo daqui a pouco.');
    return;
  }
  const key = last8(phone);
  const lido = lerOrientacao(arg);

  if (lido.kind === 'remover') {
    await ctx.sql`delete from member_orientations where bot_id = ${ctx.bot.id} and member_key = ${key}`;
    await ctx.reply(`🗑️ Pronto, ${quem}, apaguei o seu registro. ${AVISO_SEM_REGISTRO}`);
    return;
  }
  if (lido.kind === 'mostrar' || lido.kind === 'invalido') {
    const [reg] = await ctx.sql<{ gender: Perfil['gender']; orientation: Perfil['orientation'] }[]>`
      select gender, orientation from member_orientations where bot_id = ${ctx.bot.id} and member_key = ${key}`;
    const head =
      lido.kind === 'invalido'
        ? '🏳️‍🌈 Não entendi. Diga a orientação (hetero, gay, lésbica, bi ou pan) e, se quiser, se é homem, mulher ou não binário.'
        : reg
          ? `🏳️‍🌈 ${quem}, o seu registro é: *${rotulo(reg)}*.`
          : `🏳️‍🌈 ${quem}, você ainda não registrou. É opcional e serve para o #datealeatorio e o #shippar acertarem quem combina com quem.`;
    await ctx.reply([head, '', COMO_REGISTRAR, '', `_${AVISO_SEM_REGISTRO}_`].join('\n'));
    return;
  }

  let gender = lido.gender ?? generoPeloNome(name);
  if (!gender) {
    if (lido.orientation !== 'fora') {
      await ctx.reply(`🏳️‍🌈 ${quem}, pelo nome não deu para saber. Me diga junto se é homem, mulher ou não binário. Ex.: #orientação mulher ${arg.trim()}`);
      return;
    }
    gender = 'nb';
  }
  if (gender === 'nb' && (lido.orientation === 'hetero' || lido.orientation === 'homo')) {
    await ctx.reply('🏳️‍🌈 Para não binário, use *bi* ou *pan* (combina com todo mundo que também combina com você) ou *fora*. Ex.: #orientação não binário pan');
    return;
  }
  const perfil: Perfil = { gender, orientation: lido.orientation };
  await ctx.sql`
    insert into member_orientations (bot_id, member_key, gender, orientation) values (${ctx.bot.id}, ${key}, ${gender}, ${lido.orientation})
    on conflict (bot_id, member_key) do update set gender = excluded.gender, orientation = excluded.orientation, updated_at = now()`;
  await ctx.reply(
    lido.orientation === 'fora'
      ? `✅ Anotado, ${quem}: você fica *fora* do #datealeatorio e do #shippar. Para voltar, registre de novo; para apagar, #orientação remover.`
      : `✅ Anotado, ${quem}: *${rotulo(perfil)}*. O #datealeatorio e o #shippar vão levar isso em conta. Para apagar: #orientação remover.`,
  );
}

// ---------- #datealeatorio ----------

const IDEIAS_DATE = [
  'um rodízio de pizza, e quem comer menos paga',
  'um cineminha com direito a pipoca dividida',
  'um açaí no fim da tarde',
  'um piquenique no parque',
  'um karaokê, com dueto obrigatório',
  'uma caminhada seguida de pastel na feira',
  'um café com bolo de pote',
  'um boliche, e quem perder paga o sorvete',
];

export function datePrompt(a: string, b: string): string {
  return [
    `O bot sorteou duas pessoas do grupo para um date de brincadeira: [P1] (${a || 'sem nome'}) e [P2] (${b || 'sem nome'}).`,
    'Escreva o anúncio do date em 2 ou 3 linhas, do seu jeito de personagem, com uma ideia criativa e barata de programa para os dois.',
    'Use exatamente [P1] e [P2] no lugar das pessoas (o bot troca pelo @ de verdade).',
    'Tom leve e engraçado, de amigos. Nada ofensivo, constrangedor ou de cunho sexual. Não escreva aviso de que é brincadeira (o bot já põe).',
  ].join('\n');
}

async function dateAleatorio(ctx: BotContext, msg: InboundMessage): Promise<void> {
  const lista = await pessoas(ctx, '#datealeatorio');
  const evitar = await recentes(ctx, 'date', DATE_SEM_REPETIR);
  let pares = paresPossiveis(lista, evitar);
  if (!pares.length) pares = paresPossiveis(lista, new Set());
  if (!pares.length) {
    await ctx.reply(`💘 Não achei um casal que combine no grupo agora. Registrem com #orientação para o cupido trabalhar melhor!\n\n_${AVISO_SEM_REGISTRO}_`);
    return;
  }
  const par = pares[randomInt(pares.length)]!;
  const [a, b] = randomInt(2) ? [par[1], par[0]] : par;

  let frase = '';
  try {
    frase = limpar(await ctx.ai.text(datePrompt(a.name, b.name), { system: (await ctx.mascot()).persona, temperature: 1 }));
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou no #datealeatorio');
  }
  if (!frase.includes('[P1]') || !frase.includes('[P2]'))
    frase = `[P1] e [P2], o cupido sorteou vocês! O date é ${IDEIAS_DATE[randomInt(IDEIAS_DATE.length)]}. 😍`;

  await guardar(ctx, 'date', msg.timestamp, [par], DATE_SEM_REPETIR);
  await enviar(
    ctx,
    (fmt) =>
      ['💘 *Date aleatório!*', '', frase.replace('[P1]', fmt(a)).replace('[P2]', fmt(b)), '', '_🎭 Só brincadeira, viu? Ninguém é obrigado a nada (mas um cafezinho não mata ninguém)._'].join('\n'),
    [a, b],
  );
}

// ---------- #shippar ----------

export function shipPrompt(people: string, transcript: string, allowed: string | null, partial: boolean): string {
  return [
    `Abaixo está a conversa dos últimos dias de um grupo de WhatsApp${partial ? ' (as mensagens mais recentes)' : ''}. Cada pessoa aparece por um código (P1, P2...).`,
    'Brincadeira do "shippar": escolha os casais com mais química na conversa (quem conversa muito entre si, responde o outro, faz piada interna, tem gostos em comum, se provoca de leve).',
    allowed ? `Só pode escolher casais desta lista: ${allowed}` : 'Escolha só entre as pessoas da lista.',
    'Dê até 6 casais, do mais provável para o menos. Evite repetir a mesma pessoa em casais diferentes.',
    'Para cada casal, um motivo curto e engraçado (uma frase), citando algo que aconteceu na conversa e chamando as pessoas pelo nome. Nada ofensivo, constrangedor, íntimo ou de cunho sexual, e não exponha segredos.',
    'Responda só em JSON, assim: {"casais":[{"a":"P1","b":"P2","motivo":"..."}]}',
    '',
    'Pessoas:',
    people,
    '',
    'Conversa:',
    transcript,
  ].join('\n');
}

const MOTIVOS_RESERVA = [
  'O cupido do bot sentiu uma energia diferente aí. 👀',
  'Ninguém sabe explicar, mas o shippômetro apitou forte.',
  'Combinam mais que arroz com feijão.',
  'As estrelas (e o bot) aprovam esse casal.',
];

/** Lê o JSON da IA (com ou sem ```), sem quebrar se vier torto. */
export function lerCasais(raw: string): { a: string; b: string; motivo: string }[] {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return [];
  try {
    const data = JSON.parse(m[0]) as { casais?: unknown };
    if (!Array.isArray(data.casais)) return [];
    return data.casais
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => ({ a: String(c.a ?? '').trim().toUpperCase(), b: String(c.b ?? '').trim().toUpperCase(), motivo: String(c.motivo ?? '').trim() }));
  } catch {
    return [];
  }
}

async function shippar(ctx: BotContext, msg: InboundMessage): Promise<void> {
  const desde = new Date(ctx.now().getTime() - DIAS_CONVERSA * 86_400_000);
  const rows = await ctx.sql<{ sender_phone: string | null; text: string }[]>`
    select sender_phone, text from group_messages
    where bot_id = ${ctx.bot.id} and sent_at >= ${desde} and msg_id <> ${msg.id}
    order by sent_at`;
  const conversa = rows.filter((r) => !/^\s*[#!?/\\]/.test(r.text));

  const falaram = new Set(conversa.map((r) => (r.sender_phone ? last8(r.sender_phone) : '')).filter((k) => k.length === 8));
  const lista = (await pessoas(ctx, '#shippar')).filter((p) => falaram.has(p.key));
  const evitar = await recentes(ctx, 'ship', SHIP_SEM_REPETIR);
  const pares = paresPossiveis(lista, evitar);
  if (conversa.length < 5 || !pares.length) {
    await ctx.reply(
      conversa.length < 5
        ? '💘 Quase não teve conversa nos últimos dias. Conversem mais que depois eu shippo! 😏'
        : `💘 Não achei casal novo para shippar: ou já saíram todos nas últimas ${SHIP_SEM_REPETIR} rodadas, ou ninguém que conversou combina. Registrem com #orientação para o cupido acertar!`,
    );
    return;
  }

  // Códigos no lugar dos telefones: a IA só vê nomes e códigos, nunca números nem orientação.
  const code = new Map(lista.map((p, i) => [p.key, `P${i + 1}`]));
  const byCode = new Map(lista.map((p, i) => [`P${i + 1}`, p]));
  const peopleText = lista.map((p) => `${code.get(p.key)}: ${p.name || 'sem nome'}`).join('\n');
  const lines = conversa.map((r) => {
    const c = r.sender_phone ? code.get(last8(r.sender_phone)) : undefined;
    return `${c ?? 'outra pessoa'}: ${r.text.replace(/\s+/g, ' ')}`;
  });
  let transcript = '';
  let partial = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (transcript.length + lines[i]!.length > MAX_CHARS) {
      partial = true;
      break;
    }
    transcript = `${lines[i]}\n${transcript}`;
  }
  const allowed = pares.length <= 300 ? pares.map(([a, b]) => `${code.get(a.key)}+${code.get(b.key)}`).join(', ') : null;

  let sugestoes: { a: string; b: string; motivo: string }[] = [];
  try {
    const raw = await ctx.ai.text(shipPrompt(peopleText, transcript.trim(), allowed, partial), {
      system: (await ctx.mascot()).persona,
      temperature: 0.8,
      json: true,
    });
    sugestoes = lerCasais(raw);
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou no #shippar');
  }

  // Confere tudo o que a IA mandou: só casais que combinam e que não saíram nas últimas rodadas.
  const valid = new Map(pares.map((p) => [parKey(p[0], p[1]), p]));
  const escolhidos: { par: [Pessoa, Pessoa]; motivo: string }[] = [];
  const usados = new Set<string>();
  const tentar = (par: [Pessoa, Pessoa] | undefined, motivo: string, distintos: boolean) => {
    if (!par || escolhidos.length >= CASAIS) return;
    const k = parKey(par[0], par[1]);
    if (escolhidos.some((e) => parKey(e.par[0], e.par[1]) === k)) return;
    if (distintos && (usados.has(par[0].key) || usados.has(par[1].key))) return;
    escolhidos.push({ par, motivo });
    usados.add(par[0].key).add(par[1].key);
  };
  const daIa = sugestoes.map((s) => {
    const a = byCode.get(s.a);
    const b = byCode.get(s.b);
    return { par: a && b && a !== b ? valid.get(parKey(a, b)) : undefined, motivo: limpar(s.motivo) };
  });
  for (const distintos of [true, false]) for (const s of daIa) tentar(s.par, s.motivo || MOTIVOS_RESERVA[0]!, distintos);
  const sobra = [...pares].sort(() => randomInt(3) - 1);
  for (const distintos of [true, false]) for (const p of sobra) tentar(p, MOTIVOS_RESERVA[randomInt(MOTIVOS_RESERVA.length)]!, distintos);

  // Os motivos vêm com P1, P2...: troca pelos nomes.
  const semCodigo = (s: string) => s.replace(/\bP(\d+)\b/g, (all) => byCode.get(all)?.name || 'alguém');
  await guardar(ctx, 'ship', msg.timestamp, escolhidos.map((e) => e.par), SHIP_SEM_REPETIR);
  const mascote = (await ctx.mascot()).name;
  const numeros = ['1️⃣', '2️⃣', '3️⃣'];
  await enviar(
    ctx,
    (fmt) =>
      [
        `💘 *Shippômetro do ${mascote}*`,
        'Li a conversa dos últimos dias e o cupido apontou:',
        '',
        ...escolhidos.flatMap((e, i) => [`${numeros[i]} ${fmt(e.par[0])} + ${fmt(e.par[1])}`, `_${semCodigo(e.motivo)}_`, '']),
        '_🎭 Só brincadeira, viu? Ninguém precisa casar (ainda)._',
        '_Para o cupido acertar com quem você combina: #orientação_',
      ].join('\n'),
    escolhidos.flatMap((e) => e.par),
  );
}

/** #orientação, #datealeatorio e #shippar. Só grupos sociais (o técnico e a água não usam). */
export const romance: BotModule = {
  id: 'romance',
  async handle(ctx, msg) {
    if (msg.type !== 'text') return false;
    const text = msg.text.trim();
    const o = /^[#!]orientac(?:ao|oes)(?![\p{L}\p{N}])\s*([\s\S]*)$/iu.exec(text);
    if (o) {
      await orientacao(ctx, msg, o[1]!.slice(0, 100));
      return true;
    }
    if (/^[#!]dates?(?:_|-)?aleatorios?(?![\p{L}\p{N}])/iu.test(text)) {
      await dateAleatorio(ctx, msg);
      return true;
    }
    if (/^[#!](?:shippar|shipar|ship)(?![\p{L}\p{N}])/iu.test(text)) {
      await shippar(ctx, msg);
      return true;
    }
    return false;
  },
};
