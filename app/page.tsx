import Image from "next/image";
import Link from "next/link";
import { AssistantBrand } from "@/components/AssistantBrand";
import { HomeUserProjects } from "@/components/HomeUserProjects";
import {
  homeCard,
  homeCardHeader,
  homeCardTitle,
  homeContainer,
  homeIconBox,
  homeLinkRow,
  homePageBg
} from "@/components/homeTheme";

const tools: { href: string; title: string; emoji: string }[] = [
  { href: "/compare", title: "Сравнение витрин и поиск дублей", emoji: "📊" },
  { href: "/size-table", title: "Создать размерную таблицу", emoji: "📏" },
  { href: "/prices-stock", title: "Выгрузка цен и остатков", emoji: "💹" }
];

export default function AssistantHome() {
  return (
    <div className={homePageBg}>
      <div className={`${homeContainer} flex min-h-0 flex-col`}>
        <div className="mb-8 w-full sm:mb-10">
          <AssistantBrand align="center" />
        </div>

        <section className={homeCard} aria-hidden>
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-1.5 sm:p-2">
            <div className="overflow-hidden rounded-[0.7rem] sm:rounded-[0.85rem]">
              <div className="relative">
                <Image
                  src="/assistant-hero.png"
                  alt=""
                  width={800}
                  height={500}
                  className="h-auto w-full object-cover"
                  style={{
                    filter:
                      "saturate(0.75) contrast(1.05) sepia(0.12) hue-rotate(6deg) brightness(1.03)"
                  }}
                  priority
                  sizes="(max-width: 640px) 100vw, 36rem"
                />
                <div
                  className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/20 via-[#ffd740]/5 to-transparent"
                  aria-hidden
                />
              </div>
            </div>
          </div>
        </section>

        <h1 className="mb-1 text-center text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Чем могу помочь?
        </h1>
        <p className="mb-6 text-center text-sm text-slate-500 sm:mb-8">
          Инструменты 4Partners в одном месте
        </p>

        <section className={homeCard} aria-label="Инструменты">
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Открыть сценарий</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {tools.map((it) => (
              <li key={it.href}>
                <Link href={it.href} className={homeLinkRow}>
                  <span
                    className={homeIconBox}
                    style={{ background: "var(--4p-yellow, #ffd740)" }}
                    aria-hidden
                  >
                    {it.emoji}
                  </span>
                  <span className="min-w-0 flex-1 text-left text-[0.95rem] font-semibold leading-snug text-slate-900 sm:text-base">
                    {it.title}
                  </span>
                  <span
                    className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500"
                    aria-hidden
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className={homeCard} aria-label="Скоро в ассистенте">
          <div className={homeCardHeader}>
            <h2 className={homeCardTitle}>Скоро</h2>
          </div>
          <p className="text-sm leading-relaxed text-slate-600 sm:text-[0.95rem] px-4 py-4 sm:px-5 sm:py-4">
            <span className="font-medium text-slate-800">Обновление по шаблону</span>
            <span className="text-slate-500">
              {" "}
              — вынесем в отдельный сценарий позже, следите за разделом.
            </span>
          </p>
        </section>

        <HomeUserProjects />
      </div>
    </div>
  );
}
