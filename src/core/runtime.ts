import type { Sql } from '../db.js';
import type { AiClient, Bot, BotContext, BotModule, GroupMember, InboundMessage, Logger, PlacesClient, WhatsAppProvider } from './types.js';
import { Contacts } from './contacts.js';
import { KeyedQueue } from './queue.js';
import { digits, last8, samePhone } from './phone.js';
import { normalizeCommand } from './commands.js';
import { AvisaClient } from './whatsapp/avisa.js';
import { isOwner, ownerPhones, parseAtivacao, runAtivacao, type AtivacaoCommand } from './ativacao.js';

interface ConnectionRow {
  id: string;
  provider: string;
  base_url: string;
  token_env: string;
  forward_url: string | null;
  forward_chats: string[];
  own_phone: string | null;
  label: string;
}

interface BotRow {
  id: string;
  tenant_id: string;
  connection_id: string;
  name: string;
  module: string;
  chat_jid: string;
  settings: Record<string, unknown>;
}

export interface RuntimeDeps {
  sql: Sql;
  modules: BotModule[];
  /** Funções do núcleo que valem para todos os bots (ex.: agenda). Rodam antes do módulo. */
  features?: BotModule[];
  ai: AiClient;
  places: PlacesClient;
  log: Logger;
  now?: () => Date;
  /** Permite trocar o provedor de WhatsApp nos testes. */
  providerFor?: (conn: ConnectionRow) => WhatsAppProvider;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
}

export const DEFAULT_MASCOT = {
  name: 'Mascote',
  persona:
    'Você é o mascote de um grupo de WhatsApp: simpático, bem-humorado e prestativo. Escreva em português do Brasil, em mensagens curtas. Formatação de WhatsApp: *negrito* com um asterisco só, sem títulos com # e sem links. Nunca critique ou exponha alguém pelo nome.',
};

/** Repasse de uma mensagem para o sistema antigo (ex.: n8n), no formato que chegou. */
export type Forwarder = (url: string) => Promise<void>;

/** Liga o webhook aos bots: acha o bot do grupo, evita repetição e chama o módulo. */
export class Runtime {
  private readonly queue = new KeyedQueue();
  private readonly modules: Map<string, BotModule>;
  private cache: { at: number; bots: BotRow[]; conns: Map<string, ConnectionRow> } | null = null;
  private readonly providers = new Map<string, WhatsAppProvider>();
  private readonly now: () => Date;

  constructor(private readonly deps: RuntimeDeps) {
    this.modules = new Map(deps.modules.map((m) => [m.id, m]));
    this.now = deps.now ?? (() => new Date());
  }

  get sql(): Sql {
    return this.deps.sql;
  }

  /** Esquece o cache de bots (depois de cadastrar um bot novo, por exemplo). */
  invalidate(): void {
    this.cache = null;
  }

  private async load() {
    if (this.cache && Date.now() - this.cache.at < 30_000) return this.cache;
    const conns = await this.deps.sql<ConnectionRow[]>`
      select id, label, provider, base_url, token_env, forward_url, forward_chats, own_phone from wa_connections`;
    const bots = await this.deps.sql<BotRow[]>`
      select id, tenant_id, connection_id, name, module, chat_jid, settings from bots where active`;
    this.cache = { at: Date.now(), bots, conns: new Map(conns.map((c) => [c.id, c])) };
    return this.cache;
  }

  provider(conn: ConnectionRow): WhatsAppProvider {
    let p = this.providers.get(conn.id);
    if (!p) {
      if (this.deps.providerFor) p = this.deps.providerFor(conn);
      else {
        const token = (this.deps.env ?? process.env)[conn.token_env];
        if (!token) throw new Error(`Variável ${conn.token_env} (token da AvisaAPI) não definida`);
        p = new AvisaClient(conn.base_url, token, this.deps.fetchFn);
      }
      p = this.recordingSends(p);
      this.providers.set(conn.id, p);
    }
    return p;
  }

  /** Telefones dos admins do grupo no WhatsApp (guardados por 10 min; 1 min se a AvisaAPI falhar). */
  private readonly groupAdminCache = new Map<string, { at: number; ttl: number; phones: Promise<string[]> }>();

