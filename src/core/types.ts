import type { Sql } from '../db.js';

/** Mensagem recebida, já sem os detalhes do provedor (AvisaAPI, Evolution...). */
export interface InboundMessage {
  id: string;
  chatJid: string;
  isGroup: boolean;
  fromMe: boolean;
  /** Telefone de quem mandou, só dígitos com DDI. Vazio se o provedor só mandou o LID. */
  senderPhone: string;
  senderLid?: string;
  pushName: string;
  timestamp: Date;
  /** 'join': gente nova entrou no grupo (lista em `joined`). */
  type: 'text' | 'image' | 'location' | 'join' | 'other';
  /** Texto da mensagem ou legenda da foto. */
  text: string;
  image?: {
    sha256: string;
    mime: string;
    /** Bytes da foto, quando o provedor manda junto no webhook. */
    data?: Buffer;
  };
  location?: { lat: number; lng: number };
  /** Resposta (reply) a outra mensagem. */
  quoted?: {
    messageId: string;
    /** JID de quem escreveu a mensagem citada (pode ser @lid). */
    participant: string;
    text: string;
    /** Quando a mensagem citada é uma localização. */
    location?: { lat: number; lng: number };
    /** Quando a mensagem citada é uma foto. */
    image?: { sha256: string };
  };
  /** Legenda de foto editada: ID da mensagem original. */
  editOf?: string;
  /** JIDs marcados com @ (podem ser @lid). */
  mentions: string[];
  /** Quem entrou no grupo (JIDs, podem ser @lid), quando type = 'join'. */
  joined?: string[];
}

export interface Bot {
  id: string;
  tenantId: string;
  connectionId: string;
  name: string;
  module: string;
  chatJid: string;
  settings: Record<string, unknown>;
}

export interface WhatsAppSender {
  sendText(chatJid: string, text: string): Promise<void>;
}

export interface GroupMember {
  jid: string;
  lid?: string;
  phone: string;
  /** Admin do grupo no WhatsApp (não confundir com admin do bot). */
  admin?: boolean;
}

export interface WhatsAppProvider extends WhatsAppSender {
  listGroupMembers(chatJid: string): Promise<GroupMember[]>;
  /** Manda texto e devolve o id da mensagem enviada (vazio se o provedor não informar). */
  sendTextWithId?(chatJid: string, text: string): Promise<string>;
  /** Manda texto marcando pessoas (@). Sem isso, o @telefone vai como texto comum. */
  sendTextMentions?(chatJid: string, text: string, jids: string[]): Promise<void>;
  /** Tira alguém do grupo (o número do bot precisa ser admin do grupo). */
  removeParticipant?(chatJid: string, jid: string): Promise<void>;
  /** Liga (true) ou desliga o "só admins mandam mensagens" do grupo. O número do bot precisa ser admin. */
  setAdminsOnly?(chatJid: string, on: boolean): Promise<void>;
}

export interface ImageInput {
  data: Buffer;
  mime: string;
}

export interface AiClient {
  /** Gera texto. `search` liga a pesquisa no Google; `json` pede a resposta em JSON. */
  text(prompt: string, opts?: { system?: string; temperature?: number; search?: boolean; json?: boolean }): Promise<string>;
  /** Analisa uma ou mais imagens com um pedido em texto. */
  vision(prompt: string, images: ImageInput[]): Promise<string>;
  /** Responde pesquisando no Google e devolve também as páginas usadas. */
  research(prompt: string, opts?: { system?: string }): Promise<WebAnswer>;
}

export interface WebSource {
  title: string;
  url: string;
}

export interface WebAnswer {
  text: string;
  sources: WebSource[];
}

export interface NearbyPlace {
  name: string;
  lat: number;
  lng: number;
}

export interface PlaceResult {
  name: string;
  address: string;
  rating?: number;
  ratings?: number;
  mapsUrl?: string;
}

export interface PlacesClient {
  nearby(lat: number, lng: number, radiusM: number, types: string[]): Promise<NearbyPlace[]>;
  /** Busca lugares por texto ("restaurantes de sushi na Liberdade"). */
  search(query: string, max?: number): Promise<PlaceResult[]>;
}

export interface Logger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}

/** Tudo que um módulo recebe para trabalhar. */
export interface BotContext {
  bot: Bot;
  sql: Sql;
  wa: WhatsAppProvider;
  ai: AiClient;
  places: PlacesClient;
  contacts: ContactResolver;
  log: Logger;
  now(): Date;
  /** Manda texto no grupo do bot. */
  reply(text: string): Promise<void>;
  /** Manda texto no grupo e devolve o id da mensagem (para achar respostas a ela depois). */
  replyWithId(text: string): Promise<string>;
  isAdmin(phone: string): Promise<boolean>;
  /** Fuso horário do grupo (bots.settings.timezone, padrão America/Sao_Paulo). */
  timezone: string;
  /** Nome que a pessoa usa no WhatsApp, aprendido das mensagens. */
  nameOf(phone: string): Promise<string>;
  /** Mascote atual do grupo (o escolhido com #mascote ou o padrão do módulo). */
  mascot(): Promise<Mascot>;
}

export interface ContactResolver {
  /** Converte um JID (@s.whatsapp.net ou @lid) em telefone. Vazio se não achar. */
  phoneOf(jid: string, chatJid: string): Promise<string>;
}

export interface ScheduledJob {
  name: string;
  /** Expressão cron, no fuso do bot (padrão America/Sao_Paulo). */
  cron: string;
  run(ctx: BotContext): Promise<void>;
}

export interface Mascot {
  name: string;
  /** Instruções de personalidade para a IA (vai como system prompt). */
  persona: string;
}

export interface BotModule {
  id: string;
  /** Personagem padrão dos bots deste módulo, até alguém trocar com #mascote. */
  defaultMascot?: Mascot;
  /**
   * Trata a mensagem. Funções do núcleo (como a agenda) devolvem true quando a
   * mensagem era delas, e aí o módulo do bot não é chamado.
   */
  handle(ctx: BotContext, msg: InboundMessage): Promise<void | boolean>;
  jobs?: ScheduledJob[];
  /** Funções do núcleo que este módulo usa (ids). Sem a lista, usa todas. */
  features?: string[];
  /**
   * Mensagens do próprio número do bot são ignoradas, a não ser que o módulo
   * aceite (ex.: quem usa o número do bot no celular e manda /duvida).
   */
  acceptsFromMe?(msg: InboundMessage): boolean;
}
