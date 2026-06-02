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
          Загрузите Excel с колонкой <strong>foto 2</strong> — инструмент добавит рядом{" "}
          <strong>Foto 3</strong> с https-ссылками для Ozon. Или вставьте список ссылок вручную.
        </>
      }
    >
      <div className="p-4 sm:p-6">
        <OzonImageConverter />
      </div>
    </AssistantSubpageShell>
  );
}
