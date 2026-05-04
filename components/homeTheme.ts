/**
 * Единая стилистика главной ассистента: карточки, шапки секций, кнопки.
 */
export const homePageBg =
  "min-h-screen w-full bg-gradient-to-b from-slate-100/90 via-[#f0f0f3] to-slate-200/40 text-slate-900 antialiased";

export const homeContainer = "mx-auto w-full max-w-lg px-4 py-8 sm:max-w-xl sm:px-6 sm:py-10 md:max-w-2xl";

/** Основная «плитка» проекта: одна визуальная система для всех блоков */
export const homeCard =
  "mb-6 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm shadow-slate-200/60 ring-1 ring-slate-200/40 last:mb-0 sm:mb-8";

export const homeCardHeader =
  "border-b border-slate-100 bg-gradient-to-r from-amber-50/90 to-white px-4 py-3 sm:px-5";

export const homeCardTitle =
  "text-xs font-semibold uppercase tracking-[0.14em] text-slate-500";

export const homeCardBody = "px-4 py-4 sm:px-5 sm:py-5";

export const homeCardBodyCompact = "px-4 py-3 sm:px-5 sm:py-3.5";

export const homeInput =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-200/40";

export const homeBtnPrimary =
  "rounded-lg bg-[#ffd740] px-4 py-2.5 text-sm font-semibold text-[#0a0a0a] shadow-sm ring-1 ring-black/5 transition hover:bg-[#f5cd38] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50";

export const homeLinkRow =
  "group flex items-center gap-3.5 px-4 py-3.5 transition sm:px-5 sm:py-4 hover:bg-amber-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 focus-visible:ring-inset";

export const homeIconBox =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg shadow-sm ring-1 ring-black/[0.06]";

// --- Подстраницы ассистента (размеры, обменник) и тяжёлые формы (сравнение) ---

export const appSubpageRoot = homePageBg;

export const appSubpageContainer5xl =
  "mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8";

/** Сравнение: шире + запас снизу под фикс-нав */
export const appSubpageContainer6xl =
  "mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 pb-20";

export const appSubpageHeaderRow =
  "mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between";

export const appSubpageBackLink =
  "text-sm font-medium text-slate-600 underline decoration-slate-300/80 underline-offset-2 transition hover:text-slate-900";

export const appSubpageTitle =
  "mb-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl";

export const appSubpageDescription = "mb-4 max-w-2xl text-sm leading-relaxed text-slate-600";

export const appEmbedFrame =
  "overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm shadow-slate-200/50 ring-1 ring-slate-200/40";

export const appIframeTall =
  "h-[calc(100dvh-14rem)] w-full min-h-[680px] border-0 sm:min-h-[720px]";

/** Узкая колонка формы (контент-ассистент) */
export const compareFormNarrow =
  "mx-auto w-full max-w-3xl space-y-8";

/** Форма / блок отчёта: та же плитка, что homeCard, без `overflow-hidden` (удобнее для длинного контента) */
export const appSectionCard =
  "mb-8 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm ring-1 ring-slate-200/40 sm:p-6 last:mb-0";

export const appCompareHeaderCard =
  "mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm ring-1 ring-slate-200/40 sm:p-6";
