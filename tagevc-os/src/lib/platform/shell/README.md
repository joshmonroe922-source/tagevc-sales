# Platform shell — copy into subsidiary OS scaffolds

Portable twins of Tage AppTopBar + content-frame patterns. Copy these files
into a new entity portal under the matching `src/components/...` paths, then
wire entity-specific ticket create + alerts data sources.

See `docs/SUBSIDIARY_OS_SHELL.md` (full-width shell + page-speed checklist).

A&F spine (Accounting · Finance · Audit · Controls) is a sibling platform module —
copy `src/lib/platform/af/` the same way. See `docs/TAGE_VC_AF.md`.

| File | Portal destination |
| --- | --- |
| `app-content-frame.tsx` | `components/layout/app-content-frame.tsx` — **default `w-full max-w-none`** (no centered `max-w-6xl`) |
| `app-main.tsx` | `components/layout/app-main.tsx` |
| `full-bleed-routes.ts` | Keep under `lib/platform/shell/`; start with `/messages` |
| `nav-active.ts` | Keep under `lib/platform/shell/` — **required** for sidebar + horizontal tab active state |
| `create-ticket-split-button.tsx` | Merge into `components/help-desk/create-ticket-modal.tsx` as `GlobalCreateTicketButton` |
| `app-top-bar.tsx` | Keep under `lib/platform/shell/`; wire from `components/help-desk/help-desk-shell.tsx` via `AppTopBarShell` |
| `alerts-bell.tsx` | `components/layout/alerts-bell.tsx` (swap data source) |
| `mobile-nav-drawer.tsx` (from `components/layout/`) | `components/layout/mobile-nav-drawer.tsx` + copy `components/ui/sheet.tsx` |
| AppSidebar `variant` | `desktop` (hidden below md) + `panel` inside `MobileNavDrawer` |

## Full-width + first paint (required)

New entity portals must ship:

1. **Full-width content frame** — sidebar to viewport edge (`w-full max-w-none` + padding). Messaging stays full-bleed via `FULL_BLEED_PREFIXES`.
2. **Paint-first shell** — do not block `(app)/layout` on store bootstrap or badge counts; use `after()` + Suspense.
3. **Streamed home / hubs** — header first; briefing / KPI bodies in Suspense; LLM briefing timeout + cache.
4. **Active route highlighting** — sidebar + horizontal tabs use `nav-active.ts` (`isPathMatch` / `resolveActiveNavHref` / `isNavItemActive`); active links set `aria-current="page"`; accordion parents light when a child route is current.

Canonical docs: `docs/SUBSIDIARY_OS_SHELL.md` §§ Full-width content shell, Page speed / first paint, Active route highlighting.
Guardrails: Tage `src/lib/home/os-page-speed.test.ts`, `src/lib/platform/shell/nav-active.test.ts`, Recruit 619 `src/lib/home/home-page-speed.test.ts`.

## Mobile header order (required)

`AppTopBarShell` owns flex `order-*` so phone shows **Create Ticket | Alerts | Menu** (Menu far right). Future subsidiaries inherit by copying this file and wrapping portal controls — do not re-order the three controls by hand.

## Responsive nav (required)

- **md+:** sticky left sidebar (`variant="desktop"`, `hidden md:flex`)
- **&lt; md:** hide sidebar; AppTopBar shows Menu → right Sheet with full nav / role switcher / sign out (`variant="panel"`)
- Mount drawer children only while open (`open ? children : null`) to avoid dual-sidebar realtime channel crashes

| `reload-scroll-restore.tsx` | `components/layout/reload-scroll-restore.tsx` + mount in root `app/layout.tsx`; mark `<main data-scroll-restoration>` |

## Think Tank (AI desk)

Copy `src/lib/platform/think-tank/` into each new OS. Multi-thread persistence + document upload. SQL once on shared UDL (`phase107_think_tank_threads.sql`). See `docs/THINK_TANK.md`.

## Sidebar brand block / Entity OS switcher

`entity-os-brand.tsx` (`ShellEntityOsBrand`) is the portable twin of the Tage
sidebar brand header. It renders the two brand lines and, when the host passes
`onSelect` plus two or more options, turns them into an operating-system
dropdown.

- Single-OS portals: pass one option (or omit `onSelect`) → static brand lines.
- Cross-entity operators: pass the option list + an `onSelect` wired to the
  portal's own server action, and gate it on the portal's firm-wide role.

Never let a portal show the switcher to a role that was hired into one entity.
See `docs/OS_ENTITY_SWITCHER.md`.
