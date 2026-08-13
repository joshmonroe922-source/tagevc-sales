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

## Entity OS switcher (sidebar brand block)

The sidebar brand header is an operating-system switcher, **Visionary only**.
Everyone else sees the static brand line of their one OS.

- Gate: `canSwitchEntityOs({ realRole, impersonatingAs, liveLookActive })` from
  `@/lib/rbac/entity-os` — never re-derive this inline.
- Active lock: `SessionContext.activeEntityOs` (cookie `tagevc_entity_os`).
- **Any new `isFirmWideAccess` / `canAccessEntityId` / `canAccessPipelineEntity`
  call must pass `activeEntityOs`**, or a firm-wide operator working inside a
  subsidiary will silently keep seeing firm-wide rows.
- Scope narrows only — it can never widen past the real profile.

See `docs/OS_ENTITY_SWITCHER.md`.

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

Top-left **Messaging** control lives in the `AppSidebar` brand header, above the nav.

- Primary click → `/messages`
- Caret menu → Available / Do Not Disturb (green/red status dot on the control)
- Component: `src/components/messaging/sidebar-messaging-control.tsx`
- Portable twin: `src/lib/platform/shell/sidebar-messaging-control.tsx`

**Message Center is not a left-nav item** on Tage or any entity OS — this control is the only entry point. Do not re-add it to `MAIN_NAV` / `NAV_SECTIONS`.

Subsidiary portals (Recruit 619, Instant NDA, Signent HR, future clones) are **separate Next apps with their own `AppSidebar`** — they do *not* inherit this automatically. Copy the portable twin into each clone. Portals with no local chat pass `external` and point `href` at the Tage Message Center so the desk stays open in the current tab. See `docs/SUBSIDIARY_OS_SHELL.md` § Messaging control.

`/messages` is full-bleed in the main pane (no `max-w-6xl`): `AppMain` + `AppContentFrame` in `(app)/layout.tsx`. Add future edge-to-edge tools via `FULL_BLEED_PREFIXES` in `src/lib/platform/shell/full-bleed-routes.ts`.

## Think Tank (multi-thread + uploads)

Named AI threads persist in UDL (`os_think_tank_*`), scoped by **user + `portal_key` + `entity_os`**. Refresh / New thread must show the list — never wipe history. PDF/DOCX uploads are thread-only context (`os-think-tank` bucket).

- Portable twin: `src/lib/platform/think-tank/` — **copy into each new OS**
- Tage Entity OS switcher: pass `activeEntityOs` into Think Tank scope (`thinkTankEntityOs`) so R619-OS threads do not leak into Tage VC OS
- Home pages: mount `<ThinkTankClient />` without awaiting desk load (don’t block TTFB)

See `docs/THINK_TANK.md` and `docs/SUBSIDIARY_OS_SHELL.md` § Think Tank.

