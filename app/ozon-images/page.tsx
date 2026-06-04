import { AssistantSubpageShell } from "@/components/AssistantSubpageShell";
import { PodruzhkaOzonTool } from "@/components/PodruzhkaOzonTool";

export const metadata = {
  title: "Инфографика Подружка Ozon | Ассистент контент",
  description:
    "Инфографика для ЛК Подружка: ноты AI, сборка шаблона, публичные https-ссылки для Ozon"
};

export default function OzonImagesPage() {
  return (
    <AssistantSubpageShell
      title="Инфографика для ЛК Подружка · Ozon"
      description={
        <>
          Три шага: AI прописывает <strong>model</strong> и ноты → подстановка в шаблон{" "}
          <strong>foto 2</strong> → <strong>Foto 3</strong> с https для загрузки в Ozon.
        </>
      }
    >
      <div className="p-4 sm:p-6">
        <PodruzhkaOzonTool />
      </div>
    </AssistantSubpageShell>
  );
}
