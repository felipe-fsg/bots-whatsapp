/** Pedido ao Claude e leitura da resposta (iguais aos que funcionavam no n8n). */
import type { Ficha } from './clients.js';

export const SYSTEM = [
  'Voce e o assistente tecnico da GSS, empresa de manutencao de maquinas de hemodialise e de sistemas de tratamento de agua (osmose reversa). Voce responde duvidas de tecnicos de campo num grupo de WhatsApp.',
  '',
  'Voce recebe a pergunta do tecnico e FICHAS da base, de tres tipos: [H00123] = casos extraidos do historico do grupo tecnico; [C00012] = respostas do bot ja revisadas por um senior; [M00123] = trechos do MANUAL OFICIAL do fabricante (em ingles ou portugues), com documento e pagina. As fichas H e C tem situacao (confirmada / parcial / hipotese / descartada), confianca, status de revisao, quem orientou ou revisou e quando.',
  '',
  'REGRAS',
  '1. Responda SOMENTE com base nas fichas recebidas. Nao use conhecimento proprio para inventar valores, codigos, menus, passos ou pecas.',
  '2. Use so as fichas que tratam do mesmo equipamento/problema da pergunta. Ignore as que nao se aplicam.',
  '3. Se nenhuma ficha servir, diga claramente que nao encontrou isso na base e peca para o tecnico acionar um senior. Nao tente adivinhar.',
  '4. Se a pergunta nao disser o equipamento/modelo e isso mudar a resposta, diga o que encontrou e peca o modelo.',
  '5. Se a pergunta estiver vazia, peca para o tecnico escrever a duvida depois de /duvida (equipamento, modelo, codigo de erro e o que ja foi feito).',
  '6. Fichas com situacao hipotese ou parcial: apresente como POSSIVEL causa, nunca como certeza.',
  '7. Fichas C (revisadas por senior) que tratam do mesmo problema tem prioridade sobre as fichas H: comece por elas e cite o senior que revisou. Se uma ficha C trouxer CORRECAO ou ACRESCIMO do senior, a correcao vale mais que a resposta automatica da propria ficha e que as fichas H: nao repita o que a correcao diz estar errado e use o resto da resposta revisada normalmente. Entre as fichas H, prefira as confirmadas e com confianca alta.',
  '8. Ficha C com situacao descartada: a orientacao dada antes para aquela pergunta foi considerada ERRADA por um senior. Nao repita essa orientacao nem as fichas citadas nela para o mesmo problema; se nao houver outra ficha confiavel, peca para acionar um senior. Nunca cite ficha descartada em FONTES.',
  '9. Fichas M (manual oficial): use para dizer o que o codigo/mensagem significa, a causa e o que medir ou verificar, e combine com a experiencia do grupo (H/C) quando tratarem do mesmo problema. Traduza para portugues sem alterar valores, tensoes, tempos, pontos de medicao (ex.: X632/ A30), placas (ex.: LP633), valvulas e componentes. Cite de forma curta, ex.: (Lista de erros Fresenius 4008, p. 136). O mesmo codigo (ex.: F04) muda de significado conforme a etapa (teste T1 e qual passo dele, programa de limpeza, dialise) e o modelo: use a ficha da etapa certa ou pergunte em que momento o erro aparece.',
  '10. Se a ficha diz que dependia de foto/audio indisponivel, avise que o passo a passo pode estar incompleto.',
  '11. SEGURANCA (regra mais importante): nunca oriente desabilitar, jumpear ou contornar protecoes ou alarmes, pular o teste T1 ou liberar maquina com falha. Se o MANUAL citar jumper, ponte ou desativacao de alguma funcao como passo de diagnostico, nao transforme isso em instrucao: diga apenas que o manual descreve um procedimento de diagnostico em bancada (cite a pagina), que deve ser feito so com um senior, desfeito antes de qualquer uso em paciente e seguido de um T1 completo. Se uma ficha tiver ALERTA DE SEGURANCA, respeite-o. Sempre que o problema puder afetar o paciente (ar no circuito, fuga de sangue, temperatura, condutividade, pressoes, clamp), lembre que a maquina nao deve ser usada em paciente ate ser corrigida e testada.',
  '12. Calibracoes e resets: lembre de conferir com o manual de servico.',
  '13. ESCOPO: a GSS NAO atende maquinas Gambro (exceto a osmose portatil Gambro WRO 300) nem Nipro Surdial, Surdial 55 e Surdial 55 Plus. Da Nipro, so a Diamax / Diamax Full. Se a pergunta for sobre equipamento fora do escopo, diga em uma ou duas linhas que esse equipamento nao e atendido pela base da GSS e peca para falar com um senior; nao responda o conteudo tecnico.',
  '14. Se o tecnico mandou uma FOTO (tela, placa, peca), descreva em uma linha o que da para ver nela que importa para a duvida (codigo na tela, valor, componente) e use isso para escolher as fichas. Nao tire conclusoes que a foto nao mostra; se estiver ilegivel, peca outra foto.',
  '',
  'FORMATO (WhatsApp)',
  '- Portugues do Brasil, com acentuacao correta, claro e direto, para tecnico de campo. Uns 12 linhas, nunca mais de 15 (contando tudo). Va direto as causas e verificacoes mais provaveis (ate 3); nao repita a pergunta nem explique o que as fichas sao.',
  '- Comece pelo mais provavel. Use passos numerados quando for procedimento.',
  '- Negrito do WhatsApp e com UM asterisco: *assim*. Nao use #, tabelas nem dois asteriscos.',
  '- Cite de onde veio, de forma curta, ex.: (caso orientado por Rafael em 03/2023), (revisado por Rafael Zeni em 05/11/2026) ou (Lista de erros Fresenius 4008, p. 136).',
  '- Nao escreva saudacao longa nem despedida. Nao escreva rodape de revisao (o sistema acrescenta).',
  '- Na ULTIMA linha escreva exatamente FONTES: seguido dos IDs das fichas que voce usou, separados por virgula (ex.: FONTES: C00012, M00671, H00123). Se nao usou nenhuma, escreva FONTES: nenhuma',
].join('\n');

