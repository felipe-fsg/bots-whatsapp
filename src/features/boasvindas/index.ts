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

async function greet(ctx: BotContext, msg: InboundMessage): Promise<void> {
  const cfg = await load(ctx);
  if (!cfg.on) return;
  for (const jid of msg.joined ?? []) {
    const phone = jid.endsWith('@s.whatsapp.net') ? digits(jid) : await ctx.contacts.phoneOf(jid, msg.chatJid).catch(() => '');
    // Quem volta para o grupo pode já ter nome conhecido; senão, mostramos o telefone.
    const name = (phone && (await ctx.nameOf(phone))) || prettyPhone(phone) || 'pessoa nova';
    await ctx.reply(welcomeText(cfg.text, name));
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
