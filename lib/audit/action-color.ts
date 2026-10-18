/**
 * lib/audit/action-color.ts
 *
 * Pure helper mapping an audit action string to the className for its chip.
 * Used by every audit-feed surface so chips stay consistent - the zone
 * change-log header chip (`<ActionChip>`) and the admin-detail
 * recent-activity panel (`<AdminAuditPanel>`).
 *
 * Per the Turksat design system, actions are categories and so are not
 * color-coded - every chip is a neutral tag - with one exception: deletions
 * (`.delete`, `.revoked`) keep the destructive color, which the system
 * reserves for exactly that meaning.
 *
 * Suffix matching only - no per-action table. New actions get the right
 * treatment automatically as long as they end in one of the known verbs.
 */

export function colorForAuditAction(action: string): string {
  if (action.endsWith(".delete") || action.endsWith(".revoked")) {
    return "bg-destructive-muted text-destructive";
  }
  return "bg-tag text-tag-foreground";
}
