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

  // A AvisaAPI pode mandar o evento como formulário simples ou com outro Content-Type: aceitamos todos.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(String(body)));
    } catch {
      done(null, { raw: String(body) });
    }
  });

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
        let body: any = req.body ?? {};
        if (typeof body === 'string') body = { raw: body }; // text/plain
        req.log.info({ contentType: req.headers['content-type'], keys: Object.keys(body).slice(0, 10) }, 'webhook sem multipart');
        if (typeof body.jsonData === 'string') payload.jsonData = body.jsonData;
        else if (body.jsonData) payload.jsonData = JSON.stringify(body.jsonData);
        else if (typeof body.raw === 'string') payload.jsonData = body.raw;
        else payload.jsonData = JSON.stringify(body);
      }

      let raw: unknown;
      try {
        raw = JSON.parse(payload.jsonData);
      } catch {
        return reply.code(400).send({ ok: false, error: 'jsonData inválido' });
      }
      const msg = parseWhatsmeowEvent(raw, payload.file);
      if (!msg) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r: any = raw;
        const ev = r?.event ?? r;
        if (ev && typeof ev === 'object' && !ev.Info) {
          // Eventos que não são mensagem: registra o formato para conhecermos o que a AvisaAPI manda.
          req.log.info({ type: r?.type ?? ev?.type ?? null, keys: Object.keys(ev).slice(0, 15) }, 'evento ignorado');
        }
        return { ok: true, result: 'ignored' };
      }

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
