import { pino } from 'pino';
import { loadConfig } from './config.js';
import { connect } from './db.js';
import { migrate } from './migrate.js';
import { Runtime } from './core/runtime.js';
import { startScheduler } from './core/scheduler.js';
import { Gemini } from './core/ai/gemini.js';
import { GooglePlaces } from './core/places.js';
import { buildServer } from './server.js';
import { modules } from './modules/index.js';

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL });
const sql = connect(config.DATABASE_URL);
await migrate(sql, (m) => log.info(m));

const runtime = new Runtime({
  sql,
  modules,
  ai: new Gemini(config.GEMINI_API_KEY, config.GEMINI_MODEL),
  places: new GooglePlaces(config.GOOGLE_MAPS_API_KEY),
  log,
});

const crons = config.SCHEDULER === 'on' ? startScheduler(runtime, modules, log) : [];

// Limpeza diária: a lista de mensagens já processadas só precisa dos últimos dias.
const cleanup = setInterval(
  () => void sql`delete from processed_messages where received_at < now() - interval '7 days'`.catch(() => {}),
  24 * 3_600_000,
);

const app = buildServer(runtime, { secret: config.WEBHOOK_SECRET, logger: log });
await app.listen({ host: '0.0.0.0', port: config.PORT });

async function shutdown() {
  log.info('desligando...');
  crons.forEach((c) => c.stop());
  clearInterval(cleanup);
  await app.close();
  await runtime.idle();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
