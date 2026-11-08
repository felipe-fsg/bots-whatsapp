import type { AiClient, ImageInput } from '../types.js';

/** Google Gemini pela API REST (mesmo modelo que o n8n usava). */
export class Gemini implements AiClient {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly model = 'gemini-flash-latest',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async generate(body: unknown): Promise<string> {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const parts: any[] = json.candidates?.[0]?.content?.parts ?? [];
    return parts
      .map((p) => p.text)
      .filter(Boolean)
      .join('')
      .trim();
  }

  text(prompt: string, opts: { system?: string; temperature?: number; search?: boolean } = {}): Promise<string> {
    return this.generate({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      ...(opts.search ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: { temperature: opts.temperature ?? 0.7, maxOutputTokens: 4096 },
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
