"use client";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ru">
      <body className="antialiased min-h-screen p-8 text-slate-800">
        <h1 className="text-lg font-semibold mb-2">Критическая ошибка</h1>
        <p className="text-sm text-slate-600 mb-4">{error.message}</p>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm"
        >
          Попробовать снова
        </button>
      </body>
    </html>
  );
}
