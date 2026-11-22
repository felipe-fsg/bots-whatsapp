import { DateTime } from 'luxon';
import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { digits, last8 } from '../../core/phone.js';
import { local, localDay } from '../../core/time.js';
import { foldCommand } from '../../core/commands.js';

// ---------- Datas e signos ----------

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS_NO_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface Nascimento {
  day: number;
  month: number;
  year: number | null;
}

/**
 * Lê a data que a pessoa escreveu: "15/03", "15/03/1990", "15-03-90", "15.03",
 * "15 de março" ou "15 de março de 1990". Devolve null se não for uma data válida.
 */
export function parseNascimento(text: string, now: Date = new Date()): Nascimento | null {
  const t = foldCommand(text).replace(/\s+/g, ' ').trim();
  let day: number, month: number, yearRaw: string | undefined;
  const num = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2}|\d{4}))?$/.exec(t);
  const ext = /^(\d{1,2})(?:\s*de)?\s+([a-z]+)(?:(?:\s*de)?\s+(\d{2}|\d{4}))?$/.exec(t);
  if (num) {
    day = Number(num[1]);
    month = Number(num[2]);
    yearRaw = num[3];
  } else if (ext) {
    day = Number(ext[1]);
    const i = MESES.findIndex((m) => m.startsWith(ext[2]!.slice(0, 3)));
    if (i < 0 || !MESES[i]!.startsWith(ext[2]!)) return null;
    month = i + 1;
    yearRaw = ext[3];
  } else return null;
  if (month < 1 || month > 12 || day < 1 || day > DIAS_NO_MES[month - 1]!) return null;

  let year: number | null = null;
  if (yearRaw) {
    const thisYear = now.getUTCFullYear();
    year = Number(yearRaw);
    if (yearRaw.length === 2) year += year > thisYear % 100 ? 1900 : 2000;
    if (year < 1900 || year > thisYear) return null;
    if (month === 2 && day === 29 && !DateTime.local(year, 1, 1).isInLeapYear) return null;
  }
  return { day, month, year };
}

/** Signos com o dia em que cada um começa. */
export const SIGNOS: { name: string; emoji: string; month: number; day: number }[] = [
  { name: 'Capricórnio', emoji: '♑', month: 12, day: 22 },
  { name: 'Aquário', emoji: '♒', month: 1, day: 20 },
  { name: 'Peixes', emoji: '♓', month: 2, day: 19 },
  { name: 'Áries', emoji: '♈', month: 3, day: 21 },
  { name: 'Touro', emoji: '♉', month: 4, day: 20 },
  { name: 'Gêmeos', emoji: '♊', month: 5, day: 21 },
  { name: 'Câncer', emoji: '♋', month: 6, day: 21 },
  { name: 'Leão', emoji: '♌', month: 7, day: 23 },
  { name: 'Virgem', emoji: '♍', month: 8, day: 23 },
  { name: 'Libra', emoji: '♎', month: 9, day: 23 },
  { name: 'Escorpião', emoji: '♏', month: 10, day: 23 },
  { name: 'Sagitário', emoji: '♐', month: 11, day: 22 },
];

export type Signo = (typeof SIGNOS)[number];

export function signoDe(day: number, month: number): Signo {
  // o último signo que já começou até esta data (Capricórnio vira o ano)
  let found = SIGNOS[0]!;
  for (const s of SIGNOS.slice(1)) if (month > s.month || (month === s.month && day >= s.day)) found = s;
  if (month === 12 && day >= 22) found = SIGNOS[0]!;
  return found;
}

/** Acha o signo pelo nome escrito pela pessoa ("leao", "Gêmeos", "escorpiao"...). */
export function signoPorNome(text: string): Signo | null {
  const t = foldCommand(text).replace(/[^a-z]/g, '');
  if (!t) return null;
  return SIGNOS.find((s) => foldCommand(s.name) === t) ?? null;
}

const dm = (n: Nascimento) => `${String(n.day).padStart(2, '0')}/${String(n.month).padStart(2, '0')}`;

// ---------- Marcação ----------

/** Manda marcando as pessoas pelo telefone (a AvisaAPI só marca assim). Se não der, manda sem marcar. */
async function sendTagged(ctx: BotContext, withTags: string, plain: string, phones: string[]): Promise<void> {
  if (phones.length && typeof ctx.wa.sendTextMentions === 'function') {
    try {
      return await ctx.wa.sendTextMentions(ctx.bot.chatJid, withTags, phones.map((p) => `${p}@s.whatsapp.net`));
    } catch (err) {
      ctx.log.warn({ err: String(err) }, 'não consegui marcar; mandando sem marcar');
    }
  }
  await ctx.reply(plain);
}

