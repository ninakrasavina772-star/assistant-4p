"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

/** Боевой домен Vercel — в Google OAuth зарегистрирован только он. */
const PRODUCTION_ORIGIN = "https://assistant-4p.vercel.app";

function isVercelPreviewHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return false;
  if (hostname === "assistant-4p.vercel.app") return false;
  return hostname.endsWith(".vercel.app");
}

function LoginInner() {
  const sp = useSearchParams();
  const err = sp.get("error");
  const rawCb = sp.get("callbackUrl") || "/";
  const callbackUrl =
    rawCb.startsWith("/") && !rawCb.startsWith("//") ? rawCb : "/";
  const [previewHost, setPreviewHost] = useState(false);

  useEffect(() => {
    setPreviewHost(isVercelPreviewHost(window.location.hostname));
  }, []);

  const productionLoginHref = useMemo(
    () =>
      `${PRODUCTION_ORIGIN}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`,
    [callbackUrl]
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900 text-center mb-1">
          Ассистент контент
        </h1>
        <p className="text-sm text-slate-500 text-center mb-6">
          Войдите через Google. Доступ только для адресов из allowlist
          (ALLOWED_EMAILS).
        </p>
        {previewHost && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 mb-4 space-y-2">
            <p className="font-semibold">Это preview-деплой Vercel</p>
            <p className="text-xs leading-relaxed">
              Google OAuth настроен только для боевого адреса. С preview-ссылок
              вход даёт ошибку <code className="text-[11px]">redirect_uri_mismatch</code>
              — у каждого деплоя свой URL, его нельзя заранее добавить в Google.
            </p>
            <a
              href={productionLoginHref}
              className="inline-block w-full text-center rounded-lg bg-amber-800 text-white py-2 text-xs font-semibold hover:bg-amber-900 transition"
            >
              Войти на боевом сайте (assistant-4p.vercel.app)
            </a>
          </div>
        )}
        {err && (
          <p className="text-sm text-red-600 text-center mb-4 whitespace-pre-line">
            {err === "AccessDenied"
              ? "Доступ запрещён: ваш Google-email нет в ALLOWED_EMAILS (или список пуст). Проверьте точное совпадение адреса и что переменная задана для Production в Vercel, затем Redeploy."
              : err === "Configuration"
                ? "Ошибка конфигурации сервера: проверьте на Vercel NEXTAUTH_URL=https://assistant-4p.vercel.app, NEXTAUTH_SECRET, GOOGLE_CLIENT_ID/SECRET."
                : err === "OAuthSignin" || err === "OAuthCallback"
                  ? previewHost
                    ? "Сбой OAuth: вы на preview-деплое. Откройте боевой сайт по кнопке выше — в Google зарегистрирован только https://assistant-4p.vercel.app/api/auth/callback/google"
                    : "Сбой OAuth с Google: в Google Cloud добавьте redirect URI https://assistant-4p.vercel.app/api/auth/callback/google и проверьте NEXTAUTH_URL на Vercel."
                  : `Ошибка входа: ${err}`}
          </p>
        )}
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl })}
          disabled={previewHost}
          title={
            previewHost
              ? "Вход с preview-деплоя недоступен — используйте боевой сайт"
              : undefined
          }
          className="w-full rounded-xl bg-slate-900 text-white py-3 text-sm font-medium hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Войти с Google
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">…</div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
