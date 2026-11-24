# Colocar o bot em outro grupo

O mesmo número de WhatsApp atende vários grupos. O webhook da AvisaAPI não muda.

## Jeito rápido: comando no grupo

Com o número do bot no grupo, mande **do próprio número do bot** (ou de um telefone listado em
`BOT_DONOS` no `.env`):

- `#ativarbot social` (ou `#habilitarbot social`): grupo de conversa (módulo `geral`)
- `#ativarbot fitness`: desafio fitness (módulo `splinter`)
- `#ativarbot duvidas tecnicas`: grupo de trabalho (módulo `tecnico`)
- `#desativarbot`: desliga o bot no grupo (os dados ficam guardados)

O bot responde na hora. Viram admins do bot quem mandou o comando e os admins do grupo no WhatsApp
(quando a AvisaAPI mostra o telefone deles). Mandar outro tipo troca o módulo do grupo.
No fitness, as fotos só valem pontos depois de cadastrar o desafio pelo arquivo JSON (passos abaixo).
Quem não é dono e manda o comando é ignorado.

## Jeito completo: arquivo JSON

1. Adicione o número do bot ao grupo (pelo WhatsApp, como qualquer participante).
2. No servidor, descubra o código do grupo:
   ```bash
   cd /opt/bots-whatsapp
   bash scripts/listar-grupos.sh | grep -i "parte do nome do grupo"
   ```
   O código é o que termina em `@g.us`.
3. Copie `seed/exemplo-geral.json`, troque `grupo` pelo código, o `nome` do bot e os `admins`.
   Para um desafio fitness, use `seed/exemplo-splinter.json`.
4. Cadastre: `bash scripts/cadastrar.sh /root/arquivo.json`. Em até 30 segundos o bot passa a responder no grupo.

Tipos de bot (`modulo`):

| Módulo | Para quê | O que tem |
|---|---|---|
| `geral` | grupo de conversa, amigos, rolês | #resumo, #agenda, #mascote, #motivação, ?pesquisa, #ajuda |
| `splinter` | desafio fitness | tudo do geral + check-ins, ranking, equipes, ?alimento |
| `tecnico` | grupo de trabalho (dúvidas técnicas) | /duvida com a base técnica, revisão dos sêniores, #resumo, #agenda |
