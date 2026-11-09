#!/usr/bin/env bash
# Grava no .env as chaves do bot de dúvidas técnicas e reinicia o app. Rode no servidor:
#   cd /opt/bots-whatsapp && bash scripts/configurar-tecnico.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Não achei o .env. Rode antes: bash scripts/instalar-servidor.sh"; exit 1; }

# Troca (ou acrescenta) uma linha CHAVE=valor no .env
set_env() {
  local key=$1 value=$2
  grep -v "^${key}=" .env > .env.tmp || true
  printf '%s=%s\n' "$key" "$value" >> .env.tmp
  mv .env.tmp .env
}

read -rsp "Chave da Anthropic (Claude), começa com sk-ant-: " ANTHROPIC; echo
read -rp  "Endereço do Qdrant (ex.: https://xxxx.cloud.qdrant.io:6333): " QURL
read -rsp "Chave (API key) do Qdrant: " QKEY; echo

[ -n "$ANTHROPIC" ] && set_env ANTHROPIC_API_KEY "$ANTHROPIC"
[ -n "$QURL" ] && set_env QDRANT_URL "$QURL"
[ -n "$QKEY" ] && set_env QDRANT_API_KEY "$QKEY"
grep -q '^QDRANT_COLLECTION=' .env || set_env QDRANT_COLLECTION gss_base_tecnica
chmod 600 .env

echo "==> Reiniciando o app com as chaves novas"
docker compose up -d --force-recreate app

echo "==> Testando o Qdrant"
set -a; . ./.env; set +a
if curl -fsS -H "api-key: ${QDRANT_API_KEY}" "${QDRANT_URL%/}/collections/${QDRANT_COLLECTION}" | grep -o '"points_count":[0-9]*'; then
  echo "Qdrant OK."
else
  echo "!! O Qdrant não respondeu. Confira o endereço e a chave e rode este script de novo."
fi
