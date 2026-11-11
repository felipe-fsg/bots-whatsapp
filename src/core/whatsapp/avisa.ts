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

  /** A AvisaAPI devolve todos os grupos do número; pode levar ~30 s. */
  async listGroupMembers(chatJid: string): Promise<GroupMember[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await this.call('GET', '/group/list');
    const groups: any[] = res?.data?.data?.Groups ?? res?.data?.Groups ?? res?.Groups ?? [];
    const group = groups.find((g) => g.JID === chatJid);
    return (group?.Participants ?? []).map((p: any) => ({
      jid: String(p.JID ?? ''),
      lid: p.LID ? String(p.LID) : undefined,
      phone: digits(p.PhoneNumber ?? p.JID),
      admin: p.IsAdmin === true || p.IsSuperAdmin === true,
    }));
  }
}
