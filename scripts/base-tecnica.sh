#!/usr/bin/env bash
# Base de conhecimento do bot técnico (Qdrant). Rode no servidor, na pasta /opt/bots-whatsapp:
#   bash scripts/base-tecnica.sh status                       -> quantas fichas H, C e M existem
#   bash scripts/base-tecnica.sh carregar /root/arquivo.json  -> grava as fichas que ainda não estão lá
# Para mandar o arquivo do Windows para o servidor (no PowerShell):
#   scp C:\caminho\arquivo.json root@135.181.203.52:/root/
set -euo pipefail
cd "$(dirname "$0")/.."
CMD=${1:?Use: status ou carregar arquivo.json}
shift || true
if [ "$CMD" = "carregar" ]; then
  [ $# -gt 0 ] || { echo "Informe o(s) arquivo(s) JSON"; exit 1; }
  ARGS=()
  for f in "$@"; do
    dest="/tmp/carga-$(basename "$f")"
    docker compose cp "$f" "app:$dest"
    ARGS+=("$dest")
  done
  docker compose exec app npx tsx scripts/base-tecnica.ts carregar "${ARGS[@]}"
  docker compose exec app sh -c 'rm -f /tmp/carga-*'
else
  docker compose exec app npx tsx scripts/base-tecnica.ts "$CMD"
fi
