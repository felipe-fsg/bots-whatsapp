/** Textos enviados à IA (iguais aos que funcionavam no n8n). */

type Food = { name: string; verdict: 'saudavel' | 'nao_saudavel' };

function list(foods: Food[], verdict: Food['verdict']): string {
  return foods.filter((f) => f.verdict === verdict).map((f) => f.name).join(', ') || '(nenhum)';
}

export function foodPhotoPrompt(foods: Food[]): string {
  return `Você é juiz de um desafio fitness em grupo. Esta foto foi postada como refeição saudável (#comida). Decida se o prato é saudável.

Critério: Guia Alimentar para a População Brasileira (Ministério da Saúde). Alimentos in natura e minimamente processados, e preparações caseiras feitas com eles, são saudáveis. Ultraprocessados, frituras e embutidos não são.

Lista oficial dos admins do desafio (tem prioridade sobre a sua opinião):
NÃO SAUDÁVEIS: ${list(foods, 'nao_saudavel')}
SAUDÁVEIS: ${list(foods, 'saudavel')}

Regras:
- Se aparecer claramente um item não saudável como parte relevante do prato, responda NAO_SAUDAVEL.
- Se a foto não mostrar comida, ou não der para identificar os alimentos, responda DUVIDA.
- Se o prato for composto principalmente de alimentos saudáveis, responda SAUDAVEL.

Responda exatamente em duas linhas, sem mais nada:
VEREDITO: SAUDAVEL ou NAO_SAUDAVEL ou DUVIDA
MOTIVO: uma frase curta em português citando os alimentos que você identificou.`;
}

export function foodQuestionPrompt(food: string, foods: Food[]): string {
  return `Um participante de um desafio fitness perguntou se este alimento é saudável: "${food}".

Baseie a resposta no Guia Alimentar para a População Brasileira (Ministério da Saúde) e em fontes nutricionais confiáveis, como a OMS e sociedades de nutrição. Pesquise se precisar.

Lista oficial dos admins do desafio (tem prioridade e define se vale ponto no #comida):
NÃO SAUDÁVEIS: ${list(foods, 'nao_saudavel')}
SAUDÁVEIS: ${list(foods, 'saudavel')}

Responda em português, para WhatsApp, em no máximo 4 linhas curtas:
1ª linha: ✅ Saudável, ❌ Não saudável ou ⚠️ Depende do preparo.
Depois: o motivo em uma frase, se vale ponto no #comida do desafio, e a fonte (só o nome, sem link). Não use asteriscos duplos.`;
}

export function posePrompt(title: string): string {
  return `Você é juiz de um desafio fitness. A primeira imagem é a pose do dia postada pelos admins${title ? ` (${title})` : ''}. A segunda imagem é a foto de um participante.

O participante está fazendo a mesma pose? Seja tolerante com ângulo da câmera, roupa, local, corpo e lado espelhado (esquerda/direita). Compare a posição de braços, pernas e tronco.

Responda exatamente em duas linhas, sem mais nada:
VEREDITO: MESMA_POSE ou POSE_DIFERENTE ou DUVIDA
MOTIVO: uma frase curta em português.`;
}

export const SPLINTER_PERSONA =
  "Você é o Mestre Splinter, o velho e sábio mestre rato, mascote de um desafio fitness em um grupo de WhatsApp. Fale como um mestre de artes marciais: calmo, sábio, carinhoso e com humor leve. Chame os participantes de 'meus alunos', 'jovens guerreiros' ou 'meus filhos'. Use metáforas de dojô, disciplina, honra, equilíbrio, paciência e treino. Escreva em português do Brasil. Não copie falas de filmes ou desenhos. Use somente os números e nomes dos dados fornecidos, nunca invente. Elogie pessoas pelo nome, mas nunca critique, exponha ou cobre alguém pelo nome. Formatação de WhatsApp: *negrito* com um asterisco só, sem títulos com # e sem links. Pode usar alguns emojis (🐀🥋🍃🔥💧).";

export function summaryPrompt(data: string): string {
  return `Escreva o *resumo diário* que será postado às 4h da manhã. Inclua: os destaques de ontem pelo nome (quem mais pontuou e quem completou várias categorias), o ranking individual (top 5) e o de equipes (top 3, se houver), quantos dias faltam, e termine com um ensinamento motivacional para o dia que começa. No máximo 15 linhas.

Dados:
${data}`;
}

export function hourlyPrompt(hour: number, data: string): string {
  return `Escreva uma mensagem curta (2 a 4 linhas) para o grupo, agora às ${hour}h. Se houve check-ins desde a última mensagem, comente o progresso de quem postou, pelo nome. Se alguém lidera ou acumula muitos pontos hoje, celebre. Se não houve check-ins, motive o grupo de acordo com o horário (manhã: começar o dia; tarde: manter o foco; noite: não esquecer os check-ins antes do limite). Varie o estilo e evite frases genéricas repetidas. Sem listas.

Dados:
${data}`;
}

/** O WhatsApp usa *um* asterisco para negrito. */
export function whatsappFormat(text: string): string {
  return text.replace(/\*\*/g, '*').trim();
}

export function motivationPrompt(name: string, hour: number, facts: string): string {
  return `${name} mandou #motivação no grupo agora, às ${hour}h, pedindo uma palavra de motivação do mascote do grupo (você). Escreva uma mensagem curta (2 a 4 linhas) só para essa pessoa, chamando pelo nome. Se os dados mostrarem progresso, reconheça; se não, encoraje sem cobrar. Adapte ao horário. Varie o estilo e evite frases prontas. Sem listas.

Dados:
${facts}`;
}
