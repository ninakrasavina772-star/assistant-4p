#!/usr/bin/env bash
# Скачать production-переменные с Vercel в .env.production (нужен vercel login).
set -euo pipefail
cd "$(dirname "$0")/.."
npx vercel env pull .env.production --environment=production --yes
if ! grep -q '^NEXT_PUBLIC_APP_ORIGIN=' .env.production 2>/dev/null; then
  AUTH_URL=$(grep '^NEXTAUTH_URL=' .env.production | cut -d= -f2- | tr -d '"')
  echo "NEXT_PUBLIC_APP_ORIGIN=$AUTH_URL" >> .env.production
fi
echo "OK → .env.production (проверьте NEXTAUTH_URL на новый домен перед деплоем)"
