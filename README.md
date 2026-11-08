# Bots para grupos de WhatsApp

Núcleo multi-cliente para bots de grupo, em TypeScript + Postgres. O primeiro módulo é o
**Mestre Splinter** (desafio fitness), migrado dos fluxos do n8n com as mesmas regras.

## Como funciona

```
AvisaAPI ──webhook──▶ servidor (Fastify)
                         │  lê o evento do whatsmeow (src/core/whatsapp/whatsmeow.ts)
                         │  acha o bot pelo grupo (tabela bots) ──não achou──▶ repassa ou ignora
                         │  evita mensagem repetida (processed_messages)
                         ▼
                     fila por grupo (uma mensagem por vez)
                         ▼
                     módulo do bot (src/modules/splinter) ──▶ Postgres, Gemini, Google Places, AvisaAPI
agendador (croner) ──▶ tarefas de cada módulo (resumo às 4h, localização vencida...)
```

- **Cliente** (`tenants`): quem paga. **Conexão** (`wa_connections`): um número de WhatsApp na AvisaAPI.
  **Bot** (`bots`): um grupo atendido por um módulo. Um número pode atender vários grupos.
- Mensagens de grupos sem bot são descartadas logo na entrada, sem gastar nada. Se a conexão tiver
  `forward_url`, elas são repassadas para lá (por exemplo, o bot de dúvidas que continua no n8n).
  `forward_chats` limita o repasse a alguns grupos.
- O token da AvisaAPI fica no `.env`; o banco só guarda o nome da variável (`token_env`).
- Para criar um módulo novo: um arquivo em `src/modules/<nome>/index.ts` que exporta um `BotModule`
  (`handle` para mensagens e `jobs` para agendamentos) e uma linha em `src/modules/index.ts`.

## Mestre Splinter

| O quê | Onde |
|---|---|
| Regras de pontuação (hashtag, limites diário e semanal, foto repetida) | `src/modules/splinter/rules.ts` |
| Check-in por foto, localização, pose do dia, comandos | `src/modules/splinter/index.ts` |
| Textos do grupo e das regras | `src/modules/splinter/messages.ts` |
| Pedidos para a IA (prato, pose, ?alimento, persona) | `src/modules/splinter/prompts.ts` |
| Resumo às 4h, mensagens ao longo do dia, localização vencida | `src/modules/splinter/jobs.ts` |
| Tabelas | `migrations/002_splinter.sql` |

Comandos: `#ranking`, `#equipes`, `#regras`, `?alimento`, `#meulocal Nome` (respondendo à própria
localização) e, para admins, `#inscrever`, `#equipe Nome @a @b`, `#posedodia`, `#pendentes`,
`#aprovar`, `#recusar motivo`.

Novidade em relação ao n8n: `#meulocal` deixa cada participante cadastrar o próprio local de treino
(casa, condomínio). A coordenada mandada no check-in continua sem ser guardada (LGPD); só o nome
do local e a distância.

## Rodar no computador

Precisa de Node 22 e Docker.

```bash
npm install
docker compose up -d db                 # só o Postgres
cp .env.example .env                    # preencha WEBHOOK_SECRET e as chaves
export DATABASE_URL=postgres://bots:troque-esta-senha@localhost:5432/bots
npm run seed -- seed/exemplo-splinter.json
npm run dev
```

Testes (usam um Postgres de verdade; o banco é apagado a cada teste):

```bash
TEST_DATABASE_URL=postgres://... npm test
```

## Colocar no servidor

1. Num VPS com Docker, clone o repositório e crie o `.env` a partir do `.env.example`.
2. Aponte o domínio (`DOMINIO`) para o IP do servidor.
3. `docker compose up -d --build` (o Caddy cuida do HTTPS).
4. Cadastre o bot: `docker compose exec app npx tsx scripts/seed-splinter.ts /caminho/arquivo.json`.
   O comando mostra o endereço do webhook.
5. Na AvisaAPI, troque o webhook do número para esse endereço.

Rodar o cadastro de novo com o arquivo alterado atualiza o desafio sem duplicar nada.
