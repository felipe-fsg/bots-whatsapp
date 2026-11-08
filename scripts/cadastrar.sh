#!/usr/bin/env bash
# Cadastra ou atualiza um bot a partir de um arquivo JSON. Rode no servidor, na pasta /opt/bots-whatsapp:
#   bash scripts/cadastrar.sh /root/splinter.json
set -euo pipefail
FILE=${1:?Informe o arquivo JSON}
cd "$(dirname "$0")/.."
docker compose cp "$FILE" app:/tmp/cadastro.json
docker compose exec app npx tsx scripts/seed-splinter.ts /tmp/cadastro.json
docker compose exec app rm -f /tmp/cadastro.json
