import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/db.js';
import { Runtime } from '../src/core/runtime.js';
import { parseWhatsmeowEvent } from '../src/core/whatsapp/whatsmeow.js';
import { features } from '../src/features/index.js';
import { createTecnico, parseTecnico } from '../src/modules/tecnico/index.js';
import type { Ficha, KnowledgeBase, ChatModel } from '../src/modules/tecnico/clients.js';
import { splitSources, shortName } from '../src/modules/tecnico/prompt.js';
import { Claude } from '../src/modules/tecnico/clients.js';
import { carregar, parseCarga } from '../src/modules/tecnico/carga.js';
import { FakeAi, FakePlaces, FakeWhatsApp, event, freshDb, type EventInput } from './helpers.js';

const TEC = '120363413362471875@g.us';

class IdWhatsApp extends FakeWhatsApp {
  n = 0;
  async sendTextWithId(chat: string, text: string) {
    await this.sendText(chat, text);
    return `BOT${++this.n}`;
  }
}

class FakeKb implements KnowledgeBase {
  fichas: Ficha[] = [];
  inserted: { content: string; metadata: Record<string, unknown> }[] = [];
  queries: string[] = [];
  async search(q: string) {
    this.queries.push(q);
    return this.fichas;
  }
  async insert(content: string, metadata: Record<string, unknown>) {
    this.inserted.push({ content, metadata });
  }
}

class FakeLlm implements ChatModel {
  reply = 'Confira a pressão do degas.\nFONTES: H00001';
  users: string[] = [];
  images: number[] = [];
  async answer(_s: string, user: string, images: { data: Buffer }[] = []) {
    this.users.push(user);
    this.images.push(images.length);
    return this.reply;
  }
}

describe('parseTecnico', () => {
  it('lê /duvida, /dúvida e os comandos de revisão', () => {
    expect(parseTecnico('/dúvida 4008S F04')).toEqual({ type: 'duvida', question: '4008S F04' });
    expect(parseTecnico('\\duvida: tela branca')).toEqual({ type: 'duvida', question: 'tela branca' });
    expect(parseTecnico('/duvida')).toEqual({ type: 'duvida', question: '' });
    expect(parseTecnico('/duvidas')).toBeNull();
    expect(parseTecnico('/corrigir a causa era a V84')).toEqual({ type: 'review', cmd: 'corrigir', text: 'a causa era a V84' });
    expect(parseTecnico('/acresentar mais isso')?.type).toBe('review');
    expect(parseTecnico('bom dia')).toBeNull();
  });
  it('separa as fontes e encurta nomes', () => {
    expect(splitSources('Texto\n\nFONTES: C00003, H02414')).toEqual({ body: 'Texto', sources: ['C00003', 'H02414'] });
    expect(splitSources('Texto\nFONTES: nenhuma').sources).toEqual([]);
    expect(shortName('Rafael Zeni da Silva')).toBe('Rafael Zeni');
    expect(shortName('Felipe de Souza Gonçalves')).toBe('Felipe Souza');
  });
});

describe('carga da base', () => {
  it('lê lista, objeto com itens e JSONL, e aponta fichas sem id ou texto', () => {
    const a = parseCarga(JSON.stringify([{ content: 'F07 Airdetector', metadata: { id: 'm00001', tipo: 'manual', pagina: 12 } }, { content: 'x' }]));
    expect(a.fichas).toEqual([{ content: 'F07 Airdetector', metadata: { id: 'M00001', tipo: 'manual', pagina: 12 } }]);
    expect(a.erros).toHaveLength(1);
    const b = parseCarga('{"itens":[{"pageContent":"caso","id":"H1","tipo":"ficha"}]}');
    expect(b.fichas[0]).toEqual({ content: 'caso', metadata: { id: 'H1', tipo: 'ficha' } });
    expect(parseCarga('{"texto":"a","id":"H2"}\n{"texto":"b","id":"H3"}').fichas).toHaveLength(2);
  });

  it('grava em lotes, pula o que já existe e tenta de novo quando falha', async () => {
    const saved: string[][] = [];
    let falhas = 1;
    const kb = {
      existingIds: async (ids: string[]) => new Set(ids.filter((id) => id === 'M2')),
      insertMany: async (items: { metadata: Record<string, unknown> }[]) => {
        if (falhas-- > 0) throw new Error('429');
        saved.push(items.map((i) => String(i.metadata.id)));
      },
    };
    const fichas = ['M1', 'M2', 'M3'].map((id) => ({ content: id, metadata: { id } }));
    const r = await carregar(kb as any, fichas, { lote: 2, esperaMs: 0 });
    expect(r).toEqual({ gravadas: 2, puladas: 1 });
    expect(saved).toEqual([['M1'], ['M3']]);
  });

  it('manda a foto para o Claude junto com o texto', async () => {
    let body: any;
    const fake = (async (_u: string, init: any) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }));
    }) as unknown as typeof fetch;
    const c = new Claude('k', 'modelo', fake);
    await c.answer('sys', 'pergunta', [{ data: Buffer.from('abc'), mime: 'image/jpeg' }]);
    expect(body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'YWJj' } });
    expect(body.messages[0].content[1]).toEqual({ type: 'text', text: 'pergunta' });
    await c.answer('sys', 'só texto');
    expect(body.messages[0].content).toBe('só texto');
  });
});

