import { AssistantSubpageShell } from "@/components/AssistantSubpageShell";
import { appIframeTall } from "@/components/homeTheme";

export const metadata = {
  title: "Размерная таблица | Ассистент контент",
  description:
    "Генератор размерных сеток: Excel → редактор → JPG, палитра, JSON"
};

/**
 * Сам генератор вынесен в /public/size-grid.html (порт setka-bez-node.html) и
 * подключается в iframe, чтобы не дублировать ~2k строк ванильного кода.
 */
export default function SizeTablePage() {
  return (
    <AssistantSubpageShell
      title="Создать размерную таблицу"
      description={
        <>
          Загрузите Excel, укажите строку с синими заголовками, постройте сетку,
          настройте цвета (есть готовая палитра «Спортмастер») и скачайте JPG
          1500×2000. Для работы у окна ниже должен быть доступ в интернет (шрифт
          Montserrat и библиотеки XLSX, html2canvas с CDN), как в исходном
          single-file макете.
        </>
      }
    >
      <iframe
        src="/size-grid.html"
        title="Генератор размерных сеток (JPG)"
        className={appIframeTall}
        allow="clipboard-read; clipboard-write"
      />
    </AssistantSubpageShell>
  );
}
