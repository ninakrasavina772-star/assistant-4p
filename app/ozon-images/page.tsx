import { AssistantSubpageShell } from "@/components/AssistantSubpageShell";
import { OzonImageConverter } from "@/components/OzonImageConverter";

export const metadata = {
  title: "Ссылки для Ozon | Ассистент контент",
  description:
    "Массовое преобразование http-ссылок на инфографику в https для загрузки на Ozon"
};

export default function OzonImagesPage() {
  return (
    <AssistantSubpageShell
      title="Ссылки на картинки для Ozon"
      description={
        <>
          Вставьте список ссылок с генератора инфографики (например{" "}
          <code className="rounded bg-slate-100 px-1 text-xs">http://5.35.85.200/…</code>
          ). Инструмент сделает из них ссылки с <strong>https://</strong>, которые принимает Ozon.
        </>
      }
    >
      <div className="p-4 sm:p-6">
        <OzonImageConverter />
      </div>
    </AssistantSubpageShell>
  );
}
