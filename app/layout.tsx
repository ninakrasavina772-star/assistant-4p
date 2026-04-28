import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ассистент контент (4Partners)",
  description:
    "Сравнение витрин, размерные таблицы, выгрузки — единая точка входа"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="min-h-screen font-sans antialiased text-[var(--4p-black)]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
