import type { InboundMessage } from '../types.js';
import { digits } from '../phone.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

/** Tira as "cascas" que o WhatsApp põe em volta da mensagem (temporária, visualização única...). */
function unwrap(message: Json): Json {
  let m = message ?? {};
  for (let i = 0; i < 4; i++) {
    const inner =
      m.ephemeralMessage?.message ??
      m.viewOnceMessage?.message ??
      m.viewOnceMessageV2?.message ??
      m.viewOnceMessageV2Extension?.message ??
      m.documentWithCaptionMessage?.message ??
      m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

function quotedText(q: Json): string {
  if (!q) return '';
  const m = unwrap(q);
  return String(m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? '').trim();
}

/**
 * Converte o evento de mensagem do whatsmeow (formato que a AvisaAPI manda em
 * body.jsonData) para InboundMessage. Devolve null se não for mensagem.
 */
export function parseWhatsmeowEvent(raw: Json, image?: { data: Buffer; mime: string }): InboundMessage | null {
  const ev = raw?.event ?? raw;
  const join = parseGroupJoin(ev);
  if (join) return join;
  const info = ev?.Info;
  if (!info?.ID || !info?.Chat) return null;

  let m = unwrap(ev.Message);
  // Legenda editada depois do envio: vem como protocolMessage com a mensagem nova e o ID da original.
  const proto = m.protocolMessage ?? unwrap(ev.RawMessage).protocolMessage;
  const edited = proto?.editedMessage ? unwrap(proto.editedMessage) : null;
  const editOf = edited ? String(proto.key?.ID ?? proto.key?.id ?? '') : '';
  if (edited && m.protocolMessage) m = edited;
  // Quem adiciona alguém e compartilha o histórico manda este aviso com o LID de quem entrou.
  const receivers = m.messageHistoryNotice?.messageHistoryMetadata?.historyReceivers;
  if (Array.isArray(receivers) && receivers.length && String(info.Chat).endsWith('@g.us')) {
    return {
      // O mesmo ID vem antes em outra mensagem técnica; o prefixo evita que esta seja tida como repetida.
      id: `join:${info.ID}`,
      chatJid: String(info.Chat),
      isGroup: true,
      fromMe: info.IsFromMe === true,
      senderPhone: '',
      pushName: '',
      timestamp: validDate(info.Timestamp),
      type: 'join',
      text: '',
      mentions: [],
      joined: receivers.map(String),
    };
  }
  const img = m.imageMessage;
  const loc = m.locationMessage ?? m.liveLocationMessage;
  const ext = m.extendedTextMessage;
  const ctx = ext?.contextInfo ?? img?.contextInfo ?? loc?.contextInfo ?? {};

  const sender = String(info.Sender ?? '');
  const senderAlt = String(info.SenderAlt ?? '');
  const phoneJid = [senderAlt, sender].find((j) => j.endsWith('@s.whatsapp.net')) ?? '';
  const lid = [sender, senderAlt].find((j) => j.endsWith('@lid'));

  let type: InboundMessage['type'] = img ? 'image' : loc ? 'location' : m.conversation || ext ? 'text' : 'other';
  // Só a edição de legenda de foto interessa (check-in); texto editado não roda comando de novo.
  if (editOf && type !== 'image') type = 'other';

  const msg: InboundMessage = {
    id: String(info.ID),
    chatJid: String(info.Chat),
    isGroup: info.IsGroup === true || String(info.Chat).endsWith('@g.us'),
    fromMe: info.IsFromMe === true,
    senderPhone: digits(phoneJid),
    pushName: String(info.PushName ?? ''),
    timestamp: validDate(info.Timestamp),
    type,
    text: String(img?.caption ?? m.conversation ?? ext?.text ?? '').trim(),
    mentions: [...new Set<string>((ctx.mentionedJID ?? []).map(String))],
  };
  if (lid) msg.senderLid = lid;
  if (editOf && type === 'image') {
    msg.editOf = editOf;
    msg.id = `edit:${msg.id}`; // não confunde com a foto original na checagem de repetidas
  }
  if (img) {
    msg.image = { sha256: String(img.fileSHA256 ?? ''), mime: String(img.mimetype ?? image?.mime ?? 'image/jpeg') };
    if (image?.data) msg.image.data = image.data;
  }
  if (loc && typeof loc.degreesLatitude === 'number' && typeof loc.degreesLongitude === 'number') {
    msg.location = { lat: loc.degreesLatitude, lng: loc.degreesLongitude };
  }
  if (ctx.stanzaID) {
    msg.quoted = {
      messageId: String(ctx.stanzaID),
      participant: String(ctx.participant ?? ''),
      text: quotedText(ctx.quotedMessage),
    };
    const qm = ctx.quotedMessage ? unwrap(ctx.quotedMessage) : {};
    if (qm.imageMessage) msg.quoted.image = { sha256: String(qm.imageMessage.fileSHA256 ?? '') };
    const ql = qm.locationMessage;
    if (typeof ql?.degreesLatitude === 'number' && typeof ql?.degreesLongitude === 'number') {
      msg.quoted.location = { lat: ql.degreesLatitude, lng: ql.degreesLongitude };
    }
  }
  return msg;
}

/**
 * Evento GroupInfo do whatsmeow com gente entrando no grupo:
 * { JID: '...@g.us', Sender, SenderPN, Timestamp, Join: ['...@lid'], JoinReason }.
 */
function parseGroupJoin(ev: Json): InboundMessage | null {
  const jid = (j: Json) => (j && typeof j === 'object' && j.User ? `${j.User}@${j.Server}` : String(j ?? ''));
  const joined: string[] = (Array.isArray(ev?.Join) ? ev.Join : []).map(jid).filter(Boolean);
  const chat = String(ev?.JID ?? ev?.Chat ?? '');
  if (!joined.length || !chat.endsWith('@g.us')) return null;
  const at = validDate(ev.Timestamp);
  const by = [ev.SenderPN, ev.Sender].map((j) => String(j ?? '')).find((j) => j.endsWith('@s.whatsapp.net')) ?? '';
  return {
    id: `join:${chat}:${at.getTime()}:${joined.join(',')}`.slice(0, 250),
    chatJid: chat,
    isGroup: true,
    fromMe: false,
    senderPhone: digits(by),
    pushName: String(ev.Notify ?? ''),
    timestamp: at,
    type: 'join',
    text: '',
    mentions: [],
    joined,
  };
}

function validDate(v: unknown): Date {
  const d = new Date(String(v ?? ''));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
