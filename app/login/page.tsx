"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginInner() {
  const sp = useSearchParams();
  const err = sp.get("error");
  const rawCb = sp.get("callbackUrl") || "/";
  const callbackUrl =
    rawCb.startsWith("/") && !rawCb.startsWith("//") ? rawCb : "/";
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
        {err && (
          <p className="text-sm text-red-600 text-center mb-4 whitespace-pre-line">
            {err === "AccessDenied"
              ? "Доступ запрещён: ваш Google-email нет в ALLOWED_EMAILS (или список пуст). Проверьте точное совпадение адреса и что переменная задана для Production и Preview в Vercel, затем Redeploy."
              : err === "Configuration"
                ? "Ошибка конфигурации сервера: проверьте на Vercel NEXTAUTH_URL (как в адресной строке), NEXTAUTH_SECRET, GOOGLE_CLIENT_ID/SECRET и redirect URI в Google Cloud."
                : err === "OAuthSignin" || err === "OAuthCallback"
                  ? "Сбой OAuth с Google: проверьте redirect URI в консоли Google (…/api/auth/callback/google) и что он совпадает с NEXTAUTH_URL."
                  : `Ошибка входа: ${err}`}
          </p>
        )}
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl })}
          className="w-full rounded-xl bg-slate-900 text-white py-3 text-sm font-medium hover:bg-slate-800 transition"
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
