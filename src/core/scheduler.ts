import { Cron } from 'croner';
import type { BotModule, Logger } from './types.js';
import type { Runtime } from './runtime.js';

/** Liga os agendamentos de cada módulo para todos os bots ativos daquele módulo. */
export function startScheduler(runtime: Runtime, modules: BotModule[], log: Logger, timezone = 'America/Sao_Paulo'): Cron[] {
  const crons: Cron[] = [];
  for (const module of modules) {
    for (const job of module.jobs ?? []) {
      crons.push(
        new Cron(job.cron, { timezone, protect: true, name: `${module.id}:${job.name}` }, async () => {
          const bots = (await runtime.activeBots()).filter((b) => b.module === module.id);
          for (const bot of bots) {
            try {
              await job.run(runtime.context(bot));
            } catch (err) {
              log.error({ err: String(err), bot: bot.id, job: job.name }, 'erro no agendamento');
            }
          }
        }),
      );
    }
  }
  return crons;
}
