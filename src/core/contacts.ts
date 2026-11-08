import type { Sql } from '../db.js';
import type { ContactResolver, WhatsAppProvider } from './types.js';
import { digits } from './phone.js';

/**
 * Descobre o telefone por trás de um LID. Primeiro olha o que já aprendemos
 * (tabela wa_contacts); se não souber, busca a lista de membros do grupo uma vez
 * e guarda tudo.
 */
export class Contacts implements ContactResolver {
  constructor(
    private readonly sql: Sql,
    private readonly connectionId: string,
    private readonly wa: WhatsAppProvider,
  ) {}

  async learn(lid: string | undefined, phone: string): Promise<void> {
    if (!lid || !lid.endsWith('@lid') || digits(phone).length < 10) return;
    await this.sql`
      insert into wa_contacts (connection_id, lid, phone) values (${this.connectionId}, ${lid}, ${digits(phone)})
      on conflict (connection_id, lid) do update set phone = excluded.phone, updated_at = now()`;
  }

  async phoneOf(jid: string, chatJid: string): Promise<string> {
    if (!jid) return '';
    if (jid.endsWith('@s.whatsapp.net')) return digits(jid);
    const known = await this.sql<{ phone: string }[]>`
      select phone from wa_contacts where connection_id = ${this.connectionId} and lid = ${jid}`;
    if (known[0]) return known[0].phone;

    const members = await this.wa.listGroupMembers(chatJid);
    for (const m of members) await this.learn(m.lid, m.phone);
    const found = members.find((m) => m.lid === jid || m.jid === jid);
    return found ? digits(found.phone) : '';
  }
}
