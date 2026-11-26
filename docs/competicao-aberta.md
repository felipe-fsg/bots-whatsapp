# Competição aberta de treinos (bot fitness)

Variação do desafio fitness para a turma engajar postando treino, alimentação etc.
Só para grupos com o bot **fitness** (`#ativarbot fitness`).

| Comando | Quem | O que faz |
|---|---|---|
| `#monitorartreinos` | admins | Liga a competição aberta. Copia categorias, pontos e regras (localização, limite semanal, IA nas fotos) do último desafio do grupo; se nunca houve, usa #treino 3, #comida 1, #agua 1, #cardio 1 e #pose desligada. |
| `#ficargostoso` / `#ficargostosa` | todos | Entra na competição a qualquer momento (nome = nome do WhatsApp). |
| `#desativarparabens` / `#ativarparabens` | admins | Desliga / liga os parabéns das 6h (padrão: ligado). |
| `#pararmonitoramento` | admins | Encerra. Inscritos e pontos ficam guardados; `#monitorartreinos` de novo continua de onde parou. |

- Pontuação igual à competição individual (1 foto por categoria por dia, foto repetida não vale etc.). Sem duplas nem equipes: `#equipes` e `#equipe` avisam isso.
- Às 6h o mascote parabeniza quem teve a maior pontuação do dia anterior (empate: todos), marcando pelo telefone + "(*Nome*)". Se ninguém pontuou, não manda nada. A IA recebe só nomes e categorias, nunca telefones.
- Resumo das 4h e mensagens ao longo do dia começam desligados; os admins ligam com `#ativar resumo` / `#ativar mensagens`.
- Não liga por cima de uma competição normal em andamento (só uma por vez por grupo).
- Banco: migração `018_competicao_aberta.sql` (colunas `open_mode` e `daily_congrats` em `splinter_challenges`).
- `#ajuda` mostra só os comandos gerais; tudo do tema fitness (check-in, ranking, competição, comandos de admin do desafio) fica no `#regras`, que funciona mesmo sem competição cadastrada.
