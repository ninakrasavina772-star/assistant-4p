/** Публичный origin приложения (без завершающего /). */
export function appOrigin(): string {
  const fromPublic = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  if (fromPublic) return fromPublic.replace(/\/+$/, "");

  const auth = process.env.NEXTAUTH_URL?.trim();
  if (auth) return auth.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, "");
    return `https://${host}`;
  }

  return "";
}

/** Для UI/скриптов: origin или legacy Vercel (обратная совместимость). */
export function appOriginOrLegacy(): string {
  return appOrigin() || "https://assistant-4p.vercel.app";
}

export function googleOAuthCallbackUrl(): string {
  return `${appOriginOrLegacy()}/api/auth/callback/google`;
}

/** Preview-деплои Vercel — OAuth там не работает без отдельной регистрации URI. */
export function isVercelPreviewHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return false;
  const canonical =
    process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() ||
    process.env.NEXTAUTH_URL?.trim();
  if (canonical) {
    try {
      if (new URL(canonical).hostname === hostname) return false;
    } catch {
      /* ignore */
    }
  }
  if (hostname === "assistant-4p.vercel.app") return false;
  return hostname.endsWith(".vercel.app");
}
