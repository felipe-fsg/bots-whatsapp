import { connect, type Sql } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { Runtime } from '../src/core/runtime.js';
import type { AiClient, GroupMember, NearbyPlace, PlaceResult, PlacesClient, WebAnswer, WhatsAppProvider } from '../src/core/types.js';
import { parseWhatsmeowEvent } from '../src/core/whatsapp/whatsmeow.js';
import { modules } from '../src/modules/index.js';
import { features } from '../src/features/index.js';

export const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5433/bots_test';
export const GROUP = '120363423993886664@g.us';

export async function freshDb(): Promise<Sql> {
  const sql = connect(DB_URL);
  await sql.unsafe('drop schema public cascade; create schema public;');
  await migrate(sql, () => {});
  return sql;
}

export class FakeWhatsApp implements WhatsAppProvider {
  sent: { chat: string; text: string }[] = [];
  members: GroupMember[] = [];
  async sendText(chat: string, text: string) {
    this.sent.push({ chat, text });
  }
  async listGroupMembers() {
    return this.members;
  }
  last(): string {
    return this.sent.at(-1)?.text ?? '';
  }
  clear() {
    this.sent = [];
  }
}

export class FakeAi implements AiClient {
  visionAnswer = 'VEREDITO: SAUDAVEL\nMOTIVO: arroz, feijão e salada.';
  textAnswer = 'Muito bem, meus alunos! 🐀';
  prompts: string[] = [];
  async text(prompt: string) {
    this.prompts.push(prompt);
    return this.textAnswer;
  }
  async vision(prompt: string) {
    this.prompts.push(prompt);
    return this.visionAnswer;
  }
  researchAnswer: WebAnswer | Error = { text: 'Resposta da pesquisa.', sources: [] };
  async research(prompt: string) {
    this.prompts.push(prompt);
    if (this.researchAnswer instanceof Error) throw this.researchAnswer;
    return this.researchAnswer;
  }
}

export class FakePlaces implements PlacesClient {
  places: NearbyPlace[] = [];
  async nearby() {
    return this.places;
  }
  found: PlaceResult[] = [];
  searches: string[] = [];
  async search(query: string) {
    this.searches.push(query);
    return this.found;
  }
}

export interface World {
  sql: Sql;
  runtime: Runtime;
  wa: FakeWhatsApp;
  ai: FakeAi;
  places: FakePlaces;
  connectionId: string;
  botId: string;
  challengeId: string;
  now: { value: Date };
  /** Manda um evento como se viesse da AvisaAPI e espera o módulo terminar. */
  send(e: EventInput): Promise<string>;
}

export interface EventInput {
  id?: string;
  chat?: string;
  phone: string;
  lid?: string;
  name?: string;
  at: string; // ISO
  text?: string;
  image?: { sha: string; caption?: string };
  location?: { lat: number; lng: number };
  quoted?: { id: string; participant: string; text?: string; location?: { lat: number; lng: number } };
  mentions?: string[];
}

let seq = 0;
export function event(e: EventInput) {
  const ctx = e.quoted || e.mentions
    ? {
        contextInfo: {
          ...(e.quoted
            ? {
                stanzaID: e.quoted.id,
                participant: e.quoted.participant,
                quotedMessage: e.quoted.location
                  ? { locationMessage: { degreesLatitude: e.quoted.location.lat, degreesLongitude: e.quoted.location.lng } }
                  : { conversation: e.quoted.text ?? '' },
              }
            : {}),
          ...(e.mentions ? { mentionedJID: e.mentions } : {}),
        },
      }
    : {};
  const Message = e.image
    ? { imageMessage: { caption: e.image.caption ?? '', fileSHA256: e.image.sha, mimetype: 'image/jpeg', ...ctx } }
    : e.location
      ? { locationMessage: { degreesLatitude: e.location.lat, degreesLongitude: e.location.lng } }
      : { extendedTextMessage: { text: e.text ?? '', ...ctx } };
  return {
    event: {
      Info: {
        ID: e.id ?? `MSG${++seq}`,
        Chat: e.chat ?? GROUP,
        IsGroup: true,
        IsFromMe: false,
        Sender: e.lid ?? `${e.phone}@s.whatsapp.net`,
        SenderAlt: `${e.phone}@s.whatsapp.net`,
        PushName: e.name ?? 'Fulano',
        Timestamp: e.at,
      },
      Message,
    },
  };
}

export async function world(opts: { challenge?: Record<string, unknown> } = {}): Promise<World> {
  const sql = await freshDb();
  const wa = new FakeWhatsApp();
  const ai = new FakeAi();
  const places = new FakePlaces();
  const now = { value: new Date('2026-11-09T12:00:00Z') };

  const [tenant] = await sql`insert into tenants (name) values ('Felipe') returning id`;
  const [conn] = await sql`insert into wa_connections (label, token_env) values ('Número do Felipe', 'AVISA_TOKEN_TESTE') returning id`;
  const [bot] = await sql`insert into bots (tenant_id, connection_id, name, module, chat_jid)
    values (${tenant!.id}, ${conn!.id}, 'Mestre Splinter', 'splinter', ${GROUP}) returning id`;
  await sql`insert into bot_admins (bot_id, phone, name) values (${bot!.id}, '5511900000001', 'Felipe')`;
  const ch = { name: 'Desafio de Novembro', starts_on: '2026-11-09', ends_on: '2026-11-30', status: 'ativo', ...opts.challenge };
  const [challenge] = await sql`insert into splinter_challenges ${sql({ bot_id: bot!.id, ...ch } as Record<string, unknown>)} returning id`;
  const cid = challenge!.id;
  await sql`insert into splinter_rules (challenge_id, category, hashtag, kind, points) values
    (${cid}, 'Treino', '#treino', 'treino', 1),
    (${cid}, 'Alimentação', '#comida', 'comida', 1),
    (${cid}, 'Hidratação', '#agua', 'outro', 1),
    (${cid}, 'Pose do dia', '#pose', 'pose', 1),
    (${cid}, 'Cardio', '#cardio', 'outro', 1)`;
  await sql`insert into splinter_participants (challenge_id, phone, name, ranking_name) values
    (${cid}, '5511911111111', 'Ana Souza', 'Ana'),
    (${cid}, '5511922222222', 'Bruno Lima', 'Bruno'),
    (${cid}, '5511900000001', 'Felipe', 'Felipe')`;

  const runtime = new Runtime({
    sql,
    modules,
    features,
    ai,
    places,
    log: { info() {}, warn() {}, error: (o) => console.error(o) },
    now: () => now.value,
    providerFor: () => wa,
  });

  return {
    sql,
    runtime,
    wa,
    ai,
    places,
    now,
    connectionId: conn!.id,
    botId: bot!.id,
    challengeId: cid,
    async send(e) {
      const msg = parseWhatsmeowEvent(event(e), e.image ? { data: Buffer.from('foto'), mime: 'image/jpeg' } : undefined)!;
      const r = await runtime.handle(conn!.id, msg, async () => {});
      await runtime.idle();
      return r;
    },
  };
}
