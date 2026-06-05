import { AssistantSubpageShell } from "@/components/AssistantSubpageShell";
import { PodruzhkaCosmeticsOzonTool } from "@/components/PodruzhkaCosmeticsOzonTool";

export const metadata = {
  title: "Инфографика Подружка Ozon — косметика | Ассистент контент",
  description:
    "Инфографика для ЛК Подружка (косметика): свойства benefit 1–3, сборка шаблона, публичные https-ссылки для Ozon"
};

export default function OzonCosmeticsPage() {
  return (
    <AssistantSubpageShell
      title="Инфографика для ЛК Подружка · Ozon косметика"
      description={
        <>
          Три шага: AI-категорийный менеджер заполняет <strong>model</strong> и{" "}
          <strong>benefit 1–3</strong> → шаблон <strong>foto 2</strong> → <strong>Foto 3</strong> для
          Ozon. Макет как у ароматов, без объёма на карточке.
        </>
      }
    >
      <div className="p-4 sm:p-6">
        <PodruzhkaCosmeticsOzonTool />
      </div>
    </AssistantSubpageShell>
  );
}
