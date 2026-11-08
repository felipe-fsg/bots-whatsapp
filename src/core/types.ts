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
  type: 'text' | 'image' | 'location' | 'other';
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
  };
  /** JIDs marcados com @ (podem ser @lid). */
  mentions: string[];
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
}

export interface WhatsAppProvider extends WhatsAppSender {
  listGroupMembers(chatJid: string): Promise<GroupMember[]>;
}

export interface ImageInput {
  data: Buffer;
  mime: string;
}

export interface AiClient {
  /** Gera texto. `search` liga a pesquisa no Google (quando o modelo aceita). */
  text(prompt: string, opts?: { system?: string; temperature?: number; search?: boolean }): Promise<string>;
  /** Analisa uma ou mais imagens com um pedido em texto. */
  vision(prompt: string, images: ImageInput[]): Promise<string>;
}

export interface NearbyPlace {
  name: string;
  lat: number;
  lng: number;
}

export interface PlacesClient {
  nearby(lat: number, lng: number, radiusM: number, types: string[]): Promise<NearbyPlace[]>;
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
  isAdmin(phone: string): Promise<boolean>;
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

export interface BotModule {
  id: string;
  handle(ctx: BotContext, msg: InboundMessage): Promise<void>;
  jobs?: ScheduledJob[];
}
