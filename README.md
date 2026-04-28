# Сравнение рубрик (4Partners)

Веб-интерфейс: два **id рубрик** с **двух витрин** (два токена API), сопоставление:

1. сначала по **EAN**;
2. затем **кандидаты по названию** (язык EN или RU — переключатель), жадный подбор по похожести строк (порог в `lib/match.ts`).

**Доступ:** обычно вход через Google и список `ALLOWED_EMAILS`.

**Проще на первый раз (только у себя, `npm run dev`):** в `.env.local` добавьте строку `COMPARE_SKIP_AUTH=1` — страница `/compare` откроется **без Google**; на боевой сервер так не выкладывайте. Нужны только токены 4Partners.

**Токены 4Partners:** можно **вставлять в форму** (удобно при работе с разными витринами) или задать в **`.env.local`**. Сохранение в **sessionStorage** (опция в форме) — до закрытия окна браузера. На проде — только **HTTPS**; чужой скрипт на странице теоретически может прочитать сессию (как с любым секретом в браузере).

## Запуск

```bash
cd compare
npm install
copy .env.local.example .env.local
# Заполните NEXTAUTH_SECRET, Google OAuth, ALLOWED_EMAILS, FOURPARTNERS_TOKEN_A / FOURPARTNERS_TOKEN_B
npm run dev
```

Откройте [http://localhost:3000/compare](http://localhost:3000).

## Google Cloud

1. Проект → APIs & Services → Credentials → OAuth 2.0 Client (Web).
2. Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google` (и production-URL при выкладке).

## Другие провайдеры (Microsoft, GitHub)

В `lib/auth.ts` можно добавить провайдеры из [next-auth providers](https://next-auth.js.org/configuration/providers); allowlist по email остаётся тем же.

## Деплой

Подойдёт [Vercel](https://vercel.com) или любой Node-хостинг: задать те же переменные окружения, `NEXTAUTH_URL` на боевой домен.

API: [Partner Site API V1](https://api.4partners.io/v1/doc/index.json).
