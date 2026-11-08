#!/usr/bin/env bash
# Instala o núcleo dos bots num servidor Ubuntu 24.04 novo (Hetzner ou outro).
# Rode como root:  bash instalar-servidor.sh
# Pode rodar de novo: ele atualiza o código e mantém o .env que já existe.
set -euo pipefail

DIR=/opt/bots-whatsapp
REPO=github.com/felipe-fsg/bots-whatsapp

echo "==> Instalando Docker, git e firewall"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw openssl >/dev/null
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null

if [ ! -d "$DIR/.git" ]; then
  echo
  echo "O repositório é privado. Cole um token do GitHub com permissão de leitura (Contents: Read-only)."
  read -rsp "Token do GitHub: " GH_TOKEN; echo
  git clone -q "https://x-access-token:${GH_TOKEN}@${REPO}" "$DIR"
  # não deixa o token gravado no servidor
  git -C "$DIR" remote set-url origin "https://${REPO}"
else
  echo "==> Atualizando o código"
  read -rsp "Token do GitHub (para baixar a versão nova): " GH_TOKEN; echo
  git -C "$DIR" pull -q "https://x-access-token:${GH_TOKEN}@${REPO}" main
fi
cd "$DIR"

if [ ! -f .env ]; then
  IP=$(curl -fsS https://api.ipify.org)
  DOMINIO_PADRAO="${IP//./-}.sslip.io"
  echo
  echo "Domínio do servidor. Sem domínio próprio, aperte Enter para usar ${DOMINIO_PADRAO}"
  read -rp "Domínio [${DOMINIO_PADRAO}]: " DOMINIO; DOMINIO=${DOMINIO:-$DOMINIO_PADRAO}
  read -rsp "Token da AvisaAPI: " AVISA; echo
  read -rsp "Chave do Gemini (Google AI Studio): " GEMINI; echo
  read -rsp "Chave do Google Maps (Places API New): " MAPS; echo
  cat > .env <<ENV
DOMINIO=${DOMINIO}
POSTGRES_PASSWORD=$(openssl rand -hex 16)
WEBHOOK_SECRET=$(openssl rand -hex 24)
AVISA_TOKEN_FELIPE=${AVISA}
GEMINI_API_KEY=${GEMINI}
GEMINI_MODEL=gemini-flash-latest
GOOGLE_MAPS_API_KEY=${MAPS}
LOG_LEVEL=info
SCHEDULER=on
ENV
  chmod 600 .env
fi

echo "==> Subindo os serviços (a primeira vez leva alguns minutos)"
docker compose up -d --build

set -a; . ./.env; set +a
for i in $(seq 1 30); do
  curl -fsS "https://${DOMINIO}/health" >/dev/null 2>&1 && break
  sleep 5
done
if curl -fsS "https://${DOMINIO}/health" >/dev/null 2>&1; then
  echo "==> No ar: https://${DOMINIO}/health"
else
  echo "!! O endereço https://${DOMINIO} ainda não respondeu. Veja: docker compose logs --tail=50"
fi
echo
echo "Próximo passo: cadastrar o bot com o arquivo JSON (veja docs/hetzner.md)."
