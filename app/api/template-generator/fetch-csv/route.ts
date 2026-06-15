import https from "node:https";
import { NextResponse } from "next/server";

export const maxDuration = 60;

/** Через API можно проксировать только небольшие CSV (лимит ответа Vercel). */
const MAX_PROXY_BYTES = 12 * 1024 * 1024;

const INSECURE_TLS_HOSTS = [/\.4partners\.io$/i, /^yandex\.market\.4partners\.io$/i];

function filenameFromUrl(url: string): string {
  try {
    const p = new URL(url).pathname;
    const base = p.split("/").filter(Boolean).pop();
    return base || "feed.csv";
  } catch {
    return "feed.csv";
  }
}

function needsInsecureTls(hostname: string): boolean {
  return INSECURE_TLS_HOSTS.some((re) => re.test(hostname));
}

function fetchInsecureHttps(url: string, redirects = 0): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    if (redirects > 8) {
      reject(new Error("Слишком много редиректов"));
      return;
    }
    const req = https.get(
      url,
      {
        rejectUnauthorized: false,
        headers: {
          Accept: "text/csv,text/plain,application/csv,*/*",
          "User-Agent": "assistant-4p-template-generator/1.0"
        }
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          fetchInsecureHttps(next, redirects + 1).then(resolve).catch(reject);
          return;
        }

        const len = Number(res.headers["content-length"] ?? 0);
        if (len > MAX_PROXY_BYTES) {
          res.resume();
          reject(
            new Error(
              `Фид слишком большой (${Math.round(len / 1024 / 1024)} МБ). Скачайте CSV в браузере и загрузите кнопкой «Загрузить файл».`
            )
          );
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_PROXY_BYTES) {
            req.destroy();
            reject(
              new Error(
                `Фид больше ${Math.round(MAX_PROXY_BYTES / 1024 / 1024)} МБ. Скачайте CSV вручную и загрузите файлом.`
              )
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.setTimeout(55_000, () => {
      req.destroy();
      reject(new Error("Таймаут загрузки CSV (55 с)"));
    });
  });
}

async function downloadCsv(url: URL): Promise<Buffer> {
  if (needsInsecureTls(url.hostname)) {
    const { status, body } = await fetchInsecureHttps(url.toString());
    if (status < 200 || status >= 300) {
      throw new Error(`Не удалось скачать CSV: HTTP ${status}`);
    }
    if (!body.length) throw new Error("Файл пустой");
    return body;
  }

  const res = await fetch(url.toString(), {
    redirect: "follow",
    signal: AbortSignal.timeout(55_000),
    headers: {
      Accept: "text/csv,text/plain,application/csv,*/*",
      "User-Agent": "assistant-4p-template-generator/1.0"
    }
  });

  if (!res.ok) {
    throw new Error(`Не удалось скачать CSV: HTTP ${res.status}`);
  }

  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_PROXY_BYTES) {
    throw new Error(
      `Фид слишком большой (${Math.round(len / 1024 / 1024)} МБ). Скачайте CSV в браузере и загрузите кнопкой «Загрузить файл».`
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("Файл пустой");
  if (buf.length > MAX_PROXY_BYTES) {
    throw new Error(
      `Фид больше ${Math.round(MAX_PROXY_BYTES / 1024 / 1024)} МБ. Скачайте CSV вручную и загрузите файлом.`
    );
  }
  return buf;
}

function humanFetchError(e: unknown, hostname: string): string {
  const msg = e instanceof Error ? e.message : "Ошибка загрузки";
  if (/fetch failed/i.test(msg) && needsInsecureTls(hostname)) {
    return `Не удалось скачать с ${hostname} (проблема SSL сертификата или сеть). Скачайте CSV в браузере по ссылке и загрузите кнопкой «Загрузить файл».`;
  }
  if (/fetch failed/i.test(msg)) {
    return `Сервер не достучался до ссылки (${hostname}). Проверьте URL или загрузите CSV файлом.`;
  }
  return msg;
}

export async function POST(req: Request) {
  let body: { url?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const raw = String(body.url ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "Укажите ссылку на CSV" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Некорректная ссылка" }, { status: 400 });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Допустимы только http/https ссылки" }, { status: 400 });
  }

  try {
    const buf = await downloadCsv(parsed);
    const text = buf.toString("utf8");
    return NextResponse.json({
      text,
      label: filenameFromUrl(parsed.toString()),
      bytes: buf.length
    });
  } catch (e) {
    return NextResponse.json(
      { error: humanFetchError(e, parsed.hostname) },
      { status: 502 }
    );
  }
}
