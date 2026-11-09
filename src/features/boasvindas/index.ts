import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { digits } from '../../core/phone.js';

/** Mensagem padrão de boas-vindas. {nome} vira o nome de quem entrou. */
export const DEFAULT_WELCOME = `👋 Seja bem-vindo(a)!

{nome}

📸 Ative a visibilidade da sua foto de perfil para todos

🔇 Recomendamos desativar as notificações e download automático de mídias

⚠️ Copie e cole esse modelo para sua apresentação:

NOME:
IDADE:
BAIRRO/CIDADE:
@ DO INSTA:
ORIENTAÇÃO SEXUAL:
PROFISSÃO:

Conta um pouco mais sobre você também: o que curte fazer, signo, time… queremos te conhecer!`;

interface WelcomeSettings {
  on: boolean;
  text: string;
}

async function load(ctx: BotContext): Promise<WelcomeSettings> {
  const [row] = await ctx.sql<{ settings: Record<string, unknown> }[]>`select settings from bots where id = ${ctx.bot.id}`;
  const s = row?.settings ?? {};
  return {
    on: s.boas_vindas !== false,
    text: typeof s.boas_vindas_texto === 'string' && s.boas_vindas_texto.trim() ? s.boas_vindas_texto : DEFAULT_WELCOME,
  };
}

async function save(ctx: BotContext, patch: Record<string, unknown>): Promise<void> {
  await ctx.sql`update bots set settings = settings || ${ctx.sql.json(patch as never)} where id = ${ctx.bot.id}`;
}

/** "5511987654321" -> "+55 11 98765-4321" */
export function prettyPhone(phone: string): string {
  const d = digits(phone);
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : d ? `+${d}` : '';
}

export function welcomeText(template: string, name: string): string {
  return template.includes('{nome}') ? template.replaceAll('{nome}', name) : `${name}\n\n${template}`;
}

/** Telefone (ou LID) de um membro, usado como chave em group_members. */
async function memberKey(ctx: BotContext, jid: string, chatJid: string): Promise<{ key: string; phone: string }> {
  const phone = jid.endsWith('@s.whatsapp.net') ? digits(jid) : await ctx.contacts.phoneOf(jid, chatJid).catch(() => '');
  return { key: phone || jid, phone };
}

/**
 * Marca o membro como recebido e devolve true se ele ainda não tinha ganhado boas-vindas.
 * Quem já estava no grupo quando o bot começou a acompanhar não recebe.
 */
async function claim(ctx: BotContext, key: string): Promise<boolean> {
  const rows = await ctx.sql`
    insert into group_members (bot_id, member_key, welcomed_at) values (${ctx.bot.id}, ${key}, now())
    on conflict (bot_id, member_key) do nothing returning member_key`;
  return rows.length > 0;
}

async function welcome(ctx: BotContext, cfg: WelcomeSettings, phone: string): Promise<void> {
  // Quem volta para o grupo pode já ter nome conhecido; senão, mostramos o telefone.
  const name = (phone && (await ctx.nameOf(phone))) || prettyPhone(phone) || 'pessoa nova';
  await ctx.reply(welcomeText(cfg.text, name));
}

async function greet(ctx: BotContext, msg: InboundMessage): Promise<void> {
  const cfg = await load(ctx);
  for (const jid of msg.joined ?? []) {
    const { key, phone } = await memberKey(ctx, jid, msg.chatJid);
    if ((await claim(ctx, key)) && cfg.on) await welcome(ctx, cfg, phone);
  }
}

/**
 * A AvisaAPI não avisa quando alguém entra pelo link. Então, de tempos em tempos,
 * o bot compara a lista de membros com a anterior e dá boas-vindas a quem é novo.
 */
