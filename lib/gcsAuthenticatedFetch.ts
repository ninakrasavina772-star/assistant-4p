import { createSign } from "crypto";

type ServiceAccount = {
  client_email: string;
  private_key: string;
};

let cachedToken: { token: string; exp: number } | null = null;

function parseServiceAccount(): ServiceAccount | null {
  const raw = process.env.GCS_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    return null;
  }
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

async function getGoogleAccessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/devstorage.read_only",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    })
  );
  const signInput = `${header}.${claim}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = sign.sign(sa.private_key.replace(/\\n/g, "\n"));
  const jwt = `${signInput}.${base64url(signature)}`;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
      signal: AbortSignal.timeout(20_000)
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) return null;
    cachedToken = { token: json.access_token, exp: now + 3500 };
    return json.access_token;
  } catch {
    return null;
  }
}

/** Скачать объект из приватного GCS (tradeinn-images и др.) при наличии credentials. */
export async function fetchGcsObjectAuthenticated(url: string): Promise<Buffer | null> {
  if (!/storage\.googleapis\.com/i.test(url)) return null;

  const staticToken = process.env.GCS_ACCESS_TOKEN?.trim();
  const sa = parseServiceAccount();
  const token = staticToken || (sa ? await getGoogleAccessToken(sa) : null);
  if (!token) return null;

  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "image/*,*/*;q=0.8"
      }
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length >= 512 ? buf : null;
  } catch {
    return null;
  }
}
