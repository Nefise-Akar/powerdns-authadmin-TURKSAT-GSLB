## components/ui

Generic reusable UI primitives: tables, dialogs, switches, selectors, shell
chrome, theme controls, toasts, skeletons, and small interaction helpers.

These components are domain-neutral. Feature-specific DNS/admin behavior belongs
under `components/domain` or the relevant `app/` route segment.

Styling follows the Turksat design system tokens in `app/globals.css`. Build new
UI from the shared primitives instead of re-typing their classes:

- `button.tsx` - `Button` / `buttonClass()` (primary, secondary, ghost,
  destructive, link) and `IconButton` / `iconButtonClass()`.
- `field.tsx` - `Field` (label, control, help/error) and `inputClass` /
  `textareaClass`.
- `badge.tsx` - `Tag`, `CountBadge`, `Kbd`.
- `alert.tsx` - `Alert` (warning / destructive).
