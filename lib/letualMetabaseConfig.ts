export const DEFAULT_METABASE_URL = "https://metabase.4stand.com";
export const DEFAULT_METABASE_DB_ID = 2;
/** Fallback, если METABASE_API_KEY не задан в env (переменная окружения имеет приоритет). */
export const DEFAULT_METABASE_API_KEY =
  "mb_OTEdeHGdTyfV0X7s1fjq4mk4E3ybJoTd2VnI5FaXZVQ=";

export type MetabaseCredentials = {
  url: string;
  apiKey: string;
  databaseId: number;
};

export function resolveMetabaseCredentials(
  clientApiKey?: string
): MetabaseCredentials | null {
  const apiKey =
    (clientApiKey ?? "").trim() ||
    (process.env.METABASE_API_KEY ?? "").trim() ||
    DEFAULT_METABASE_API_KEY;
  if (!apiKey) return null;

  const url = (process.env.METABASE_URL ?? DEFAULT_METABASE_URL).trim().replace(/\/+$/, "");
  const databaseId = Number(
    process.env.METABASE_DB_ID?.trim() || String(DEFAULT_METABASE_DB_ID)
  );

  return { url, apiKey, databaseId };
}

export function metabaseIsConfigured(clientApiKey?: string): boolean {
  return resolveMetabaseCredentials(clientApiKey) !== null;
}
