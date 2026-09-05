/** Экранирует строку для FTS5 MATCH: спецсимволы ищутся как текст. */
export function toFtsMatchQuery(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const terms = trimmed
    .split(/\s+/)
    .map((term) => term.replace(/"/g, '""').replace(/\*/g, ""))
    .filter((term) => term.length > 0);
  if (terms.length === 0) {
    return null;
  }
  return terms.map((term) => `"${term}"*`).join(" AND ");
}
