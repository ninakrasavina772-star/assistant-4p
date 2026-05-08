import Link from "next/link";
import { appSubpageBackLink } from "@/components/homeTheme";

export function BackToAssistant() {
  return (
    <Link href="/" className={appSubpageBackLink}>
      ← Ассистент контент
    </Link>
  );
}
