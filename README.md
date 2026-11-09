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

## Funções do núcleo (todos os bots)

Ficam em `src/features/` e rodam antes do módulo do bot, em qualquer grupo, com ou sem desafio.

- **Agenda de eventos** (`src/features/agenda`): alguém sugere um evento no grupo; um admin responde
  com `#agendar` e a IA lê nome, data, hora, local e quem organiza (ou direto:
  `#agendar Nome | 15/11 19h | Local`). Todos podem `#agenda`, `#comparecer nome` e `#desistir nome`;
  admins podem `#cancelarevento nome`. O evento sai da lista no dia seguinte à data.

- **Resumo do dia** (`src/features/resumo`): `#resumo` resume em até 15 tópicos o que rolou no grupo
  hoje; `#resumo ontem`, o dia anterior. O núcleo guarda só o texto das mensagens dos grupos atendidos
  (`group_messages`; foto vira "[foto] legenda", localização vira "[localização]") e apaga tudo com mais
  de 3 dias.
- **Mascote** (`src/features/mascote`): cada grupo tem um personagem. `#mascote` mostra o atual; admins
  trocam com `#mascote Nome do personagem` (a IA cria a personalidade, guardada em `bot_mascots`) e
  `#mascote padrão` volta ao do módulo (`defaultMascot`). Quem começa a mensagem pelo nome do mascote
  conversa com ele. Tudo que a IA escreve no grupo usa a personalidade do mascote (`ctx.mascot()`).

## Mestre Splinter

| O quê | Onde |
|---|---|
| Regras de pontuação (hashtag, limites diário e semanal, foto repetida) | `src/modules/splinter/rules.ts` |
| Check-in por foto, localização, pose do dia, comandos | `src/modules/splinter/index.ts` |
| Textos do grupo e das regras | `src/modules/splinter/messages.ts` |
| Pedidos para a IA (prato, pose, ?alimento, persona) | `src/modules/splinter/prompts.ts` |
| Resumo às 4h, mensagens ao longo do dia, localização vencida | `src/modules/splinter/jobs.ts` |
| Tabelas | `migrations/002_splinter.sql` |

Comandos para todos, a qualquer momento: `#motivação`, `?alimento`, `#ajuda`.
Durante o desafio: `#ranking`, `#equipes`, `#regras`, `#meulocal Nome` (respondendo à própria
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

Passo a passo completo na Hetzner: [docs/hetzner.md](docs/hetzner.md). Resumo: num Ubuntu 24.04 com
acesso root, `bash scripts/instalar-servidor.sh` instala Docker, baixa o código, cria o `.env` e sobe
app + Postgres + Caddy (HTTPS automático, com domínio `sslip.io` se você não tiver um). Depois,
`bash scripts/cadastrar.sh arquivo.json` cadastra o bot e mostra o endereço do webhook para colar na AvisaAPI.
