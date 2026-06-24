/** Источники foto — без server-only (можно в UI prefill). */

export function isAdminFotoUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    /cdnru\.4stand\.com/.test(u) ||
    /api\.4stand\.com\/uploads/.test(u) ||
    /4partners|deloox\.com/.test(u)
  );
}

export function isSupplierFotoUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (isAdminFotoUrl(u)) return false;
  return (
    /lyko\.com|douglas\.|bigbuy|makeupstore|notino|goldapple|letu\.ru|vivantis|parfimo|ozon\.|wildberries|cdnbigbuy|tradeinn|mirakl\.net/.test(
      u
    )
  );
}

/** Promo / инфографика поставщика — не для витрины */
export function isPromoOrInfographicUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (/\.gif(?:\?|$)/.test(u)) return true;
  if (/before|after|packaging|banner|promo|environmentally|conscious/.test(u)) return true;
  if (/lyko\.com.*_(?:2\d|3\d|4)\.(?:jpg|jpeg|png)(?:\?|$)/.test(u)) return true;
  return false;
}

/** Оставить админку; supplier — только если админских foto нет */
export function preferAdminFotoUrls(urls: string[]): string[] {
  const admin = urls.filter((u) => isAdminFotoUrl(u) && !isPromoOrInfographicUrl(u));
  if (admin.length) return admin;
  return urls.filter((u) => !isPromoOrInfographicUrl(u) && !isSupplierFotoUrl(u));
}
