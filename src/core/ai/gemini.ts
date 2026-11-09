import type { AiClient, ImageInput, WebAnswer, WebSource } from '../types.js';

/** Google Gemini pela API REST (mesmo modelo que o n8n usava). */
export class Gemini implements AiClient {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly model = 'gemini-flash-latest',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async generate(body: unknown): Promise<string> {
    return textOf(await this.call(body));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async call(body: unknown): Promise<any> {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY não configurada');
    const res = await this.fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      },
    );
    if (!res.ok) throw new Error(`Gemini respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  async research(prompt: string, opts: { system?: string } = {}): Promise<WebAnswer> {
    const json = await this.call({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chunks: any[] = json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const raw: WebSource[] = chunks
      .map((c) => ({ title: String(c.web?.title ?? ''), url: String(c.web?.uri ?? '') }))
      .filter((c) => c.url);
    const sources = await Promise.all(raw.slice(0, 6).map((s) => this.unwrap(s)));
    return { text: textOf(json), sources };
  }

  /** Os links do Google vêm como redirecionamento; troca pelo endereço da página. */
  private async unwrap(s: WebSource): Promise<WebSource> {
    if (!s.url.includes('grounding-api-redirect')) return s;
    try {
      const res = await this.fetchFn(s.url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5_000) });
      const to = res.headers.get('location');
      if (to && /^https?:\/\//.test(to)) return { ...s, url: to };
    } catch {
      /* fica com o link do Google */
    }
    return s;
  }

  text(prompt: string, opts: { system?: string; temperature?: number; search?: boolean; json?: boolean } = {}): Promise<string> {
    return this.generate({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      ...(opts.search ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: {
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: 4096,
        ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      },
    });
  }

  vision(prompt: string, images: ImageInput[]): Promise<string> {
    return this.generate({
      contents: [
        {
          role: 'user',
          parts: [
            ...images.map((i) => ({ inline_data: { mime_type: i.mime, data: i.data.toString('base64') } })),
            { text: prompt },
          ],
        },
      ],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textOf(json: any): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = json.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text)
    .filter(Boolean)
    .join('')
    .trim();
}