const canTag = (ctx: BotContext) => typeof ctx.wa.sendTextMentions === 'function';

// ---------- #nascimento ----------

const USO =
  '🎂 Para registrar seu aniversário: *#nascimento 15/03* (o ano é opcional: #nascimento 15/03/1990). Para apagar: *#nascimento apagar*';

async function nascimento(ctx: BotContext, msg: InboundMessage, arg: string): Promise<void> {
  let phone = digits(msg.senderPhone);
  let forOther = false;
  // Admin respondendo à mensagem de alguém registra a data dessa pessoa.
  if (msg.quoted && arg && (await ctx.isAdmin(phone))) {
    const p = await ctx.contacts.phoneOf(msg.quoted.participant, msg.chatJid).catch(() => '');
    if (digits(p).length >= 8 && last8(p) !== last8(phone)) {
      phone = digits(p);
      forOther = true;
    }
  }
  if (phone.length < 8) {
    await ctx.reply('🎂 Não consegui ver o seu número para registrar. Peça para um admin responder a uma mensagem sua com #nascimento e a data.');
    return;
  }
  const name = (await ctx.nameOf(phone)) || (forOther ? '' : msg.pushName) || 'você';
  const key = last8(phone);

  if (!arg) {
    const [row] = await ctx.sql<{ day: number; month: number; year: number | null }[]>`
      select day, month, year from birthdays where bot_id = ${ctx.bot.id} and member_key = ${key}`;
    if (!row) return ctx.reply(USO);
    const s = signoDe(row.day, row.month);
    return ctx.reply(`🎂 ${name}, seu aniversário está registrado: *${dm(row)}* (${s.emoji} ${s.name}).\n\nPara trocar: #nascimento nova data. Para apagar: #nascimento apagar`);
  }

  if (/^(apagar|remover|excluir|tirar|apaga)$/.test(foldCommand(arg))) {
    const del = await ctx.sql`delete from birthdays where bot_id = ${ctx.bot.id} and member_key = ${key} returning 1`;
    return ctx.reply(del.length ? `🎂 Pronto, ${name}: apaguei a data de aniversário.` : `🎂 ${name}, não tinha nenhuma data registrada.`);
  }

  const n = parseNascimento(arg, ctx.now());
  if (!n) return ctx.reply(`🎂 Não entendi a data "${arg.slice(0, 40)}". ${USO}`);

  // Se a data mudou para hoje e já houve parabéns este ano, não repete; se mudou para outro dia, libera.
  await ctx.sql`
    insert into birthdays (bot_id, member_key, phone, day, month, year)
    values (${ctx.bot.id}, ${key}, ${phone}, ${n.day}, ${n.month}, ${n.year})
    on conflict (bot_id, member_key) do update set
      phone = excluded.phone, day = excluded.day, month = excluded.month, year = excluded.year,
      greeted_year = case when birthdays.day = excluded.day and birthdays.month = excluded.month then birthdays.greeted_year end,
      updated_at = now()`;
  const s = signoDe(n.day, n.month);
  const who = forOther ? `o aniversário de *${name || 'quem você respondeu'}*` : `seu aniversário, ${name}`;
  await ctx.reply(
    `🎂 Anotado ${who}: *${dm(n)}* (${s.emoji} ${s.name}). No dia eu mando os parabéns aqui no grupo!` +
      (n.year ? '\n\n🔒 O ano fica só comigo: não mostro a idade para ninguém.' : '') +
      '\n\nAgora dá para usar o *#horoscopo*.',
  );
}

// ---------- #aniversariantes ----------

async function aniversariantes(ctx: BotContext): Promise<void> {
  const today = local(ctx.now(), ctx.timezone);
  const rows = await ctx.sql<{ phone: string; day: number; month: number }[]>`
    select phone, day, month from birthdays where bot_id = ${ctx.bot.id} and month = ${today.month} order by day`;
  const mes = today.setLocale('pt-BR').toFormat('LLLL');
  if (!rows.length) return ctx.reply(`🎂 Ninguém registrou aniversário em ${mes}. Registre o seu com #nascimento 15/03`);
  const lines = await Promise.all(
    rows.map(async (r) => `• ${dm({ ...r, year: null })} - ${(await ctx.nameOf(r.phone)) || '(sem nome)'}${r.day === today.day ? ' 🎉 hoje!' : ''}`),
  );
  await ctx.reply([`🎂 *Aniversariantes de ${mes}*`, '', ...lines, '', 'Registre o seu com #nascimento 15/03'].join('\n'));
}

