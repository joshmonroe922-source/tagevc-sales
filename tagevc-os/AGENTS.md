# Tage OS — agent / contributor notes

## Entity labels in the UI

**Never** show opaque entity codes (`ENT-FIRM`, `ENT-R619`, `ENT-SIGNENT`, `ENT-INDA`, …) as the primary human-facing label.

| Use | Module |
| --- | --- |
| Display name helper | `@/lib/entities/display-name` → `entityDisplayName` / `entityLabel` |
| PageHeader scope chip | `entityScopeContext(entityId)` |
| Compact firm/null fallback | `entityLabelOrFirm(entityId)` |
| Badge in tables/cards | `@/components/entities/entity-badge` → `<EntityBadge entity={…} />` |
| Select order + labels | `@/lib/entities/display-order` + `CompanySelect` |

- **Values** in forms, URLs, RLS, and APIs stay as `entity_id`.
- **Labels** use `name` / `legal_name` / `canonical_name` / `display_name` when present, else the known-name map.
- Raw `ENT-*` is OK only as a muted secondary line, `title` tooltip, admin/debug copy, or technical docs — not the primary label.

See also: `docs/OS_ENTITY_SELECT_ORDER.md`.

## Engage analytics (Marketing)

Firm rollup: `/shared-services/marketing/engage`

- Entity filter from registry (`getCachedEntitySelectOptions` + priority ids) — Consolidated then Firm / R619 / Signent / Instant NDA / future entities.
- Fail-closed when `DIALPAD_LIVE` / `TAGE_ECC_LIVE` (or `ECC_LIVE`) are off.
- Subsidiary portals deep-link here and to Email Campaign Center; they do **not** rebuild ECC.

Helper: `@/lib/shared-services/engage-analytics`

## Reload scroll restore

Hard refresh should stay at the same scroll spot (best-effort if content height changes). Soft navigations still go to top.

- Component: `src/components/layout/reload-scroll-restore.tsx` (`ReloadScrollRestore` in root `layout.tsx`)
- Mark the shell scroller: `data-scroll-restoration` on app `<main>` (overflow-y-auto)
- Portable twin: `src/lib/platform/shell/reload-scroll-restore.tsx` — copy on new clones
- Hash URLs prefer the hash target over a saved Y

## Messaging + presence (shared shell)

Top-left **Messaging** control lives on shared `AppSidebar` (Tage + all subsidiary entity OS inherit automatically).

- Primary click → `/messages`
- Caret menu → Available / Do Not Disturb (green/red status dot on the control)
- Component: `src/components/messaging/sidebar-messaging-control.tsx`
- Portable twin: `src/lib/platform/shell/sidebar-messaging-control.tsx`

`/messages` is full-bleed in the main pane (no `max-w-6xl`): `AppMain` + `AppContentFrame` in `(app)/layout.tsx`. Add future edge-to-edge tools via `FULL_BLEED_PREFIXES` in `src/lib/platform/shell/full-bleed-routes.ts`.

