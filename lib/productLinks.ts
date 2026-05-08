/**
 * Шаблон URL админки товара: задайте в .env
 * NEXT_PUBLIC_4P_ADMIN_URL_TEMPLATE=https://ваш-админ/.../product/{id}
 * Плейсхолдер {id} заменяется на id товара.
 */
export function adminUrlForProductId(id: number): string | null {
  const t =
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_4P_ADMIN_URL_TEMPLATE?.trim();
  if (!t) return null;
  if (!t.includes("{id}")) return null;
  return t.split("{id}").join(String(id));
}

const DEFAULT_4STAND_ADMIN_BASE = "https://4stand.com/A";

/**
 * Карточка в 4Partners Control Center (4stand.com): база без id + числовой id.
 * Пример: https://4stand.com/A57680301
 * Переопределение: NEXT_PUBLIC_4STAND_ADMIN_BASE=https://4stand.com/A
 */
export function standAdminProductUrl(id: number): string {
  const raw =
    (typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_4STAND_ADMIN_BASE?.trim()) ||
    DEFAULT_4STAND_ADMIN_BASE;
  const base = raw.replace(/\/$/, "");
  return `${base}${id}`;
}