describe('bot técnico', () => {
  let sql: Sql;
  let wa: IdWhatsApp;
  let kb: FakeKb;
  let llm: FakeLlm;
  let runtime: Runtime;
  let conn: string;
  const now = { value: new Date('2026-11-09T12:00:00Z') };
  const infos: Record<string, unknown>[] = [];

  async function send(e: EventInput & { fromMe?: boolean }) {
    const ev = event({ chat: TEC, ...e });
    if (e.fromMe) ev.event.Info.IsFromMe = true;
    const r = await runtime.handle(conn, parseWhatsmeowEvent(ev)!, async () => {});
    await runtime.idle();
    return r;
  }

  beforeEach(async () => {
    sql = await freshDb();
    wa = new IdWhatsApp();
    kb = new FakeKb();
    llm = new FakeLlm();
    const [t] = await sql`insert into tenants (name) values ('GSS') returning id`;
    const [c] = await sql`insert into wa_connections (label, token_env) values ('Número', 'AVISA_TOKEN_TESTE') returning id`;
    const [b] = await sql`insert into bots (tenant_id, connection_id, name, module, chat_jid)
      values (${t!.id}, ${c!.id}, 'Dúvidas técnicas', 'tecnico', ${TEC}) returning id`;
    await sql`insert into bot_admins (bot_id, phone, name) values (${b!.id}, '5511944444444', 'Rafael Zeni da Silva')`;
    conn = c!.id;
    runtime = new Runtime({
      sql,
      modules: [createTecnico({ kb, llm })],
      features,
      ai: new FakeAi(),
      places: new FakePlaces(),
      log: { info: (o, m) => infos.push({ ...(o as object), msg: m }), warn() {}, error: (o) => console.error(o) },
      now: () => now.value,
      providerFor: () => wa,
    });
  });
  afterAll(async () => {
    await sql?.end();
  });

  it('responde /duvida, registra o card e aceita a revisão do sênior', async () => {
    kb.fichas = [{ content: 'Degas baixo', metadata: { id: 'H00001', tipo: 'historico', situacao: 'parcial' }, score: 0.8 }];
    await send({ phone: '5511933333333', name: 'Emerson', at: now.value.toISOString(), text: '/duvida 4008S V39' });
    expect(wa.last()).toContain('⚠️ _Resposta não revisada._');
    expect(wa.last()).toContain('*Dúvida de Emerson:* 4008S V39');
    expect(wa.last()).toContain('Confira a pressão do degas.');
    expect(wa.last()).not.toContain('FONTES');
    expect(llm.users[0]).toContain('[H00001]');
    const [card] = await sql`select * from tecnico_cards`;
    expect(card).toMatchObject({ bot_msg_id: 'BOT1', sources: 'H00001', status: 'nao_revisada' });

    // técnico comum não revisa
    await send({ phone: '5511933333333', at: now.value.toISOString(), text: '/correto', quoted: { id: 'BOT1', participant: 'x@lid' } });
    expect(wa.last()).toContain('Só sêniores');

    await send({ phone: '5511944444444', at: now.value.toISOString(), text: '/corrigir era a V84', quoted: { id: 'BOT1', participant: 'x@lid' } });
    expect(wa.last()).toContain('*Correção registrada* por Rafael Zeni em 09/11/2026');
    expect(kb.inserted[0]!.content).toContain('Confira a pressão do degas.');
    expect(kb.inserted[0]!.content).toContain('CORREÇÃO DO SÊNIOR');
    expect(kb.inserted[0]!.metadata).toMatchObject({ id: `C${String(card!.id).padStart(5, '0')}`, tipo: 'card_revisado', situacao: 'confirmada' });
    const [after] = await sql`select status, correction, reviewed_at from tecnico_cards`;
    expect(after).toMatchObject({ status: 'corrigida', correction: 'era a V84' });

    // a ficha C nova vale (mesmo momento da revisão) e aparece no cabeçalho quando usada
    kb.fichas = [{ content: 'Correção', metadata: { ...kb.inserted[0]!.metadata } }];
    llm.reply = 'Troque a V84.\nFONTES: ' + kb.inserted[0]!.metadata.id;
    await send({ phone: '5511933333333', name: 'Emerson', at: now.value.toISOString(), text: '/duvida V39 de novo' });
    expect(wa.last()).toContain('✅ _Baseada em resposta revisada por Rafael Zeni em 09/11/2026._');

    // excluir manda para a lixeira; aí a ficha "confirmada" deixa de valer
    await send({ phone: '5511944444444', at: now.value.toISOString(), text: '/excluir', quoted: { id: 'BOT1', participant: 'x@lid' } });
    expect(wa.last()).toContain('Resposta tirada de uso');
    llm.users = [];
    await send({ phone: '5511933333333', at: now.value.toISOString(), text: '/duvida V39 outra vez' });
    expect(llm.users[0]).toContain('(nenhuma)');

    await send({ phone: '5511944444444', at: now.value.toISOString(), text: '/restaurar', quoted: { id: 'BOT1', participant: 'x@lid' } });
    expect(wa.last()).toContain('Resposta restaurada');
    expect((await sql`select status from tecnico_cards where bot_msg_id = 'BOT1'`)[0]!.status).toBe('corrigida');
  });

  it('responde /duvida na legenda da foto e avisa quando a foto não chegou', async () => {
    await send({ phone: '5511933333333', name: 'Emerson', at: now.value.toISOString(), image: { sha: 'abc', caption: '/duvida que erro é esse?' } });
    expect(wa.last()).toContain('*Dúvida de Emerson:* que erro é esse?');
    expect(llm.users[0]).toContain('não chegou ao sistema'.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    expect(llm.images[0]).toBe(0);

    const ev = event({ chat: TEC, phone: '5511933333333', at: now.value.toISOString(), image: { sha: 'def', caption: '/duvida e agora?' } });
    await runtime.handle(conn, parseWhatsmeowEvent(ev, { data: Buffer.from('foto'), mime: 'image/jpeg' })!, async () => {});
    await runtime.idle();
    expect(llm.images[1]).toBe(1);
    expect(llm.users[1]).toContain('foto anexa');
  });

  it('anota no log o código de um grupo sem bot quando pedem #codigogrupo', async () => {
    const other = '120363999999999999@g.us';
    expect(await runtime.handle(conn, parseWhatsmeowEvent(event({ chat: other, phone: '5511933333333', at: now.value.toISOString(), text: 'oi' }))!)).toBe('ignored');
    await runtime.handle(conn, parseWhatsmeowEvent(event({ chat: other, phone: '5511933333333', at: now.value.toISOString(), text: '#códigogrupo' }))!);
    expect(infos.filter((i) => i.msg === 'código do grupo')).toEqual([expect.objectContaining({ chat: other })]);
  });

  it('aceita /duvida do próprio número do bot, ignora o resto e não usa o mascote', async () => {
    expect(await send({ phone: '5511900000000', at: now.value.toISOString(), text: 'oi', fromMe: true })).toBe('ignored');
    await send({ phone: '5511900000000', at: now.value.toISOString(), text: '/duvida tela branca', fromMe: true });
    expect(wa.sent).toHaveLength(1);
    await send({ phone: '5511933333333', at: now.value.toISOString(), text: '#mascote' });
    expect(wa.sent).toHaveLength(1);
    await send({ phone: '5511933333333', at: now.value.toISOString(), text: '#agenda' });
    expect(wa.last()).toContain('agenda');
  });
});
