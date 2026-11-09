#!/usr/bin/env bash
# Mostra os grupos do número do bot com o código (JID). Para achar um grupo: bash scripts/listar-grupos.sh | grep -i amigos
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T app npx tsx scripts/listar-grupos.ts "${1:-AVISA_TOKEN_FELIPE}"
