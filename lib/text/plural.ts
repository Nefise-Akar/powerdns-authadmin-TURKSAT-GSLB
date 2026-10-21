/** Format a count with the correct plural suffix for the supplied word. */
export function plural(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`;
  const suffix = /(s|x|z|ch|sh)$/i.test(word) ? "es" : "s";
  return `${n} ${word}${suffix}`;
}
