import type { BotContext, BotModule, InboundMessage } from '../../core/types.js';
import { digits } from '../../core/phone.js';
import { issuesFromEnv, type IssueTracker } from '../../core/github.js';
import { adminOnly } from '../admins/index.js';

export const SUPPORT_LABEL = 'suporte';

function title(botName: string, text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  const short = line.length > 70 ? `${line.slice(0, 67).trimEnd()}...` : line;
  return `[Suporte] ${botName}: ${short}`;
}

async function open(ctx: BotContext, msg: InboundMessage, rest: string, tracker: IssueTracker | null): Promise<void> {
  const own = rest.trim();
  const quoted = msg.quoted?.text?.trim() ?? '';
  const text = [own, quoted && `Mensagem citada: "${quoted}"`].filter(Boolean).join('\n\n');
  if (!own && !quoted) {
    return ctx.reply(
      '🛠️ Conte o problema ou a melhoria logo depois do comando. Ex.: #suporte o ranking não contou meu treino de hoje\n(Também vale responder a uma mensagem com #suporte.)',
    );
  }
  const phone = digits(msg.senderPhone);
  const name = (await ctx.nameOf(phone)) || msg.pushName || null;
  const [row] = await ctx.sql<{ id: number; created_at: Date }[]>`
    insert into support_requests (bot_id, phone, name, text) values (${ctx.bot.id}, ${phone}, ${name}, ${text})
    returning id, created_at`;
  let issue: { number: number; url: string } | null = null;
  if (tracker) {
    try {
      issue = await tracker.create({
        title: title(ctx.bot.name, own || quoted),
        labels: [SUPPORT_LABEL],
        body: [
          `**Grupo:** ${ctx.bot.name} (módulo \`${ctx.bot.module}\`)`,
          `**Pedido por:** ${name ?? 'admin'}`,
          `**Quando:** ${row!.created_at.toISOString()}`,
          `**Pedido nº:** ${row!.id}`,
          '',
          text,
        ].join('\n'),
      });
      await ctx.sql`update support_requests set issue_number = ${issue.number}, issue_url = ${issue.url} where id = ${row!.id}`;
    } catch (err) {
      ctx.log.warn({ err: String(err), pedido: row!.id }, 'não consegui abrir a issue do #suporte');
    }
  }
  await ctx.reply(`🛠️ Pedido de suporte nº ${row!.id} anotado! A equipe do bot vai analisar e resolver. Obrigado por avisar.`);
}

/** #suporte texto: admin relata problema ou pede melhoria. Vira issue no GitHub (etiqueta "suporte"). Todos os bots. */
export function makeSuporte(tracker: () => IssueTracker | null = () => issuesFromEnv()): BotModule {
  return {
    id: 'suporte',
    async handle(ctx, msg) {
      if (msg.type !== 'text') return false;
      const m = /^[#!/]suporte(?![\p{L}\p{N}])\s*([\s\S]*)$/iu.exec(msg.text.trim());
      if (!m) return false;
      if (!(await ctx.isAdmin(msg.senderPhone))) {
        await ctx.reply(adminOnly('abrir pedidos de suporte'));
        return true;
      }
      await open(ctx, msg, m[1] ?? '', tracker());
      return true;
    },
  };
}

export const suporte = makeSuporte();
