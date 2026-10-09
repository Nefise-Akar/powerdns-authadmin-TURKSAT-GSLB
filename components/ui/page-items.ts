/**
 * components/ui/page-items.ts
 *
 * Which page buttons a pager shows: every page when there are few, otherwise
 * the first, the last and the current one with its neighbours, with `gap`
 * where pages are skipped - `1 2 3 … 13` on the first page, `1 … 6 7 8 … 13`
 * in the middle, `1 … 11 12 13` on the last.
 */
export function pageItems(current: number, pageCount: number): Array<number | "gap"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const shown = new Set([1, pageCount, current - 1, current, current + 1]);
  if (current <= 3) [2, 3].forEach((p) => shown.add(p));
  if (current >= pageCount - 2) [pageCount - 2, pageCount - 1].forEach((p) => shown.add(p));
  const pages = [...shown].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1]! > 1) out.push("gap");
    out.push(p);
  });
  return out;
}
