import Link from "next/link";
import type { ReactNode } from "react";
import { AssistantBrand } from "@/components/AssistantBrand";
import {
  appEmbedFrame,
  appSubpageBackLink,
  appSubpageContainer5xl,
  appSubpageDescription,
  appSubpageHeaderRow,
  appSubpageRoot,
  appSubpageTitle
} from "@/components/homeTheme";

type Props = {
  title: string;
  description: ReactNode;
  children: ReactNode;
};

/**
 * Оболочка под iframe-страницы: тот же фон и сетка, что у главной (`homeTheme`).
 */
export function AssistantSubpageShell({ title, description, children }: Props) {
  return (
    <div className={appSubpageRoot}>
      <div className={appSubpageContainer5xl}>
        <header className={appSubpageHeaderRow}>
          <AssistantBrand size="compact" align="left" />
          <Link href="/" className={appSubpageBackLink}>
            ← К ассистенту
          </Link>
        </header>
        <h1 className={appSubpageTitle}>{title}</h1>
        <div className={appSubpageDescription}>{description}</div>
        <div className={appEmbedFrame}>{children}</div>
      </div>
    </div>
  );
}
