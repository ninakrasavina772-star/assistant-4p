import Image from "next/image";
import { adminUrlForProductId, standAdminProductUrl } from "@/lib/productLinks";
import type { CompareProduct } from "@/lib/types";

export function ProductCell({
  c,
  siteLabel
}: {
  c: CompareProduct;
  siteLabel: string;
}) {
  const adminUrl = adminUrlForProductId(c.id);
  const standAdminUrl = standAdminProductUrl(c.id);
  const hasPublic = Boolean(c.link?.trim());
  return (
    <div className="flex gap-3 min-w-0">
      <div className="relative w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
        {c.firstImage ? (
          <Image
            src={c.firstImage}
            alt=""
            width={80}
            height={80}
            className="object-contain w-full h-full"
            unoptimized
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
            нет фото
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500 mb-0.5">{siteLabel}</p>
        {c.brand && (
          <p className="text-xs text-slate-400 truncate">{c.brand}</p>
        )}
        <p className="text-sm text-slate-800 font-medium line-clamp-2">
          {c.nameRu}
        </p>
        <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{c.nameEn}</p>
        <p className="text-xs text-slate-600 mt-1">
          <span className="font-mono">EAN: {c.eans.length ? c.eans.join(", ") : "—"}</span>
        </p>
        {(c.articleKey || c.linkBaseKey) && (
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
            {c.articleKey ? <>арт.: {c.articleKey}</> : null}
            {c.articleKey && c.linkBaseKey ? " · " : null}
            {c.linkBaseKey ? <>карточка: {c.linkBaseKey}</> : null}
          </p>
        )}
        {(c.attrVolume || c.attrShade || c.attrColor) && (
          <p className="text-[11px] text-slate-500 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
            {c.attrVolume && <span>объём: {c.attrVolume}</span>}
            {c.attrShade && <span>оттенок: {c.attrShade}</span>}
            {c.attrColor && <span>цвет: {c.attrColor}</span>}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
          {adminUrl ? (
            <a
              href={adminUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-800 hover:underline"
            >
              Карточка
              <span aria-hidden>↗</span>
            </a>
          ) : hasPublic ? (
            <a
              href={c.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-800 hover:underline"
            >
              Карточка
              <span aria-hidden>↗</span>
            </a>
          ) : null}
          {adminUrl && hasPublic && (
            <a
              href={c.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-slate-700 hover:underline"
            >
              На сайте
              <span aria-hidden>↗</span>
            </a>
          )}
          <a
            href={standAdminUrl}
            target="_blank"
            rel="noreferrer"
            title="4Partners Control Center"
            className="inline-flex items-center gap-1 text-sm text-indigo-800 hover:underline"
          >
            Админка
            <span aria-hidden>↗</span>
          </a>
        </div>
        <p className="text-[11px] text-slate-400 font-mono mt-0.5">id: {c.id}</p>
      </div>
    </div>
  );
}
