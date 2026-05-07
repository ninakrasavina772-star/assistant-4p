/**
 * Фирменный знак 4Partners: жёлтый скруглённый квадрат с «4», жирные «Partners»;
 * снизу — «ассистент контент». Цвета как в логотипе (жёлтый #ffd740 + чёрный).
 */
export function AssistantBrand({
  className = "",
  size = "default",
  align
}: {
  className?: string;
  size?: "default" | "compact";
  /** center — главная; left — шапка внутренних страниц */
  align?: "left" | "center";
}) {
  const a = align ?? (size === "compact" ? "left" : "center");

  const box =
    size === "compact"
      ? "h-9 w-9 min-h-9 min-w-9 text-[1.25rem] rounded-[8px] sm:h-10 sm:w-10 sm:text-[1.35rem] sm:rounded-[10px]"
      : "h-11 w-11 min-h-11 min-w-11 text-[1.6rem] rounded-[10px] sm:h-12 sm:w-12 sm:text-[1.75rem] sm:rounded-[12px]";
  const partnersClass =
    size === "compact"
      ? "text-[1.05rem] sm:text-lg"
      : "text-[1.35rem] sm:text-2xl";

  const subline =
    size === "compact"
      ? a === "center"
        ? "text-center text-[0.7rem] font-semibold leading-snug sm:text-xs"
        : "pl-11 text-[0.7rem] font-semibold leading-snug text-[var(--4p-black)]/90 sm:pl-12 sm:text-xs"
      : a === "center"
        ? "text-center text-sm font-semibold sm:text-base"
        : "pl-12 text-left text-sm font-semibold sm:text-base sm:pl-14";

  return (
    <div
      className={`flex flex-col gap-1 ${
        a === "center" ? "items-center" : "items-start"
      } ${className}`}
    >
      <div
        className={`flex items-center gap-2 sm:gap-2.5 ${
          a === "center" ? "justify-center" : ""
        }`}
      >
        <div
          className={`flex shrink-0 items-center justify-center font-bold leading-none text-[var(--4p-black)] ${box} bg-[var(--4p-yellow)]`}
          aria-hidden
        >
          4
        </div>
        <span
          className={`font-bold tracking-tight [font-feature-settings:'liga'_1] ${partnersClass} text-[var(--4p-black)]`}
        >
          Partners
        </span>
      </div>
      <div
        className={`w-full text-[var(--4p-black)]/90 max-w-md ${subline}`}
      >
        ассистент контент
      </div>
    </div>
  );
}
