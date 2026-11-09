import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  // Segredo que vai no endereço do webhook: /webhook/avisa/<id da conexão>?key=<segredo>
  WEBHOOK_SECRET: z.string().min(16),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-flash-latest'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  // Bot de dúvidas técnicas: Claude responde com base nas fichas guardadas no Qdrant
  ANTHROPIC_API_KEY: z.string().optional(),
  TECNICO_MODEL: z.string().default('claude-sonnet-5-5'),
  QDRANT_URL: z.string().optional(),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default('gss_base_tecnica'),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-2'),
  LOG_LEVEL: z.string().default('info'),
  // false desliga os agendamentos (útil em testes e em mais de uma réplica)
  SCHEDULER: z.enum(['on', 'off']).default('on'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuração inválida no .env: ${fields}`);
  }
  return parsed.data;
}
