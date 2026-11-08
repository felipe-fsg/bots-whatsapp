import Fastify from 'fastify';
import type { Logger as Pino } from 'pino';
import multipart from '@fastify/multipart';
import { timingSafeEqual } from 'node:crypto';
import type { Runtime } from './core/runtime.js';
import { parseWhatsmeowEvent } from './core/whatsapp/whatsmeow.js';

interface Payload {
  jsonData: string;
  file?: { data: Buffer; mime: string; filename: string };
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function buildServer(runtime: Runtime, opts: { secret: string; logger?: Pino }) {
  const app = Fastify({ ...(opts.logger ? { loggerInstance: opts.logger } : {}), bodyLimit: 20 * 1024 * 1024 });
  void app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

  app.get('/health', async () => ({ ok: true }));

  // A AvisaAPI manda um POST por evento: campo jsonData (texto JSON do whatsmeow) e, quando há mídia, o arquivo "file".
  app.post<{ Params: { connectionId: string }; Querystring: { key?: string } }>(
    '/webhook/avisa/:connectionId',
    async (req, reply) => {
      if (!sameSecret(req.query.key ?? '', opts.secret)) return reply.code(401).send({ ok: false });
      if (!(await runtime.connectionExists(req.params.connectionId))) return reply.code(404).send({ ok: false });

      const payload: Payload = { jsonData: '' };
      if (req.isMultipart()) {
        for await (const part of req.parts()) {
          if (part.type === 'file') {
            payload.file = { data: await part.toBuffer(), mime: part.mimetype, filename: part.filename };
          } else if (part.fieldname === 'jsonData') {
            payload.jsonData = String(part.value);
          }
        }
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body: any = req.body ?? {};
        payload.jsonData = typeof body.jsonData === 'string' ? body.jsonData : JSON.stringify(body.jsonData ?? body);
      }

      let raw: unknown;
      try {
        raw = JSON.parse(payload.jsonData);
      } catch {
        return reply.code(400).send({ ok: false, error: 'jsonData inválido' });
      }
      const msg = parseWhatsmeowEvent(raw, payload.file);
      if (!msg) return { ok: true, result: 'ignored' };

      const result = await runtime.handle(req.params.connectionId, msg, async (url) => {
        const form = new FormData();
        form.set('jsonData', payload.jsonData);
        if (payload.file) form.set('file', new Blob([new Uint8Array(payload.file.data)], { type: payload.file.mime }), payload.file.filename);
        await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
      });
      return { ok: true, result };
    },
  );

  return app;
}
