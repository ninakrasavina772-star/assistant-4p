import { AssistantSubpageShell } from "@/components/AssistantSubpageShell";
import { AssistantBuildStamp } from "@/components/AssistantBuildStamp";
import { AssistantToolUpdatedBadge } from "@/components/AssistantToolUpdatedBadge";
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
          Квадрат <strong>1000×1000</strong>, белый фон, без инфографики. Пакет до{" "}
          <strong>50 variation_id</strong>: сначала подбор фото, затем генерация. Или подгонка по своим{" "}
          <strong>URL</strong>.
          <AssistantToolUpdatedBadge href="/letual-main-photo" className="mt-2" />
          <AssistantBuildStamp className="mt-1" />
        </>
      }
    >
      <div className="p-4 sm:p-6">
        <LetualMainPhotoTool />
      </div>
    </AssistantSubpageShell>
  );
}