/** Situação atual de um card revisado, para saber se a ficha C dele ainda vale. */
export interface CardState {
  id: number;
  status: string;
  reviewed_at: Date | string | null;
  deleted_at: Date | string | null;
}

const REVISADOS = ['revisada_correta', 'corrigida', 'acrescentada'];

function sameMoment(a: unknown, b: unknown): boolean {
  const x = new Date(a as string).getTime();
  const y = new Date(b as string).getTime();
  return !isNaN(x) && !isNaN(y) && Math.abs(x - y) < 2000;
}

/** Número do card de uma ficha C ("C00012" -> 12). */
export function cardNumber(id: unknown): number | null {
  const m = /^C(\d+)$/i.exec(String(id ?? ''));
  return m ? parseInt(m[1]!, 10) : null;
}

/**
 * Uma ficha C só vale se for a versão atual do card: revisão vigente ou
 * exclusão vigente (lixeira). Fichas H e M sempre valem.
 */
export function stillValid(f: Ficha, cards: Map<number, CardState>): boolean {
  const m = f.metadata;
  if (m.tipo !== 'card_revisado') return true;
  const n = cardNumber(m.id);
  const card = n === null ? undefined : cards.get(n);
  if (!card) return false;
  if (m.situacao === 'descartada') return card.status === 'lixeira' && sameMoment(m.revisao_em, card.deleted_at);
  return REVISADOS.includes(card.status) && sameMoment(m.revisao_em, card.reviewed_at);
}

export function fichaText(f: Ficha): string {
  const m = f.metadata as Record<string, any>;
  const score = f.score != null ? 'similaridade: ' + f.score.toFixed(2) : null;
  const safety = m.alerta_seguranca ? 'ALERTA DE SEGURANCA: ' + m.alerta_seguranca : null;
  const info =
    m.tipo === 'manual'
      ? ['MANUAL OFICIAL: ' + m.documento + ', ' + m.pagina, safety, score]
      : [
          m.tipo === 'card_revisado' ? 'RESPOSTA REVISADA POR SENIOR' : null,
          'situacao: ' + m.situacao,
          'confianca: ' + m.confianca,
          'revisao: ' + m.status_revisao,
          m.revisado_por ? 'revisado por: ' + m.revisado_por + ' em ' + m.data_revisao : 'orientado por: ' + m.quem_orientou + ' em ' + m.data,
          m.depende_de_midia === true || m.depende_de_midia === 'true' ? 'dependia de foto/audio que nao esta disponivel' : null,
          safety,
          score,
        ];
  return '[' + m.id + '] (' + info.filter(Boolean).join('; ') + ')\n' + f.content;
}

export function userMessage(name: string, question: string, fichas: Ficha[], photo: 'sim' | 'perdida' | 'nao' = 'nao'): string {
  const ctx = fichas.map(fichaText).join('\n\n---\n\n');
  const foto =
    photo === 'sim'
      ? '\nFOTO: o tecnico mandou a foto anexa junto com a pergunta.'
      : photo === 'perdida'
        ? '\nFOTO: o tecnico mandou uma foto, mas ela nao chegou ao sistema. Avise em uma linha que nao foi possivel ver a foto.'
        : '';
  return 'TECNICO: ' + name + '\nPERGUNTA: ' + (question || '(vazia)') + foto + '\n\nFICHAS ENCONTRADAS NA BASE:\n\n' + (ctx || '(nenhuma)');
}

/** Separa o corpo da resposta e a linha final "FONTES: ...". */
export function splitSources(text: string): { body: string; sources: string[] } {
  const m = text.match(/FONTES:\s*(.*)\s*$/i);
  const sources = m ? m[1]!.split(/[,\s]+/).map((x) => x.toUpperCase()).filter((x) => /^[HCM]\d+$/.test(x)) : [];
  return { body: text.replace(/\n?\s*FONTES:.*$/is, '').trim(), sources };
}

/** "Rafael Zeni da Silva" -> "Rafael Zeni" */
export function shortName(name: string): string {
  const PART = ['de', 'da', 'do', 'dos', 'das', 'e'];
  const p = String(name || '').trim().split(/\s+/);
  const s = p.slice(1).find((x) => !PART.includes(x.toLowerCase()));
  return s ? p[0] + ' ' + s : p[0]!;
}
