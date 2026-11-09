import type { BotModule } from '../core/types.js';
import { agenda } from './agenda/index.js';
import { mascote } from './mascote/index.js';
import { resumo } from './resumo/index.js';
import { boasvindas } from './boasvindas/index.js';
import { pesquisa } from './pesquisa/index.js';
import { inativos } from './inativos/index.js';
import { curiar } from './curiar/index.js';
import { admins } from './admins/index.js';

/** Funções do núcleo: valem para todos os bots, qualquer que seja o módulo. */
export const features: BotModule[] = [inativos, boasvindas, agenda, resumo, pesquisa, curiar, admins, mascote];
