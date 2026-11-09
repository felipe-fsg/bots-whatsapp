import type { BotModule } from '../core/types.js';
import { agenda } from './agenda/index.js';
import { mascote } from './mascote/index.js';
import { resumo } from './resumo/index.js';

/** Funções do núcleo: valem para todos os bots, qualquer que seja o módulo. */
export const features: BotModule[] = [agenda, resumo, mascote];
