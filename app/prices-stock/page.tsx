import { AssistantSubpageShell } from "@/components/AssistantSubpageShell";
import { appIframeTall } from "@/components/homeTheme";

export const metadata = {
  title: "Цены и остатки | Ассистент контент",
  description:
    "Обменник по фидам: проекты, обновление Excel по URL/CSV, наценка"
};

/**
 * /public/prices-stock.html — копия «Обменник v2» (обменник-cloudflare).
 * Само приложение self-contained; подключаем через iframe.
 */
export default function PricesStockPage() {
  return (
    <AssistantSubpageShell
      title="Выгрузка цен и остатков"
      description={
        <>
          Обменник по фидам: проекты, URL или CSV, обновление шаблонов Excel
          (цена, цена до скидки, остаток), наценка, сохранение проектов. Инструмент
          встроен в страницу ниже; ему может понадобиться сеть (фиды, облачное
          хранение проектов, если оно настроено в оригинальном сценарии).
        </>
      }
    >
      <iframe
        src="/prices-stock.html"
        title="Обменник — цены и остатки по фидам"
        className={appIframeTall}
        allow="clipboard-read; clipboard-write"
      />
    </AssistantSubpageShell>
  );
}
