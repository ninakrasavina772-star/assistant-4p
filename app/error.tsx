"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 text-slate-800">
      <h1 className="text-lg font-semibold mb-2">Ошибка на странице</h1>
      <p className="text-sm text-slate-600 mb-4 max-w-lg text-center">
        {error.message}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm"
      >
        Попробовать снова
      </button>
    </div>
  );
}
