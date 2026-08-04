# Platform shell — copy into subsidiary OS scaffolds

Portable twins of Tage AppTopBar patterns. Copy these files into a new
entity portal under the matching `src/components/...` paths, then wire
entity-specific ticket create + alerts data sources.

See `docs/SUBSIDIARY_OS_SHELL.md`.

A&F spine (Accounting · Finance · Audit · Controls) is a sibling platform module —
copy `src/lib/platform/af/` the same way. See `docs/TAGE_VC_AF.md`.

| File | Portal destination |
| --- | --- |
| `create-ticket-split-button.tsx` | Merge into `components/help-desk/create-ticket-modal.tsx` as `GlobalCreateTicketButton` |
| `app-top-bar.tsx` | Keep under `lib/platform/shell/`; wire from `components/help-desk/help-desk-shell.tsx` via `AppTopBarShell` |
| `alerts-bell.tsx` | `components/layout/alerts-bell.tsx` (swap data source) |
| `mobile-nav-drawer.tsx` (from `components/layout/`) | `components/layout/mobile-nav-drawer.tsx` + copy `components/ui/sheet.tsx` |
| AppSidebar `variant` | `desktop` (hidden below md) + `panel` inside `MobileNavDrawer` |

## Mobile header order (required)

`AppTopBarShell` owns flex `order-*` so phone shows **Create Ticket | Alerts | Menu** (Menu far right). Future subsidiaries inherit by copying this file and wrapping portal controls — do not re-order the three controls by hand.

## Responsive nav (required)

- **md+:** sticky left sidebar (`variant="desktop"`, `hidden md:flex`)
- **&lt; md:** hide sidebar; AppTopBar shows Menu → right Sheet with full nav / role switcher / sign out (`variant="panel"`)
- Mount drawer children only while open (`open ? children : null`) to avoid dual-sidebar realtime channel crashes

| `reload-scroll-restore.tsx` | `components/layout/reload-scroll-restore.tsx` + mount in root `app/layout.tsx`; mark `<main data-scroll-restoration>` |
