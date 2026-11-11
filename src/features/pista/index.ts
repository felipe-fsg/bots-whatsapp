import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { digits } from '../../core/phone.js';
import { prettyPhone } from '../boasvindas/index.js';

const MAX = 40;
const REMOVE = /^(apagar|remover|tirar|excluir)$/i;

async function save(ctx: BotContext, msg: InboundMessage, arg: string): Promise<void> {
  const phone = digits(msg.senderPhone);
  if (!phone) return ctx.reply('💘 Não consegui identificar seu número. Tente de novo em instantes.');
  const status = arg.replace(/\s+/g, ' ').trim();
  if (!status) {
    const [row] = await ctx.sql<{ status: string }[]>`select status from member_relationship where bot_id = ${ctx.bot.id} and phone = ${phone}`;
    return ctx.reply(
      row
        ? `💘 Seu estado civil na pista: *${row.status}*\nPara trocar: #estadocivil e a situação nova. Para sair da lista: #estadocivil apagar`
        : '💘 Mande #estadocivil e a sua situação. Ex.: #estadocivil solteiro(a), #estadocivil namorando, #estadocivil é complicado',
    );
  }
  if (REMOVE.test(status)) {
    const gone = await ctx.sql`delete from member_relationship where bot_id = ${ctx.bot.id} and phone = ${phone} returning phone`;
    return ctx.reply(gone.length ? '💘 Pronto, você saiu da lista da #pista.' : '💘 Você não estava na lista da #pista.');
  }
  if (status.length > MAX) return ctx.reply(`💘 Resume aí, em até ${MAX} letras. Ex.: #estadocivil solteiro(a)`);
  await ctx.sql`
    insert into member_relationship (bot_id, phone, status) values (${ctx.bot.id}, ${phone}, ${status})
    on conflict (bot_id, phone) do update set status = excluded.status, updated_at = now()`;
  const name = (await ctx.nameOf(phone)) || msg.pushName || prettyPhone(phone);
  await ctx.reply(`💘 Anotado! *${name}*: ${status}\nVeja a galera com #pista`);
}

/** Pedido ao mascote: um comentário sobre o quadro geral, sem citar nem zoar ninguém em particular. */
export function pistaPrompt(counts: [string, number][]): string {
  const resumo = counts.map(([s, n]) => `- ${s}: ${n}`).join('\n');
  return [
    'Alguém mandou #pista no grupo e o bot vai mostrar o estado civil que cada pessoa informou.',
    'Situação geral da galera (estado civil: quantas pessoas):',
    resumo,
    '',
    'Escreva UM comentário engraçadinho, de 1 a 2 linhas, sobre esse quadro geral (ex.: muita gente solteira, a pista está cheia ou vazia, muitos casais).',
    'Não cite nomes, não zombe de ninguém, nada ofensivo ou com conotação sexual. Leve, como um amigo brincando. Não repita a lista.',
  ].join('\n');
}

async function list(ctx: BotContext): Promise<void> {
  const rows = await ctx.sql<{ phone: string; status: string }[]>`
    select phone, status from member_relationship where bot_id = ${ctx.bot.id}`;
  if (!rows.length) return ctx.reply('💘 A pista está vazia: ninguém contou o estado civil ainda. Comece: #estadocivil solteiro(a)');
  const items = await Promise.all(
    rows.map(async (r) => ({ name: (await ctx.nameOf(r.phone)) || prettyPhone(r.phone), status: r.status })),
  );
  items.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));

  // Agrupa sem diferenciar maiúsculas/acentos ("Solteira" e "solteira" contam juntas).
  const key = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const groups = new Map<string, [string, number]>();
  for (const i of items) {
    const g = groups.get(key(i.status));
    groups.set(key(i.status), g ? [g[0], g[1] + 1] : [i.status.toLowerCase(), 1]);
  }
  let comment = '';
  try {
    comment = (await ctx.ai.text(pistaPrompt([...groups.values()].sort((a, b) => b[1] - a[1])), {
      system: (await ctx.mascot()).persona,
      temperature: 1,
    })).trim();
  } catch (err) {
    ctx.log.warn({ err: String(err) }, 'IA falhou no #pista');
  }
  await ctx.reply(
    [
      `💘 *Como está a pista* (${items.length})`,
      '',
      ...items.map((i) => `• ${i.name}: ${i.status}`),
      ...(comment ? ['', comment] : []),
      '',
      'Entre na lista com #estadocivil',
    ].join('\n'),
  );
}

/** #estadocivil situação e #pista. Só grupos sociais. */
export const pista: BotModule = {
  id: 'pista',
  async handle(ctx, msg) {
    if (msg.type !== 'text') return false;
    const m = /^[#!](estado\s?civil|pista)(?![\p{L}\p{N}])\s*([\s\S]*)$/iu.exec(msg.text.trim());
    if (!m) return false;
    if (/^pista$/i.test(m[1]!)) await list(ctx);
    else await save(ctx, msg, m[2] ?? '');
    return true;
  },
};