export async function checkMembers(ctx: BotContext): Promise<void> {
  const members = await ctx.wa.listGroupMembers(ctx.bot.chatJid);
  if (!members.length) return; // falha ou grupo não encontrado: não mexe em nada
  const keys = [...new Set(members.map((m) => digits(m.phone) || m.lid || m.jid).filter(Boolean))];
  const counted = await ctx.sql<{ n: number }[]>`select count(*)::int as n from group_members where bot_id = ${ctx.bot.id} and welcomed_at is null`;
  const n = counted[0]?.n ?? 0;

  if (n === 0) {
    // Primeira vez (ninguém anotado como já presente): só anota quem já está no grupo.
    await ctx.sql`insert into group_members (bot_id, member_key) select ${ctx.bot.id}, unnest(${keys}::text[]) on conflict do nothing`;
    return;
  }
  // Quem entrou pelo aviso de histórico pode ter sido anotado pelo LID: passa a usar o telefone.
  for (const m of members) {
    const phone = digits(m.phone);
    if (m.lid && phone) {
      await ctx.sql`update group_members set member_key = ${phone} where bot_id = ${ctx.bot.id} and member_key = ${m.lid}
        and not exists (select 1 from group_members where bot_id = ${ctx.bot.id} and member_key = ${phone})`;
    }
  }
  // Quem saiu é esquecido; se voltar, ganha boas-vindas de novo.
  await ctx.sql`delete from group_members where bot_id = ${ctx.bot.id} and not (member_key = any(${keys}::text[]))`;
  await ctx.sql`update group_members set seen_at = now() where bot_id = ${ctx.bot.id}`;

  const cfg = await load(ctx);
  for (const m of members) {
    const key = digits(m.phone) || m.lid || m.jid;
    if (key && (await claim(ctx, key)) && cfg.on) await welcome(ctx, cfg, digits(m.phone));
  }
}

async function command(ctx: BotContext, msg: InboundMessage, arg: string): Promise<void> {
  if (!(await ctx.isAdmin(msg.senderPhone))) {
    await ctx.reply('🛡️ Só os admins podem mudar a mensagem de boas-vindas.');
    return;
  }
  const word = arg.trim().toLowerCase();
  if (!word) {
    const cfg = await load(ctx);
    await ctx.reply(
      [
        `👋 Boas-vindas ${cfg.on ? 'ligadas' : 'desligadas'}. Quando alguém entra no grupo, o bot manda:`,
        '',
        welcomeText(cfg.text, '(nome da pessoa)'),
        '',
        '🛡️ Para trocar: #boasvindas e o texto novo (use {nome} onde vai o nome). #boasvindas padrão volta ao original. #boasvindas desligar / ligar.',
      ].join('\n'),
    );
    return;
  }
  if (word === 'desligar') {
    await save(ctx, { boas_vindas: false });
    await ctx.reply('🔕 Boas-vindas desligadas. Para voltar: #boasvindas ligar');
  } else if (word === 'ligar') {
    await save(ctx, { boas_vindas: true });
    await ctx.reply('👋 Boas-vindas ligadas.');
  } else if (/^padr[aã]o$/.test(word)) {
    await save(ctx, { boas_vindas_texto: null });
    await ctx.reply('👋 Voltamos à mensagem de boas-vindas original. Mande #boasvindas para ver.');
  } else {
    await save(ctx, { boas_vindas_texto: arg.trim(), boas_vindas: true });
    await ctx.reply(`👋 Mensagem de boas-vindas trocada. Ficou assim:\n\n${welcomeText(arg.trim(), '(nome da pessoa)')}`);
  }
}

/** Boas-vindas: quando alguém entra no grupo, pede a apresentação. Função do núcleo. */
export const boasvindas: BotModule = {
  id: 'boasvindas',
  jobs: [{ name: 'membros-novos', cron: '*/2 * * * *', run: checkMembers }],
  async handle(ctx, msg) {
    if (msg.type === 'join') {
      await greet(ctx, msg);
      return true;
    }
    if (msg.type !== 'text') return false;
    const m = /^[#!]boas[-\s]?vindas(?![\p{L}\p{N}])[\s:]*([\s\S]*)$/iu.exec(msg.text.trim());
    if (!m) return false;
    await command(ctx, msg, m[1] ?? '');
    return true;
  },
};
