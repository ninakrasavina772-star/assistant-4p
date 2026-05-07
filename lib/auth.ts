import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { getAuthSecret } from "./auth-secret";

function allowlist(): string[] {
  return (process.env.ALLOWED_EMAILS || "")
    .replace(/^\uFEFF/, "")
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function oauthEmail(
  user: { email?: string | null },
  profile: unknown
): string | undefined {
  const fromProfile =
    profile &&
    typeof profile === "object" &&
    "email" in profile &&
    typeof (profile as { email?: unknown }).email === "string"
      ? (profile as { email: string }).email
      : undefined;
  return (user.email || fromProfile || undefined)?.toLowerCase();
}

/** Без Google в .env вход отключён; провайдер-заглушка не даёт NextAuth упасть при старте. */
function buildProviders() {
  const gid = process.env.GOOGLE_CLIENT_ID?.trim();
  const gsec = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (gid && gsec) {
    return [
      GoogleProvider({
        clientId: gid,
        clientSecret: gsec
      })
    ];
  }
  return [
    CredentialsProvider({
      id: "dev-placeholder",
      name: "Dev",
      credentials: {},
      async authorize() {
        return null;
      }
    })
  ];
}

export const authOptions: NextAuthOptions = {
  providers: buildProviders(),
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  secret: getAuthSecret(),
  callbacks: {
    async signIn({ user, profile }) {
      if (process.env.DEBUG_ALLOW_ANY_GOOGLE === "1" && process.env.NODE_ENV === "development") {
        return true;
      }
      const emails = allowlist();
      if (emails.length === 0) {
        // Без allowlist — вход закрыт (см. .env.local пример: ALLOWED_EMAILS или DEBUG для dev)
        return false;
      }
      const email = oauthEmail(user, profile);
      if (!email) return false;
      return emails.includes(email);
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = (token.email as string) || session.user.email;
      }
      return session;
    },
    async jwt({ token, user, account, profile }) {
      if (account && user) {
        token.email = oauthEmail(user, profile) ?? user.email;
      }
      return token;
    }
  }
};
