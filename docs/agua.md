# Bot de qualidade da água

Grupo **profissional**. O bot é uma peça da automação de laudos (outro sistema): ele só cuida da parte do WhatsApp.

1. O sistema de laudos manda o resultado para o bot.
2. O bot posta no grupo: laudo satisfatório pede autorização para enviar ao cliente; insatisfatório vira alerta e pede autorização para seguir (encerrar a OS, abrir recoleta, avisar o cliente).
3. Um admin do bot responde à mensagem do laudo com `#aprovar` ou `#recusar motivo`.
4. O bot avisa o sistema (webhook de retorno) e guarda a decisão para consulta.

Email, Neovero, planilha e dashboard ficam no sistema de laudos.

## Ligar no grupo

No grupo, o dono do bot manda `#ativarbot qualidade agua`. Quem mandou e os admins do grupo viram admins do bot (são eles que aprovam). `#promover @pessoa` / `#demover @pessoa` ajustam depois.

No `.env` do servidor:

```
AGUA_API_KEY=<openssl rand -hex 24>
AGUA_CALLBACK_URL=https://sistema-de-laudos/retorno   # opcional
```

Depois de mudar o `.env`: `docker compose up -d --force-recreate app`.

## Enviar um laudo

```
POST https://<servidor>/api/agua/laudos
Authorization: Bearer <AGUA_API_KEY>
Content-Type: application/json

{
  "id": "L-2026-001",                  // obrigatório, código do laudo no seu sistema
  "resultado": "satisfatorio",          // ou "insatisfatorio"
  "cliente": "Clínica Rim Feliz",
  "equipamento": "Osmose reversa OR-02",
  "os": "12345",
  "data_coleta": "20/11/2026",
  "parametros": [{ "nome": "Bactérias", "valor": "12 UFC/mL", "limite": "100", "ok": true }],
  "resumo": "texto livre",
  "link": "https://.../laudo.pdf",
  "callback_url": "https://.../retorno", // opcional; sem ele usa AGUA_CALLBACK_URL
  "grupo": "1203...@g.us"               // só se houver mais de um grupo de qualidade da água
}
```

Resposta `201` (novo) ou `200` (o mesmo `id` já tinha chegado: não posta de novo):

```
{ "ok": true, "novo": true, "laudo": { "id": "L-2026-001", "resultado": "satisfatorio", "status": "pendente", ... } }
```

## Saber a decisão

Duas formas, use a que preferir:

**Webhook de retorno.** Quando um admin decide, o bot faz `POST` no `callback_url` do laudo (ou `AGUA_CALLBACK_URL`) com o cabeçalho `Authorization: Bearer <AGUA_API_KEY>`:

```
{ "id": "L-2026-001", "resultado": "satisfatorio", "status": "aprovado",
  "decidido_por": "Emerson", "decidido_em": "2026-11-24T12:00:00.000Z", "motivo": null, "retorno": null }
```

Se o sistema não responder 2xx, o bot avisa no grupo e não tenta de novo; a consulta abaixo continua valendo.

**Consulta de status.**

```
GET https://<servidor>/api/agua/laudos/L-2026-001
Authorization: Bearer <AGUA_API_KEY>
```

`status` é `pendente`, `aprovado` ou `recusado`. `retorno` diz se o webhook deu certo (`ok`, `falhou: ...` ou `null` sem endereço).

## Comandos no grupo

- `#pendentes` - laudos esperando autorização
- `#aprovar` / `#recusar motivo` (admins) - respondendo à mensagem do laudo, ou com o código: `#recusar L-2026-001 aguardar contraprova`. Se só houver um pendente, o código pode ser omitido.
- `#ajuda`
