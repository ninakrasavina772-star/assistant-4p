import { defaultAllowedHosts, isAllowedImageHost } from "@/lib/ozonImageUrls";

const PRIVATE_IP =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|localhost$)/i;

const OZON_HOST_HINT = /ozon|ozone/i;

function canFetchHost(hostname: string): boolean {
  if (PRIVATE_IP.test(hostname)) return false;
  const allowed = defaultAllowedHosts();
  if (isAllowedImageHost(hostname, allowed)) return true;
  if (OZON_HOST_HINT.test(hostname)) return true;
  return true;
}

export type FotoFetchResult = { buf: Buffer | null; error?: string };

/** Скачивание foto из фида (5.35.85.200, Ozon CDN, https) */
export async function fetchPodruzhkaProductImageDetailed(url: string): Promise<FotoFetchResult> {
  const u = url?.trim();
  if (!u) return { buf: null, error: "Пустая ссылка foto" };

  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return { buf: null, error: "Некорректный URL в foto" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { buf: null, error: "foto: только http/https" };
  }
  if (!canFetchHost(parsed.hostname)) {
    return { buf: null, error: `foto: хост не разрешён (${parsed.hostname})` };
  }

  try {
    const res = await fetch(u, {
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        ...(OZON_HOST_HINT.test(parsed.hostname)
          ? { Referer: "https://www.ozon.ru/" }
          : {})
      }
    });
    if (!res.ok) {
      return { buf: null, error: `foto: HTTP ${res.status}` };
    }
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct && !ct.includes("image") && !ct.includes("octet-stream")) {
      return { buf: null, error: `foto: не картинка (${ct || "нет типа"})` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return { buf: null, error: "foto: пустой ответ" };
    return { buf };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "сеть";
    return { buf: null, error: `foto: ${msg}` };
  }
}

export async function fetchPodruzhkaProductImage(url: string): Promise<Buffer | null> {
  const r = await fetchPodruzhkaProductImageDetailed(url);
  return r.buf;
}