  groupAdmins(connectionId: string, chatJid: string, wa: WhatsAppProvider): Promise<string[]> {
    const key = `${connectionId}|${chatJid}`;
    const hit = this.groupAdminCache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.phones;
    const entry = { at: Date.now(), ttl: 10 * 60_000, phones: Promise.resolve<string[]>([]) };
    entry.phones = (async () => {
      try {
        const admins = (await wa.listGroupMembers(chatJid)).filter((m) => m.admin);
        const lidOf = (m: GroupMember) => m.lid ?? (m.jid.endsWith('@lid') ? m.jid : '');
        const out: string[] = [];
        const lids: string[] = [];
        for (const m of admins) {
          const lid = lidOf(m);
          if (digits(m.phone).length >= 8 && !(lid && digits(lid) === digits(m.phone))) out.push(digits(m.phone));
          else if (lid) lids.push(lid);
        }
        if (lids.length) {
          // admin com número escondido (só LID): usa o telefone que o bot já aprendeu dele
          const rows = await this.deps.sql<{ phone: string }[]>`
            select phone from wa_contacts where connection_id = ${connectionId} and lid = any(${lids}::text[])`;
          out.push(...rows.map((r) => digits(r.phone)));
        }
        return out;
      } catch (err) {
        entry.ttl = 60_000;
        this.deps.log.warn({ err: String(err), chat: chatJid }, 'não consegui listar os admins do grupo');
        return [];
      }
    })();
    this.groupAdminCache.set(key, entry);
    return entry.phones;
  }

  /** O que o bot mandou nos últimos minutos, por grupo: a AvisaAPI devolve essas mensagens como "fromMe". */
  private readonly sentByBot = new Map<string, { text: string; at: number }[]>();

