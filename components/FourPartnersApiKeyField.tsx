"use client";

import { useEffect, useState } from "react";
import { homeInput } from "@/components/homeTheme";

const SK_KEY = "fp_fourpartners_api_key";
const SK_REM = "fp_fourpartners_api_remember";

type Props = {
  storageKeyPrefix?: string;
  className?: string;
};

export function FourPartnersApiKeyField({ storageKeyPrefix = "", className }: Props) {
  const skKey = storageKeyPrefix ? `${storageKeyPrefix}_${SK_KEY}` : SK_KEY;
  const skRem = storageKeyPrefix ? `${storageKeyPrefix}_${SK_REM}` : SK_REM;

  const [apiKey, setApiKey] = useState("");
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem(skRem) !== "0") {
      const k = sessionStorage.getItem(skKey);
      if (k) setApiKey(k);
    }
  }, [skKey, skRem]);

  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    if (!remember) {
      sessionStorage.setItem(skRem, "0");
      sessionStorage.removeItem(skKey);
      return;
    }
    const t = apiKey.trim();
    if (t) sessionStorage.setItem(skKey, t);
    sessionStorage.setItem(skRem, "1");
  }, [apiKey, remember, skKey, skRem]);

  return (
    <div className={className ?? "space-y-2"}>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">
          Ключ 4Partners API <span className="font-normal text-slate-500">(необязательно)</span>
        </span>
        <input
          type="password"
          className={homeInput}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="X-Auth-Token из личного кабинета"
          autoComplete="off"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        Запомнить в этой вкладке
      </label>
      <p className="text-xs text-slate-500 leading-relaxed">
        Сейчас фото берётся из Excel/CSV: колонка <strong>foto</strong> или{" "}
        <strong>«Изображения варианта»</strong> — из нескольких ссылок выбирается лучшая (для парфюма
        — флакон с коробкой, <code className="text-[11px]">/huge/</code> на CDN). Ключ API не
        замедляет процесс, пока не включим подбор через API — это запасной путь на будущее.
      </p>
    </div>
  );
}
