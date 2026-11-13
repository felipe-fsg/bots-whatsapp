import type { GroupMember, WhatsAppProvider } from '../types.js';
import { digits } from '../phone.js';

/** Cliente da AvisaAPI para um número de WhatsApp. */
export class AvisaClient implements WhatsAppProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`AvisaAPI ${method} ${path} respondeu ${res.status}: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async sendText(chatJid: string, text: string): Promise<void> {
    await this.call('POST', '/actions/sendMessage', { number: chatJid, message: text });
  }

  async sendTextWithId(chatJid: string, text: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await this.call('POST', '/actions/sendMessage', { number: chatJid, message: text });
    return String(r?.data?.response?.data?.Id ?? r?.response?.data?.Id ?? r?.data?.Id ?? r?.id ?? r?.messageId ?? '');
  }

  /**
   * Manda texto marcando pessoas. Os números vão na lista de menções da mensagem (contextInfo.mentionedJid),
   * então todos recebem a notificação de "marcado" mesmo sem o @ aparecer no texto.
   */
  async sendTextMentions(chatJid: string, text: string, jids: string[]): Promise<void> {
    const list = [...new Set(jids.map((j) => (j.includes('@') ? j.replace(/:\d+(?=@)/, '') : `${digits(j)}@s.whatsapp.net`)))];
    await this.call('POST', '/actions/sendMessage', {
      number: chatJid,
      message: text,
      // A AvisaAPI não publica o nome do campo; mandamos nos formatos usados por APIs baseadas no whatsmeow.
      mentions: list,
      mentionedJid: list,
      ContextInfo: { MentionedJID: list },
    });
  }

  /** Tira alguém do grupo (POST /group/update, action remove). O número do bot precisa ser admin do grupo. */
  async removeParticipant(chatJid: string, jid: string): Promise<void> {
    const participant = jid.includes('@') ? jid.replace(/:\d+(?=@)/, '') : `${digits(jid)}@s.whatsapp.net`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await this.call('POST', '/group/update', { groupId: chatJid, participants: [participant], action: 'remove' });
    // A AvisaAPI às vezes responde 200 com o erro dentro (ex.: { data: { code: 500 } }).
    const code = Number(r?.data?.code ?? r?.code ?? 200);
    if (r?.status === false || r?.success === false || r?.data?.success === false || code >= 400) {
      throw new Error(`AvisaAPI não removeu: ${JSON.stringify(r).slice(0, 300)}`);
    }
  }

  /**
   * Liga ou desliga o "só admins mandam mensagens" (announce do WhatsApp). O número do bot precisa ser admin.
   * A AvisaAPI não publica a rota disso; tentamos as usadas por APIs baseadas no whatsmeow e conferimos
   * na lista de grupos (campo IsAnnounce) se mudou mesmo. A primeira que funcionar fica guardada.
   */
  async setAdminsOnly(chatJid: string, on: boolean): Promise<void> {
    const attempts: { path: string; body: unknown }[] = [
      { path: '/group/announce', body: { groupId: chatJid, announce: on, GroupJID: chatJid, Announce: on } },
      { path: '/group/update', body: { groupId: chatJid, action: on ? 'announcement' : 'not_announcement' } },
      { path: '/group/settings', body: { groupId: chatJid, announce: on, setting: on ? 'announcement' : 'not_announcement' } },
    ];
    const all = attempts.map((_, i) => i);
    const route = this.announceRoute;
    const order = route === undefined ? all : [route, ...all.filter((i) => i !== route)];
    const errors: string[] = [];
    for (const i of order) {
      const a = attempts[i]!;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r: any = await this.call('POST', a.path, a.body);
        const code = Number(r?.data?.code ?? r?.code ?? 200);
        if (r?.status === false || r?.success === false || r?.data?.success === false || code >= 400) {
          throw new Error(JSON.stringify(r).slice(0, 200));
        }
        const now = await this.isAdminsOnly(chatJid).catch(() => undefined);
        if (now === undefined || now === on) {
          this.announceRoute = i;
          return;
        }
        errors.push(`${a.path}: respondeu OK mas o grupo não mudou`);
      } catch (err) {
        errors.push(`${a.path}: ${String(err).slice(0, 200)}`);
      }
    }
    throw new Error(`AvisaAPI não mudou o grupo: ${errors.join(' | ')}`);
  }

  private announceRoute?: number;

  /** true se só admins mandam mensagens; undefined se a AvisaAPI não informar. */
  private async isAdminsOnly(chatJid: string): Promise<boolean | undefined> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const group: any = (await this.groups()).find((g) => g.JID === chatJid);
    const v = group?.IsAnnounce ?? group?.GroupAnnounce?.IsAnnounce ?? group?.announce;
    return typeof v === 'boolean' ? v : undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async groups(): Promise<any[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await this.call('GET', '/group/list');
    return res?.data?.data?.Groups ?? res?.data?.Groups ?? res?.Groups ?? [];
  }

  /** A AvisaAPI devolve todos os grupos do número; pode levar ~30 s. */
  async listGroupMembers(chatJid: string): Promise<GroupMember[]> {
    const groups = await this.groups();
    const group = groups.find((g) => g.JID === chatJid);
    return (group?.Participants ?? []).map((p: any) => ({
      jid: String(p.JID ?? ''),
      lid: p.LID ? String(p.LID) : undefined,
      phone: digits(p.PhoneNumber ?? p.JID),
      admin: p.IsAdmin === true || p.IsSuperAdmin === true,
    }));
  }
}
