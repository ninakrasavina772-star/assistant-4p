import type { OzonUrlRow } from "@/lib/ozonImageUrls";

const BATCH_SIZE = 80;

type ConvertOptions = {
  mode: "replace" | "rehost";
  oldBase?: string;
  newBase?: string;
};

export async function convertUrlsBatch(
  urls: string[],
  options: ConvertOptions,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, OzonUrlRow>> {
  const unique = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  const map = new Map<string, OzonUrlRow>();
  let done = 0;

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const chunk = unique.slice(i, i + BATCH_SIZE);
    const res = await fetch("/api/ozon-images/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: options.mode,
        urls: chunk,
        oldBase: options.mode === "replace" ? options.oldBase : undefined,
        newBase: options.mode === "replace" ? options.newBase : undefined
      })
    });
    const data = (await res.json()) as { error?: string; rows?: OzonUrlRow[] };
    if (!res.ok) {
      throw new Error(data.error ?? `Ошибка ${res.status}`);
    }
    for (const row of data.rows ?? []) {
      map.set(row.input, row);
    }
    done += chunk.length;
    onProgress?.(done, unique.length);
  }

  return map;
}
