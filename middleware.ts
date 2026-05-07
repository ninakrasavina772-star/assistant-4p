import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { withAuth } from "next-auth/middleware";
import { getAuthSecret } from "./lib/auth-secret";

/**
 * withAuth ОБЯЗАН получить secret, иначе в логе GET ... error=Configuration.
 * В Edge часто нет env из .env — передаём тот же секрет, что в lib/auth.
 */
const auth = withAuth({
  pages: { signIn: "/login" },
  secret: getAuthSecret()
});

/** В Edge иногда нет COMPARE_SKIP_AUTH; на localhost в dev пускаем без проверки cookie */
function devSkipAuth(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== "development") {
    return false;
  }
  if (process.env.COMPARE_SKIP_AUTH === "1") {
    return true;
  }
  const h = req.nextUrl.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (devSkipAuth(req)) {
    return NextResponse.next();
  }
  return auth(req as Parameters<typeof auth>[0], event);
}

/** /compare и /compare/... — иначе часть запросов обходила бы middleware */
export const config = { matcher: ["/compare/:path*"] };
