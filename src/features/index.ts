import type { BotModule } from '../core/types.js';
import { agenda } from './agenda/index.js';
import { mascote } from './mascote/index.js';
import { resumo } from './resumo/index.js';
import { boasvindas } from './boasvindas/index.js';
import { pesquisa } from './pesquisa/index.js';
import { inativos } from './inativos/index.js';
import { curiar } from './curiar/index.js';
import { admins } from './admins/index.js';
import { instagram } from './instagram/index.js';
import { pista } from './pista/index.js';
import { suporte } from './suporte/index.js';
import { engajamento } from './engajamento/index.js';

/** Funções do núcleo. Um módulo pode limitar quais usa (o técnico, grupo profissional, só usa agenda, resumo e pesquisa). */
// engajamento vem primeiro para contar toda mensagem, inclusive comandos.
export const features: BotModule[] = [engajamento, suporte, inativos, boasvindas, agenda, resumo, pesquisa, curiar, admins, instagram, pista, mascote];
