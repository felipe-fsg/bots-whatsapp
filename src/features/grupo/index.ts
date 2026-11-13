import type { BotModule } from '../../core/types.js';
import { adminOnly } from '../admins/index.js';

/**
 * #fechargrupo / #abrirgrupo: liga ou desliga o "só admins mandam mensagens" do WhatsApp.
 * Função do núcleo, para todos os bots. O número do bot precisa ser admin do grupo.
 */
export const grupo: BotModule = {
  id: 'grupo',
  async handle(ctx, msg) {
    if (msg.type !== 'text') return false;
    const m = /^[#!/](fechar|abrir)\s*grupo(?![\p{L}\p{N}])/iu.exec(msg.text.trim());
    if (!m) return false;
    const close = m[1]!.toLowerCase() === 'fechar';
    if (!(await ctx.isAdmin(msg.senderPhone))) {
      await ctx.reply(adminOnly(close ? 'fechar o grupo' : 'abrir o grupo'));
      return true;
    }
    try {
      if (!ctx.wa.setAdminsOnly) throw new Error('provedor não muda a configuração do grupo');
      await ctx.wa.setAdminsOnly(msg.chatJid, close);
    } catch (err) {
      ctx.log.warn({ err: String(err) }, close ? 'não consegui fechar o grupo' : 'não consegui abrir o grupo');
      await ctx.reply(
        `🛡️ Não consegui ${close ? 'fechar' : 'abrir'} o grupo sozinho (o número do bot precisa ser admin do grupo). Admins, mudem pelo WhatsApp em Dados do grupo > Configurações do grupo > Enviar mensagens, por favor.`,
      );
      return true;
    }
    // Avisa depois de fechar (admin ainda pode mandar) e depois de abrir.
    await ctx.reply(
      close
        ? '🔒 Grupo fechado: agora só os admins mandam mensagens. Para liberar, um admin manda #abrirgrupo.'
        : '🔓 Grupo aberto: todo mundo pode mandar mensagens de novo.',
    );
    return true;
  },
};
