/** Serviços externos do bot técnico: base vetorial (Qdrant), embeddings (Gemini) e Claude. */
import { randomUUID } from 'node:crypto';

/** Ficha encontrada na base, no formato que o n8n gravava ({ content, metadata }). */
export interface Ficha {
  content: string;
  metadata: Record<string, unknown>;
  score?: number;
}

export interface KnowledgeBase {
  search(query: string, limit: number): Promise<Ficha[]>;
  insert(content: string, metadata: Record<string, unknown>): Promise<void>;
}

export interface ImagePart {
  data: Buffer;
  mime: string;
}

export interface ChatModel {
  /** Uma pergunta (com fotos opcionais), uma resposta (texto). */
  answer(system: string, user: string, images?: ImagePart[]): Promise<string>;
}

export interface TecnicoDeps {
  kb: KnowledgeBase;
  llm: ChatModel;
}

type Fetch = typeof fetch;

async function json(res: Response, what: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what} respondeu ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/** Embeddings do Gemini (o mesmo modelo usado para gravar as fichas no n8n). */
export class GeminiEmbeddings {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly model = 'gemini-embedding-2',
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY não configurada');
    const res = await this.fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = await json(res, 'Gemini (embedding)');
    const values = j.embedding?.values;
    if (!Array.isArray(values)) throw new Error('Gemini não devolveu o embedding');
    return values;
  }

  /** Vários textos numa chamada só (o Gemini aceita até 100; usamos lotes menores). */
  async embedMany(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY não configurada');
    const model = `models/${this.model}`;
    const res = await this.fetchFn(`https://generativelanguage.googleapis.com/v1beta/${model}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({ requests: texts.map((text) => ({ model, content: { parts: [{ text }] } })) }),
      signal: AbortSignal.timeout(120_000),
    });
    const j = await json(res, 'Gemini (embedding em lote)');
    const out = (j.embeddings ?? []).map((e: any) => e?.values);
    // Vetor vazio = cota do Gemini esgotada (já aconteceu na carga pelo n8n). Melhor parar do que gravar lixo.
    if (out.length !== texts.length || out.some((v: unknown) => !Array.isArray(v) || v.length === 0)) {
      throw new Error('Gemini devolveu embeddings vazios ou incompletos (cota esgotada?)');
    }
    return out;
  }
}

/** Coleção do Qdrant gravada pelo n8n (payload { content, metadata }). */
export class QdrantBase implements KnowledgeBase {
  constructor(
    private readonly url: string | undefined,
    private readonly apiKey: string | undefined,
    private readonly collection: string,
    private readonly embeddings: GeminiEmbeddings,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  private async call(method: string, path: string, body: unknown): Promise<any> {
    const init = body === undefined ? {} : { body: JSON.stringify(body) };
    if (!this.url) throw new Error('QDRANT_URL não configurada');
    const res = await this.fetchFn(`${this.url.replace(/\/$/, '')}/collections/${encodeURIComponent(this.collection)}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { 'api-key': this.apiKey } : {}) },
      ...init,
      signal: AbortSignal.timeout(30_000),
    });
    return json(res, 'Qdrant');
  }

  async search(query: string, limit: number): Promise<Ficha[]> {
    const vector = await this.embeddings.embed(query);
    const r = await this.call('POST', '/points/search', { vector, limit, with_payload: true });
    return (r.result ?? []).map((p: any) => ({
      content: String(p.payload?.content ?? p.payload?.pageContent ?? ''),
      metadata: p.payload?.metadata ?? {},
      score: typeof p.score === 'number' ? p.score : undefined,
    }));
  }

  async insert(content: string, metadata: Record<string, unknown>): Promise<void> {
    const vector = await this.embeddings.embed(content);
    await this.call('PUT', '/points?wait=true', { points: [{ id: randomUUID(), vector, payload: { content, metadata } }] });
  }

  /** Grava várias fichas de uma vez (carga da base). */
  async insertMany(items: { content: string; metadata: Record<string, unknown> }[]): Promise<void> {
    if (!items.length) return;
    const vectors = await this.embeddings.embedMany(items.map((i) => i.content));
    const points = items.map((it, k) => ({ id: randomUUID(), vector: vectors[k], payload: { content: it.content, metadata: it.metadata } }));
    await this.call('PUT', '/points?wait=true', { points });
  }

  /** Dados da coleção (quantidade de pontos, tamanho do vetor). */
  async info(): Promise<{ points: number; size: number | null }> {
    const r = await this.call('GET', '', undefined);
    const vectors = r.result?.config?.params?.vectors;
    return { points: Number(r.result?.points_count ?? 0), size: vectors?.size ?? vectors?.['']?.size ?? null };
  }

  /** Índices de texto exato em metadata.id e metadata.tipo (para contar e evitar duplicar). Pode rodar de novo. */
  async ensureIndexes(): Promise<void> {
    for (const field_name of ['metadata.id', 'metadata.tipo']) {
      await this.call('PUT', '/index?wait=true', { field_name, field_schema: 'keyword' });
    }
  }

  async count(field: string, value: string): Promise<number> {
    const r = await this.call('POST', '/points/count', { exact: true, filter: { must: [{ key: field, match: { value } }] } });
    return Number(r.result?.count ?? 0);
  }

  /** Quais desses ids de ficha (metadata.id) já estão na base. */
  async existingIds(ids: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    if (!ids.length) return found;
    const r = await this.call('POST', '/points/scroll', {
      limit: ids.length * 3,
      with_payload: ['metadata.id'],
      with_vector: false,
      filter: { must: [{ key: 'metadata.id', match: { any: ids } }] },
    });
    for (const p of r.result?.points ?? []) found.add(String(p.payload?.metadata?.id ?? ''));
    return found;
  }
}

/** Claude pela API da Anthropic. */
export class Claude implements ChatModel {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly model = 'claude-sonnet-5-5',
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async answer(system: string, user: string, images: ImagePart[] = []): Promise<string> {
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');
    const content = images.length
      ? [
          ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data.toString('base64') } })),
          { type: 'text', text: user },
        ]
      : user;
    const res = await this.fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model, max_tokens: 2000, system, messages: [{ role: 'user', content }] }),
      signal: AbortSignal.timeout(120_000),
    });
    const j = await json(res, 'Claude');
    return (j.content ?? [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n')
      .trim();
  }
}