// ---------- Parabéns automático ----------

export function parabensPrompt(names: string[], hour: number): string {
  return [
    `Hoje é aniversário de: ${names.join(', ')}. Agora são ${hour}h.`,
    `Escreva uma mensagem de feliz aniversário para o grupo, do seu jeito de personagem, chamando ${names.length > 1 ? 'cada aniversariante pelo nome' : 'a pessoa pelo nome'} e convidando a galera a dar os parabéns.`,
    'De 3 a 5 linhas, calorosa e divertida, com alguns emojis de festa. Varie o estilo e evite frases prontas.',
    'Não fale de idade nem de signo. Nada ofensivo ou de cunho sexual. Não marque ninguém com @ (o bot já marca).',
  ].join('\n');
}

/** Datas que fazem aniversário hoje (29/02 comemora em 28/02 nos anos que não são bissextos). */
function todaysDates(today: DateTime): { day: number; month: number }[] {
  const list = [{ day: today.day, month: today.month }];
  if (today.month === 2 && today.day === 28 && !today.isInLeapYear) list.push({ day: 29, month: 2 });
  return list;
}

/** Todo dia de manhã: parabéns para quem faz aniversário, marcando cada um. */
export async function parabensJob(ctx: BotContext): Promise<void> {
  const today = local(ctx.now(), ctx.timezone);
  const people: { phone: string; name: string }[] = [];
  for (const d of todaysDates(today)) {
    // marca antes de mandar: se o servidor reiniciar, não dá parabéns duas vezes
    const rows = await ctx.sql<{ phone: string }[]>`
      update birthdays set greeted_year = ${today.year}
      where bot_id = ${ctx.bot.id} and day = ${d.day} and month = ${d.month}
        and greeted_year is distinct from ${today.year}
      returning phone`;
    for (const r of rows) people.push({ phone: digits(r.phone), name: await ctx.nameOf(r.phone) });
  }
  if (!people.length) return;

  const names = people.map((p) => p.name || 'aniversariante');
  let text = '';
  try {
    text = (await ctx.ai.text(parabensPrompt(names, today.hour), { system: (await ctx.mascot()).persona, temperature: 1 }))
      .replace(/\*\*/g, '*')
      .trim();
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou no parabéns');
  }
  if (!text) text = `🥳 Hoje é dia de festa! Parabéns, ${names.join(' e ')}! Muita saúde, alegria e conquistas. Galera, bora dar os parabéns! 🎉🎈`;

  const tags = people.map((p) => `🎂 @${p.phone}${p.name ? ` (*${p.name}*)` : ''}`);
  const plain = people.map((p) => `🎂 *${p.name || 'Aniversariante'}*`);
  await sendTagged(ctx, ['🎉 *Feliz aniversário!*', ...tags, '', text].join('\n'), ['🎉 *Feliz aniversário!*', ...plain, '', text].join('\n'), people.map((p) => p.phone));
}

// ---------- #horoscopo ----------

export function horoscopoPrompt(name: string, signo: Signo, date: string, own: boolean): string {
  return [
    own
      ? `${name} pediu o horóscopo do dia. O signo dessa pessoa é ${signo.name}. Hoje é ${date}.`
      : `${name} pediu o horóscopo do dia do signo de ${signo.name}. Hoje é ${date}.`,
    'Escreva o horóscopo do dia como um astrólogo divertido, do seu jeito de personagem, em no máximo 7 linhas:',
    'uma frase sobre o clima geral do dia para o signo, depois *Amor*, *Trabalho* e *Energia* (uma linha cada), e no fim um número da sorte e uma cor do dia.',
    own ? 'Fale com a pessoa pelo nome.' : 'Fale com quem pediu pelo nome.',
    'Tom leve, engraçado e positivo. Não faça previsões de doença, morte, gravidez, dinheiro garantido ou términos; não dê conselho médico, financeiro ou jurídico. Nada ofensivo ou de cunho sexual.',
    'Não escreva aviso de que é brincadeira (o bot já põe) e não repita o nome do signo no título (o bot já mostra).',
  ].join('\n');
}

