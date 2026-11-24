/**
 * Entrada do sistema externo de laudos (ver docs/agua.md).
 *
 * POST /api/agua/laudos       manda um laudo para o grupo pedir autorização
 * GET  /api/agua/laudos/:id   consulta se já foi aprovado ou recusado
 *
 * Autenticação: cabeçalho "Authorization: Bearer <AGUA_API_KEY>" (ou x-api-key).
 */
import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Runtime } from '../../core/runtime.js';
import type { Bot } from '../../core/types.js';
import { foldCommand } from '../../core/commands.js';
import { laudoJson, receberLaudo, type LaudoRow } from './index.js';

const text = z.string().trim().min(1).max(2000);

export const laudoSchema = z.object({
  id: z.string().trim().min(1).max(100),
  resultado: z
    .string()
    .transform((s) => foldCommand(s).trim())
    .pipe(z.enum(['satisfatorio', 'insatisfatorio'])),
  cliente: text.optional(),
  equipamento: text.optional(),
  os: text.optional(),
  data_coleta: text.optional(),
  resumo: z.string().trim().max(3000).optional(),
  parametros: z
    .array(z.object({ nome: text, valor: text, limite: text.optional(), ok: z.boolean().optional() }))
    .max(40)
    .optional(),
  link: z.string().url().max(1000).optional(),
  /** Grupo (JID @g.us). Opcional quando só existe um grupo de qualidade da água. */
  grupo: z.string().trim().optional(),
  /** Para onde o bot avisa a decisão. Sem isso, usa AGUA_CALLBACK_URL do .env. */
  callback_url: z.string().url().max(1000).optional(),
});

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function keyOf(headers: Record<string, unknown>): string {
  const auth = String(headers.authorization ?? '');
  if (/^bearer /i.test(auth)) return auth.slice(7).trim();
  return String(headers['x-api-key'] ?? '');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAguaApi(app: FastifyInstance<any, any, any, any>, runtime: Runtime, key: string | undefined): void {
  const guard = (headers: Record<string, unknown>): number | null => {
    if (!key) return 503; // AGUA_API_KEY não configurada: entrada desligada
    return sameSecret(keyOf(headers), key) ? null : 401;
  };
  const aguaBots = async (grupo?: string): Promise<Bot[]> =>
    (await runtime.activeBots()).filter((b) => b.module === 'agua' && (!grupo || b.chatJid === grupo));

  app.post('/api/agua/laudos', async (req, reply) => {
    const denied = guard(req.headers);
    if (denied) return reply.code(denied).send({ ok: false, error: denied === 503 ? 'AGUA_API_KEY não configurada' : 'chave inválida' });
    const parsed = laudoSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'dados inválidos', campos: parsed.error.issues.map((i) => i.path.join('.') || i.message) });
    }
    const b = parsed.data;
    const bots = await aguaBots(b.grupo);
    if (bots.length === 0) return reply.code(404).send({ ok: false, error: b.grupo ? 'grupo não encontrado' : 'nenhum grupo de qualidade da água ativo' });
    if (bots.length > 1) {
      return reply.code(400).send({ ok: false, error: 'há mais de um grupo de qualidade da água: informe "grupo"', grupos: bots.map((x) => x.chatJid) });
    }
    const { id, resultado, grupo: _g, callback_url, ...dados } = b;
    const { laudo, novo } = await receberLaudo(runtime.context(bots[0]!), {
      external_id: id,
      resultado,
      dados,
      callback_url: callback_url ?? null,
    });
    return reply.code(novo ? 201 : 200).send({ ok: true, novo, laudo: laudoJson(laudo) });
  });

  app.get<{ Params: { id: string }; Querystring: { grupo?: string } }>('/api/agua/laudos/:id', async (req, reply) => {
    const denied = guard(req.headers);
    if (denied) return reply.code(denied).send({ ok: false });
    const ids = (await aguaBots(req.query.grupo)).map((x) => x.id);
    if (!ids.length) return reply.code(404).send({ ok: false, error: 'laudo não encontrado' });
    const sql = runtime.sql;
    const [row] = await sql<LaudoRow[]>`
      select * from agua_laudos where external_id = ${req.params.id} and bot_id in ${sql(ids)} order by created_at desc limit 1`;
    if (!row) return reply.code(404).send({ ok: false, error: 'laudo não encontrado' });
    return { ok: true, laudo: laudoJson(row) };
  });
}
