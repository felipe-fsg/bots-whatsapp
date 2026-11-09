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

export interface ChatModel {
  /** Uma pergunta, uma resposta (texto). */
  answer(system: string, user: string): Promise<string>;
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
    if (!this.url) throw new Error('QDRANT_URL não configurada');
    const res = await this.fetchFn(`${this.url.replace(/\/$/, '')}/collections/${encodeURIComponent(this.collection)}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { 'api-key': this.apiKey } : {}) },
      body: JSON.stringify(body),
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
}

/** Claude pela API da Anthropic. */
export class Claude implements ChatModel {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly model = 'claude-sonnet-5-5',
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async answer(system: string, user: string): Promise<string> {
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');
    const res = await this.fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model, max_tokens: 2000, system, messages: [{ role: 'user', content: user }] }),
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