  private recordingSends(p: WhatsAppProvider): WhatsAppProvider {
    const remember = (chat: string, text: string) => {
      const now = Date.now();
      const list = (this.sentByBot.get(chat) ?? []).filter((e) => now - e.at < 10 * 60_000).slice(-50);
      list.push({ text: text.trim(), at: now });
      this.sentByBot.set(chat, list);
    };
    return new Proxy(p, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        if (prop === 'sendText' || prop === 'sendTextWithId' || prop === 'sendTextMentions') {
          return (chat: string, text: string, ...rest: unknown[]) => {
            remember(chat, text);
            return (value as (...a: unknown[]) => unknown).call(target, chat, text, ...rest);
          };
        }
        return value.bind(target);
      },
    });
  }

  /** Mensagem do próprio número do bot digitada por uma pessoa (comando), e não uma resposta do bot. */
  private typedOnBotNumber(msg: InboundMessage): boolean {
    if (msg.type !== 'text' && msg.type !== 'image') return false;
    const text = msg.text.trim();
    if (!/^[#!?/\\]/.test(text)) return false;
    return !(this.sentByBot.get(msg.chatJid) ?? []).some((e) => e.text === text);
  }

  async connectionExists(connectionId: string): Promise<boolean> {
    return (await this.load()).conns.has(connectionId);
  }

  async activeBots(): Promise<Bot[]> {
    return (await this.load()).bots.map(toBot);
  }

  context(bot: Bot): BotContext {
    const conn = this.cache?.conns.get(bot.connectionId);
    if (!conn) throw new Error(`Conexão ${bot.connectionId} não encontrada`);
    const wa = this.provider(conn);
    const sql = this.deps.sql;
    const log = this.deps.log;
    return {
      bot,
      sql,
      wa,
      ai: this.deps.ai,
      places: this.deps.places,
      contacts: new Contacts(sql, conn.id, wa),
      log,
      now: this.now,
      reply: (text) => wa.sendText(bot.chatJid, text),
      replyWithId: async (text) => {
        if (wa.sendTextWithId) return wa.sendTextWithId(bot.chatJid, text);
        await wa.sendText(bot.chatJid, text);
        return '';
      },
      timezone: typeof bot.settings.timezone === 'string' ? bot.settings.timezone : 'America/Sao_Paulo',
      mascot: async () => {
        const rows = await sql<{ name: string; persona: string }[]>`
          select name, persona from bot_mascots where bot_id = ${bot.id}`;
        return rows[0] ?? this.modules.get(bot.module)?.defaultMascot ?? DEFAULT_MASCOT;
      },
      nameOf: async (phone) => {
        const rows = await sql<{ push_name: string; phone: string }[]>`
          select push_name, phone from wa_people where connection_id = ${conn.id} and right(phone, 8) = ${last8(phone)}
          order by updated_at desc limit 1`;
        return rows[0]?.push_name ?? '';
      },
      isAdmin: async (phone) => {
        // o próprio número do bot e os donos (BOT_DONOS) são admins em todos os grupos
        if (conn.own_phone && samePhone(conn.own_phone, phone)) return true;
        if (ownerPhones(this.deps.env ?? process.env).some((o) => samePhone(o, phone))) return true;
        const admins = await sql<{ phone: string }[]>`select phone from bot_admins where bot_id = ${bot.id}`;
        if (admins.some((a) => samePhone(a.phone, phone))) return true;
        // admins do grupo no WhatsApp também são admins do bot
        return (await this.groupAdmins(conn.id, bot.chatJid, wa)).some((p) => samePhone(p, phone));
      },
    };
  }

  /**
   * Trata uma mensagem recebida. Responde rápido: o trabalho do módulo roda em
   * segundo plano, na fila do grupo. Devolve a promessa da tarefa (útil em testes).
   */
  async handle(connectionId: string, msg: InboundMessage, forward?: Forwarder): Promise<'handled' | 'forwarded' | 'ignored'> {
    const { bots, conns } = await this.load();
    const conn = conns.get(connectionId);
    if (!conn) return 'ignored';

    const contacts = new Contacts(this.deps.sql, conn.id, this.provider(conn));
    await contacts.learn(msg.senderLid, msg.senderPhone).catch(() => {});

    const row = bots.find((b) => b.connection_id === connectionId && b.chat_jid === msg.chatJid);
    // #ativarbot / #desativarbot do dono: vale em qualquer grupo, com ou sem bot cadastrado
    const ativacao = msg.type === 'text' ? parseAtivacao(normalizeCommand(msg.text.trim())) : null;
    if (ativacao) {
      const done = await this.ativacao(conn, contacts, row, msg, ativacao);
      if (done) return done;
    }
    if (msg.type === 'join') this.deps.log.info({ chat: msg.chatJid, joined: msg.joined?.length ?? 0, bot: row?.name ?? null }, 'entrada no grupo');
    if (!row) {
      const wanted = conn.forward_chats.length === 0 || conn.forward_chats.includes(msg.chatJid);
      if (conn.forward_url && forward && wanted) {
        forward(conn.forward_url).catch((err) => this.deps.log.warn({ err: String(err) }, 'falha ao repassar mensagem'));
        return 'forwarded';
      }
      // Para cadastrar um grupo novo: alguém manda #codigogrupo nele e o código aparece no log.
      if (msg.isGroup && /^#codigo ?grupo\b/.test(normalizeCommand(msg.text.trim()))) {
        this.deps.log.info({ chat: msg.chatJid, conexao: conn.id }, 'código do grupo');
      }
      return 'ignored';
    }
    const module = this.modules.get(row.module);
    if (!module) {
      this.deps.log.warn({ bot: row.id, module: row.module }, 'módulo desconhecido');
      return 'ignored';
    }
    if (msg.fromMe && msg.senderPhone && !conn.own_phone) {
      // número do próprio bot: nunca entra no aviso de sumidos
      conn.own_phone = digits(msg.senderPhone);
      await this.deps.sql`update wa_connections set own_phone = ${conn.own_phone} where id = ${conn.id}`;
    }
    if (msg.fromMe && msg.type !== 'join' && !module.acceptsFromMe?.(msg) && !this.typedOnBotNumber(msg)) return 'ignored';
    if (msg.fromMe && !msg.senderPhone && conn.own_phone) msg.senderPhone = conn.own_phone;

    const fresh = await this.deps.sql`
      insert into processed_messages (provider_msg_id, bot_id) values (${msg.id}, ${row.id})
      on conflict do nothing returning provider_msg_id`;
    if (fresh.length === 0) return 'ignored';

    const bot = toBot(row);
    void this.queue.run(msg.chatJid, async () => {
      try {
        if (!msg.senderPhone && msg.senderLid) msg.senderPhone = await contacts.phoneOf(msg.senderLid, msg.chatJid);
        if (msg.senderPhone && msg.pushName) {
          await this.deps.sql`
            insert into wa_people (connection_id, phone, push_name) values (${conn.id}, ${digits(msg.senderPhone)}, ${msg.pushName})
            on conflict (connection_id, phone) do update set push_name = excluded.push_name, updated_at = now()`;
        }
        await this.logMessage(bot.id, msg);
        msg.text = normalizeCommand(msg.text);
        const ctx = this.context(bot);
        for (const feature of this.deps.features ?? []) {
          if (module.features && !module.features.includes(feature.id)) continue;
          if (await feature.handle(ctx, msg)) return;
        }
        await module.handle(ctx, msg);
      } catch (err) {
        this.deps.log.error({ err: String(err), stack: (err as Error)?.stack, bot: bot.id, messageId: msg.id }, 'erro no módulo');
      }
    });
    return 'handled';
  }

  /** Liga/desliga o bot no grupo. Devolve null se quem mandou não é o dono (a mensagem segue o caminho normal). */
  private async ativacao(
    conn: ConnectionRow,
    contacts: Contacts,
    row: BotRow | undefined,
    msg: InboundMessage,
    cmd: AtivacaoCommand,
  ): Promise<'handled' | 'ignored' | null> {
    let phone = msg.senderPhone;
    if (!phone && msg.senderLid) phone = await contacts.phoneOf(msg.senderLid, msg.chatJid).catch(() => '');
    if (!isOwner(msg, phone, this.deps.env ?? process.env)) return null;
    if (msg.fromMe && phone && !conn.own_phone) {
      conn.own_phone = digits(phone);
      await this.deps.sql`update wa_connections set own_phone = ${conn.own_phone} where id = ${conn.id}`;
    }
    const fresh = await this.deps.sql`
      insert into processed_messages (provider_msg_id, bot_id) values (${msg.id}, ${row?.id ?? null})
      on conflict do nothing returning provider_msg_id`;
    if (fresh.length === 0) return 'ignored';
    const wa = this.provider(conn);
    void this.queue.run(msg.chatJid, async () => {
      try {
        const deps = { sql: this.deps.sql, wa, log: this.deps.log, connectionId: conn.id, connectionLabel: conn.label, senderPhone: phone, senderName: msg.pushName };
        if (await runAtivacao(deps, msg, cmd)) this.invalidate();
      } catch (err) {
        this.deps.log.error({ err: String(err), stack: (err as Error)?.stack, chat: msg.chatJid }, 'erro no #ativarbot');
      }
    });
    return 'handled';
  }

  /** Guarda o texto da mensagem para o #resumo (sem mídia e sem coordenadas). */
  private async logMessage(botId: string, msg: InboundMessage): Promise<void> {
    const body =
      msg.type === 'image' ? `[foto]${msg.text ? ` ${msg.text}` : ''}` : msg.type === 'location' ? '[localização]' : msg.text;
    if (!body) return;
    const name = msg.pushName || null;
    await this.deps.sql`
      insert into group_messages (bot_id, msg_id, sent_at, sender_phone, sender_name, text)
      values (${botId}, ${msg.id}, ${msg.timestamp}, ${msg.senderPhone || null}, ${name}, ${body.slice(0, 2000)})
      on conflict do nothing`;
  }

  /** Espera a fila esvaziar (testes e desligamento). */
  idle(): Promise<void> {
    return this.queue.idle();
  }
}

function toBot(r: BotRow): Bot {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    connectionId: r.connection_id,
    name: r.name,
    module: r.module,
    chatJid: r.chat_jid,
    settings: r.settings ?? {},
  };
}