export function horoscopoFallback(name: string, signo: Signo): string {
  return `✨ ${name}, os astros de ${signo.name} dizem que hoje é um ótimo dia para fazer o que você gosta e espalhar boas energias!\n*Número da sorte:* 7 · *Cor do dia:* azul`;
}

async function horoscopo(ctx: BotContext, msg: InboundMessage, arg: string): Promise<void> {
  const phone = digits(msg.senderPhone);
  const name = (await ctx.nameOf(msg.senderPhone)) || msg.pushName || 'você';
  let signo: Signo | null = null;
  let own = false;

  if (arg) {
    signo = signoPorNome(arg);
    if (!signo) {
      await ctx.reply(`🔭 Não conheço o signo "${arg.slice(0, 30)}". Use #horoscopo sozinho (com o aniversário registrado) ou com o signo. Ex.: #horoscopo leão`);
      return;
    }
  } else {
    const [row] = phone.length >= 8
      ? await ctx.sql<{ day: number; month: number }[]>`select day, month from birthdays where bot_id = ${ctx.bot.id} and member_key = ${last8(phone)}`
      : [];
    if (!row) {
      await ctx.reply(`🔭 ${name}, ainda não sei o seu signo. Registre seu aniversário com *#nascimento 15/03* ou peça o de um signo: #horoscopo leão`);
      return;
    }
    signo = signoDe(row.day, row.month);
    own = true;
  }

  if (phone.length >= 8 && !(await ctx.isAdmin(phone))) {
    const saved = await ctx.sql`
      insert into horoscope_readings (bot_id, member_key, day)
      values (${ctx.bot.id}, ${last8(phone)}, ${localDay(msg.timestamp, ctx.timezone)})
      on conflict do nothing returning 1`;
    if (!saved.length) {
      await ctx.reply(`🔭 ${name}, os astros já falaram com você hoje. Volte amanhã para um novo horóscopo!`);
      return;
    }
  }

  const date = local(msg.timestamp, ctx.timezone).setLocale('pt-BR').toFormat("d 'de' LLLL");
  let text = '';
  try {
    text = (await ctx.ai.text(horoscopoPrompt(name, signo, date, own), { system: (await ctx.mascot()).persona, temperature: 1 }))
      .replace(/\*\*/g, '*')
      .trim();
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou no #horoscopo');
  }
  if (!text) text = horoscopoFallback(name, signo);

  const head = `${signo.emoji} *Horóscopo de ${signo.name}* - ${date}`;
  const footer = '_🎭 Só brincadeira, viu? Quem escreve o seu dia é você._';
  const body = [head, '', text, '', footer];
  if (phone.length >= 8 && canTag(ctx)) {
    const tag = `🔭 @${phone}${name ? ` (*${name}*)` : ''}, olhei os astros para você!`;
    await sendTagged(ctx, [tag, '', ...body].join('\n'), [`🔭 *${name}*, olhei os astros para você!`, '', ...body].join('\n'), [phone]);
    return;
  }
  await ctx.reply([`🔭 *${name}*, olhei os astros para você!`, '', ...body].join('\n'));
}

// ---------- Módulo ----------

/**
 * #nascimento registra o aniversário (dia/mês, ano opcional), #aniversariantes lista os do mês,
 * #horoscopo lê o signo, e todo dia às 9h o mascote dá os parabéns. Só grupos sociais.
 */
export const aniversario: BotModule = {
  id: 'aniversario',
  jobs: [{ name: 'parabens', cron: '0 9 * * *', run: parabensJob }],
  async handle(ctx, msg) {
    if (msg.type !== 'text') return false;
    const t = msg.text.trim();
    const arg = (m: RegExpExecArray) => m[1]!.replace(/\s+/g, ' ').trim();
    let m = /^[#!](?:nascimento|aniversario)(?![\p{L}\p{N}])\s*([\s\S]*)$/u.exec(t);
    if (m) return nascimento(ctx, msg, arg(m)).then(() => true);
    if (/^[#!]aniversariantes(?![\p{L}\p{N}])/u.test(t)) return aniversariantes(ctx).then(() => true);
    m = /^[#!](?:horoscopo|signo)(?![\p{L}\p{N}])\s*([\s\S]*)$/u.exec(t);
    if (m) return horoscopo(ctx, msg, arg(m)).then(() => true);
    return false;
  },
};
