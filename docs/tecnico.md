# Bot de dúvidas técnicas (módulo `tecnico`)

Migrado dos fluxos do n8n "Bot dúvidas técnicas — Resposta" e "— Revisão".

## Como funciona

- `/duvida pergunta` (também `/dúvida`, `\duvida`, `#duvida`): busca as 10 fichas mais parecidas na coleção
  `gss_base_tecnica` do Qdrant (embeddings `gemini-embedding-2`), o Claude responde só com base nelas e o bot posta
  no grupo. Cada resposta vira um card na tabela `tecnico_cards`.
- Sêniores (os admins do bot) respondem à mensagem do bot com `/correto`, `/corrigir texto`, `/acrescentar texto`,
  `/excluir` (lixeira) ou `/restaurar`. A versão revisada é gravada no Qdrant como ficha `C` + número do card.
- Uma ficha `C` só vale enquanto for a versão atual do card (mesma lógica do n8n).
- Mensagens do próprio número do bot com `/duvida` ou comandos de revisão também são atendidas.
- Funções do núcleo neste módulo: só agenda e `#resumo` (sem mascote).

## Chaves no .env

`ANTHROPIC_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY` (e opcionais `QDRANT_COLLECTION`, `TECNICO_MODEL`,
`GEMINI_EMBEDDING_MODEL`). No servidor: `bash scripts/configurar-tecnico.sh`.

## Cadastro

Como qualquer bot, com `"modulo": "tecnico"` no JSON (os sêniores vão em `admins`).
