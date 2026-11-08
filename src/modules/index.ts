import type { BotModule } from '../core/types.js';
import { splinter } from './splinter/index.js';

/** Módulos disponíveis. Cada bot no banco aponta para um deles pela coluna bots.module. */
export const modules: BotModule[] = [splinter];
