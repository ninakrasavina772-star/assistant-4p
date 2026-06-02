const PRIVATE_IP =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|localhost$)/i;

export type OzonUrlRow = {
  input: string;
  output: string;
  ok: boolean;
  error?: string;
};

/** Одна ссылка на строку; пустые и комментарии (#) пропускаем */
export function parseUrlList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const url = line.split(/\s+/)[0]!;
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

export function normalizeBase(base: string): string {
  return base.trim().replace(/\/+$/, "");
}

/** Замена префикса: http://5.35.85.200 → https://cdn.example.com */
export function replaceUrlBase(
  url: string,
  oldBase: string,
  newBase: string
): { output: string; ok: boolean; error?: string } {
  const oldNorm = normalizeBase(oldBase);
  const newNorm = normalizeBase(newBase);
  if (!oldNorm || !newNorm) {
    return { output: url, ok: false, error: "Укажите старый и новый адрес" };
  }
  if (!url.startsWith(oldNorm)) {
    return {
      output: url,
      ok: false,
      error: `Ссылка не начинается с ${oldNorm}`
    };
  }
  const suffix = url.slice(oldNorm.length);
  const output = `${newNorm}${suffix}`;
  if (!output.startsWith("https://")) {
    return {
      output,
      ok: false,
      error: "Новая ссылка должна быть https:// (Ozon не принимает http)"
    };
  }
  return { output, ok: true };
}

export function replaceUrlList(
  urls: string[],
  oldBase: string,
  newBase: string
): OzonUrlRow[] {
  return urls.map((input) => {
    const r = replaceUrlBase(input, oldBase, newBase);
    return { input, output: r.output, ok: r.ok, error: r.error };
  });
}

export function isAllowedImageHost(hostname: string, allowedHosts: string[]): boolean {
  const h = hostname.toLowerCase();
  return allowedHosts.some((a) => a.toLowerCase() === h);
}

export function assertFetchableImageUrl(
  url: string,
  allowedHosts: string[]
): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Некорректный URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Только http:// или https://");
  }
  if (PRIVATE_IP.test(parsed.hostname)) {
    throw new Error("Запрещённый адрес (локальная сеть)");
  }
  if (!isAllowedImageHost(parsed.hostname, allowedHosts)) {
    throw new Error(`Хост ${parsed.hostname} не в списке разрешённых`);
  }
  return parsed;
}

export function filenameFromUrl(url: string): string {
  const path = new URL(url).pathname;
  const base = path.split("/").filter(Boolean).pop() ?? "image.jpg";
  return base.replace(/[^\w.\-]/g, "_") || "image.jpg";
}

export function defaultAllowedHosts(): string[] {
  const fromEnv = process.env.OZON_IMAGE_ALLOWED_HOSTS?.split(/[,;\s]+/).filter(Boolean);
  if (fromEnv?.length) return fromEnv;
  return ["5.35.85.200"];
}

export function defaultOldBase(): string {
  return process.env.OZON_IMAGE_HTTP_BASE?.trim() || "http://5.35.85.200";
}
