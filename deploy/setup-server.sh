#!/usr/bin/env bash
# Установка assistant-4p на Ubuntu 22.04/24.04 (VPS / Yandex Cloud).
# Запуск на сервере от root или через sudo:
#   curl -fsSL .../setup-server.sh | bash
# или после git clone:
#   sudo bash deploy/setup-server.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/assistant-4p}"
REPO_URL="${REPO_URL:-https://github.com/ninakrasavina772-star/assistant-4p.git}"
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:-}"

echo "==> assistant-4p self-host setup"
echo "    APP_DIR=$APP_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker..."
  apt-get update
  apt-get install -y ca-certificates curl git nginx
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

if ! command -v docker compose >/dev/null 2>&1; then
  echo "ERROR: docker compose plugin not found after Docker install"
  exit 1
fi

mkdir -p "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH" || true
fi

cd "$APP_DIR"

if [ ! -f .env.production ]; then
  cp deploy/env.production.example .env.production
  echo ""
  echo "!!! Создан $APP_DIR/.env.production из примера."
  echo "!!! Заполните секреты (YANDEX_S3_*, OPENAI, Google OAuth), затем снова:"
  echo "    sudo bash deploy/setup-server.sh"
  exit 0
fi

# Подтянуть NEXT_PUBLIC_APP_ORIGIN из NEXTAUTH_URL, если не задан
if ! grep -q '^NEXT_PUBLIC_APP_ORIGIN=' .env.production; then
  AUTH_URL=$(grep '^NEXTAUTH_URL=' .env.production | cut -d= -f2- | tr -d '"')
  echo "NEXT_PUBLIC_APP_ORIGIN=$AUTH_URL" >> .env.production
fi

set -a
# shellcheck disable=SC1091
source .env.production
set +a

echo "==> Building Docker image..."
docker compose build --pull

echo "==> Starting app..."
docker compose up -d

if [ -n "$DOMAIN" ]; then
  NGINX_SITE="/etc/nginx/sites-available/assistant-4p"
  sed "s/assistant.example.com/$DOMAIN/g" deploy/nginx-assistant.conf > "$NGINX_SITE"
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/assistant-4p
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
  if command -v certbot >/dev/null 2>&1; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "${CERTBOT_EMAIL:-admin@$DOMAIN}" || true
  else
    echo "==> Установите certbot для HTTPS: apt install certbot python3-certbot-nginx"
  fi
fi

echo ""
echo "==> Готово. Проверка:"
echo "    curl -s http://127.0.0.1:3000/api/health"
curl -sf http://127.0.0.1:3000/api/health && echo "" || echo "health check failed"
echo ""
if [ -n "${NEXTAUTH_URL:-}" ]; then
  echo "Откройте: $NEXTAUTH_URL/ozon-images"
  echo "Google OAuth redirect URI: ${NEXTAUTH_URL}/api/auth/callback/google"
fi
echo "Логи: docker compose -f $APP_DIR/docker-compose.yml logs -f"
