# Colocar o bot em outro grupo

O mesmo número de WhatsApp atende vários grupos. O webhook da AvisaAPI não muda.

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
| `geral` | grupo de conversa, amigos, rolês | #resumo, #agenda, #mascote, #motivação, #ajuda |
| `splinter` | desafio fitness | tudo do geral + check-ins, ranking, equipes, ?alimento |
