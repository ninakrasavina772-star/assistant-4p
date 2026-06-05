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
          Три шага: заполнить <strong>model</strong> и свойства <strong>benefit 1–3</strong> →
          подстановка в шаблон <strong>foto 2</strong> → <strong>Foto 3</strong> с https для
          загрузки в Ozon. Те же правила вёрстки и фото, что у ароматов.
        </>
      }
    >
      <div className="p-4 sm:p-6">
        <PodruzhkaCosmeticsOzonTool />
      </div>
    </AssistantSubpageShell>
  );
}
