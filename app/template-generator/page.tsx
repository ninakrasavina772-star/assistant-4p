import { AssistantSubpageShell } from "@/components/AssistantSubpageShell";
import { TemplateGeneratorTool } from "@/components/TemplateGeneratorTool";

export const metadata = {
  title: "Генератор шаблонов | Ассистент контент",
  description:
    "Загрузка Excel-шаблона маркетплейса, выбор вкладки и столбцов, AI-заполнение характеристик и доп. фото"
};

export default function TemplateGeneratorPage() {
  return (
    <AssistantSubpageShell
      title="Генератор шаблонов"
      description={
        <>
          Загрузите шаблон Excel и CSV, общайтесь с ассистентом в чате — он запомнит задание.
          Ниже выберите столбцы и нажмите «Запустить AI».
        </>
      }
    >
      <div className="p-4 sm:p-6">
        <TemplateGeneratorTool />
      </div>
    </AssistantSubpageShell>
  );
}
