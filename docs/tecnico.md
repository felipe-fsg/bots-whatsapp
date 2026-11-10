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

## Base de conhecimento (sem o n8n)

O servidor fala direto com o Qdrant, então a carga de fichas não precisa mais do fluxo "Ingestão base técnica".

- `bash scripts/base-tecnica.sh status`: total da coleção e quantas fichas H (histórico), C (revisadas) e M (manuais)
  existem, e se as fichas H00001, H02481, M00001 e M00914 estão lá.
- `bash scripts/base-tecnica.sh carregar /root/arquivo.json [outro.json]`: grava as fichas novas em lotes de 50, com o
  mesmo modelo de embedding (`gemini-embedding-2`). Fichas cujo `metadata.id` já existe são puladas, então dá para rodar
  de novo depois de uma falha (ex.: cota do Gemini). Se o Gemini devolver vetor vazio, a carga para em vez de gravar lixo.
- Formato: lista JSON de `{ "content": "texto", "metadata": { "id": "M00001", "tipo": "manual", ... } }`
  (aceita também `pageContent`/`texto`, `{ "itens": [...] }` e uma ficha por linha).
- Para mandar o arquivo do Windows: `scp C:\caminho\arquivo.json root@135.181.203.52:/root/`

## Fotos

`/duvida` na legenda de uma foto (tela, placa, peça): a foto vai junto para o Claude. Se a AvisaAPI não mandar os bytes,
o bot responde só pelo texto e avisa que não viu a foto.

## Escopo

O prompt recusa Gambro (exceto a osmose portátil WRO 300) e Nipro Surdial / Surdial 55 / 55 Plus; da Nipro só Diamax.

## Virada do n8n para o núcleo

1. No servidor: `cd /opt/bots-whatsapp && bash scripts/instalar-servidor.sh` e depois `bash scripts/configurar-tecnico.sh`.
2. Cadastro (cliente GSS, grupo de teste, sêniores e os 10 cards do n8n):
   `docker compose exec -T db psql -U bots -d bots < /root/cadastrar-tecnico.sql`
3. `bash scripts/base-tecnica.sh status` para conferir a base.
4. O webhook da AvisaAPI já aponta para o núcleo (desde 09/11/2026); não precisa trocar nada lá.
5. Testar no grupo de teste: `/duvida`, foto com `/duvida`, e as revisões `/correto`, `/corrigir`, `/acrescentar`,
   `/excluir`, `/restaurar`.
6. Depois do teste: despublicar no n8n "Bot dúvidas técnicas — Resposta", "— Revisão" e "Teste webhook".
