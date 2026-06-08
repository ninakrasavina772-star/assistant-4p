/** Сколько карточек рендерить одновременно в браузере (html2canvas). */
export const PODRUZHKA_RENDER_PARALLEL = 4;

/** Каждые N успешных ссылок — запись в Excel и скачивание партии. */
export const PODRUZHKA_RENDER_FLUSH_EVERY = 200;

export type RenderPoolRowResult = {
  row: number;
  ok: boolean;
  url?: string;
  error?: string;
  layoutVersion?: string;
};

export type RenderPoolProgress = {
  done: number;
  total: number;
  ok: number;
  fail: number;
  batchesSaved: number;
  lastBatchLinks: number;
};

export type RunPodruzhkaRenderPoolOptions<T> = {
  items: T[];
  parallel?: number;
  flushEvery?: number;
  renderOne: (item: T) => Promise<RenderPoolRowResult>;
  onProgress?: (progress: RenderPoolProgress) => void;
  /** Вызывается каждые flushEvery успешных URL (и в конце — остаток). */
  onFlush: (urls: Map<number, string>, batchIndex: number) => Promise<void>;
};

export type RunPodruzhkaRenderPoolResult = {
  allUrls: Map<number, string>;
  ok: number;
  fail: number;
  batchesSaved: number;
  errors: { row: number; error: string }[];
  flushErrors: string[];
  layoutVersion?: string;
};

/**
 * Пул воркеров: параллельный рендер + сброс партиями в Excel.
 * Прогресс и flush сериализуются — без гонок при записи в workbook.
 */
export async function runPodruzhkaRenderPool<T>(
  opts: RunPodruzhkaRenderPoolOptions<T>
): Promise<RunPodruzhkaRenderPoolResult> {
  const items = opts.items;
  const parallel = Math.max(1, opts.parallel ?? PODRUZHKA_RENDER_PARALLEL);
  const flushEvery = Math.max(1, opts.flushEvery ?? PODRUZHKA_RENDER_FLUSH_EVERY);

  const allUrls = new Map<number, string>();
  const errors: { row: number; error: string }[] = [];
  const flushErrors: string[] = [];
  let ok = 0;
  let fail = 0;
  let done = 0;
  let batchesSaved = 0;
  let lastBatchLinks = 0;
  let layoutVersion: string | undefined;

  let nextIndex = 0;
  let okSinceFlush = 0;
  const pendingFlush = new Map<number, string>();
  let flushChain = Promise.resolve();

  const emitProgress = () => {
    opts.onProgress?.({
      done,
      total: items.length,
      ok,
      fail,
      batchesSaved,
      lastBatchLinks
    });
  };

  const scheduleFlush = (batch: Map<number, string>) => {
    if (!batch.size) return;
    const batchIndex = batchesSaved + 1;
    flushChain = flushChain.then(async () => {
      batchesSaved = batchIndex;
      lastBatchLinks = batch.size;
      try {
        await opts.onFlush(batch, batchIndex);
      } catch (e) {
        flushErrors.push(e instanceof Error ? e.message : "ошибка сохранения партии Excel");
      }
      emitProgress();
    });
  };

  const onSuccess = (row: number, url: string, lv?: string) => {
    allUrls.set(row, url);
    pendingFlush.set(row, url);
    ok++;
    okSinceFlush++;
    if (lv) layoutVersion = lv;
    if (okSinceFlush >= flushEvery) {
      const batch = new Map(pendingFlush);
      pendingFlush.clear();
      okSinceFlush = 0;
      scheduleFlush(batch);
    }
  };

  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) break;
      const item = items[i]!;
      try {
        const result = await opts.renderOne(item);
        if (result.ok && result.url) {
          onSuccess(result.row, result.url, result.layoutVersion);
        } else {
          fail++;
          errors.push({ row: result.row, error: result.error ?? "ошибка рендера" });
        }
      } catch (e) {
        fail++;
        const row =
          item && typeof item === "object" && "row" in item && typeof (item as { row: unknown }).row === "number"
            ? (item as { row: number }).row
            : -1;
        errors.push({ row, error: e instanceof Error ? e.message : "ошибка рендера" });
      }
      done++;
      emitProgress();
    }
  };

  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, () => worker()));
  await flushChain;

  if (pendingFlush.size > 0) {
    const tail = new Map(pendingFlush);
    pendingFlush.clear();
    okSinceFlush = 0;
    scheduleFlush(tail);
    await flushChain;
  }

  return { allUrls, ok, fail, batchesSaved, errors, flushErrors, layoutVersion };
}
