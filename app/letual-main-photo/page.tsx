import { AssistantSubpageShell } from "@/components/AssistantSubpageShell";
import { LetualMainPhotoTool } from "@/components/LetualMainPhotoTool";

export const metadata = {
  title: "Главное фото · Летуаль | metabase-agent-kit",
  description:
    "Генерация главного фото для Летуаль: отбор из БД, белый фон, геометрия 1000×1000, публичные https-ссылки"
};

export default function LetualMainPhotoPage() {
  return (
    <AssistantSubpageShell
      title="Главное фото · Летуаль"
      description={
        <>
          Квадрат <strong>1000×1000</strong>, белый фон, без инфографики. Два режима: пакет по{" "}
          <strong>variation_id</strong> (Metabase + AI) или подгонка по своим <strong>URL</strong>.
        </>
      }
    >
      <div className="p-4 sm:p-6">
        <LetualMainPhotoTool />
      </div>
    </AssistantSubpageShell>
  );
}
