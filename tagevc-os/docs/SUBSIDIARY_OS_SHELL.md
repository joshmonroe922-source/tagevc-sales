# Subsidiary OS shell pattern (AppTopBar)

Canonical UX from Tage OS (`src/components/help-desk/help-desk-shell.tsx`).

Every subsidiary portal (Recruit 619, Instant NDA, Signent, **future clones**) must ship this upper-right shell:

| Control | Behavior |
| --- | --- |
| **Menu** (phone only) | `md:hidden` button → right Sheet with full left-nav panel (nav + role/view-as + sign out). Closes on route change. Mount panel only while open (`open ? children : null`). |
| **Alerts** | Bell + label + unread badge. Opens notification / soft-alert panel. |
| **Create Ticket** | Primary split-button opens the create-ticket modal. |
| **Help Desk** | Chevron dropdown item → `/help-desk`. **Not** a left-nav primary. |

### Mobile header order (required)

Phone (`< md`) visual order via flex `order-*` (DOM may stay Menu → Alerts → Create for a11y):

**Create Ticket | Alerts | Menu** — Menu far right.

Desktop (`md+`): **Alerts | Create Ticket** (Menu stays `md:hidden`).

Implement by wrapping portal Alerts + Create Ticket in shared `AppTopBarShell` from `src/lib/platform/shell/app-top-bar.tsx` (copy from Tage when scaffolding). Do **not** hand-layout the three controls without the order wrappers.

## Responsive left nav (required)

| Breakpoint | Behavior |
| --- | --- |
| **md and up** | Sticky left sidebar (`AppSidebar` `variant="desktop"`, `hidden md:flex`) |
| **Below md** | Sidebar hidden; main content full width; Menu in AppTopBar opens `MobileNavDrawer` with `AppSidebar` `variant="panel"` |

## Required wiring

1. Wrap the app shell in `HelpDeskShell` (`CreateTicketModalProvider`).
2. Render `AppTopBar` above `<main>` (right-aligned, `h-12`, border-b) with `mobileNav={<MobileNavDrawer><AppSidebar variant="panel" … /></MobileNavDrawer>}`.
3. `GlobalCreateTicketButton` = primary + chevron → Help Desk (see template below).
4. Remove `Help Desk` from `MAIN_NAV` / left sidebar.
5. Keep `/help-desk` route + page (reachable from the dropdown and deep links).
6. Copy `src/components/ui/sheet.tsx` + `src/components/layout/mobile-nav-drawer.tsx` when scaffolding.

## Copy targets (scaffold)

When cloning a new entity OS from Instant NDA / Signent / R619:

```
src/components/help-desk/help-desk-shell.tsx   # AppTopBar + HelpDeskShell (+ mobileNav slot)
src/components/help-desk/create-ticket-modal.tsx  # GlobalCreateTicketButton split
src/components/layout/alerts-bell.tsx          # Alerts control
src/components/layout/mobile-nav-drawer.tsx    # phone Menu → Sheet
src/components/ui/sheet.tsx                    # Sheet primitive (Base UI dialog)
src/components/layout/app-sidebar.tsx          # variant: desktop | panel
src/lib/nav.ts                                # no Help Desk left-nav item
```

Reference implementations also live under `src/lib/platform/shell/` (portable twins).

## Nav / Think Tank tests

Assert Help Desk is **absent** from left nav and present only via Create Ticket dropdown:

```ts
assert.ok(!MAIN_NAV.some((n) => n.href === '/help-desk'));
```

Phone shell smoke (Tage + every subsidiary):

```ts
assert.match(layout, /MobileNavDrawer/);
assert.match(sidebar, /md:flex/);
assert.match(drawer, /open \? children : null/);
assert.match(appTopBarShell, /order-3 md:order-1/); // Menu far right on phone
assert.match(helpDeskShell, /AppTopBarShell/);
```

## Visual tokens

Create Ticket split uses Tage charcoal:

`bg-[#3a414f] text-white hover:bg-[#535c63]`

## Production Vercel projects (domain owners)

| Portal | Domain | Vercel project |
| --- | --- | --- |
| Recruit 619 | portal.recruit619.com | `recruit619-portal` |
| Instant NDA | portal.instantnda.us | `instantnda-portal` |
| Signent HR | portal.signenthr.com | `signent-hr-portal` (local link often `signenthr-portal`) |

## Traction EOS (required on every entity OS)

Every subsidiary OS ships **Traction EOS** as a **standalone** left-nav item (HR-owned conceptually, not buried only under an HR accordion).

| Control | Behavior |
| --- | --- |
| **Nav label** | `{Entity Name} Operating System` — Tage shortens to **Tage VC Operating System** |
| **Route** | `/eos` (Recruit 619 also keeps `/desk/eos`) |
| **Data** | Shared UDL `os_eos_*` tables, hard-scoped to the portal `entity_id` |
| **Tage rollup** | Consolidated \| Tage VC \| each subsidiary scope toggle on Tage `/eos` |

### Copy targets (scaffold)

```
src/lib/eos/                          # types, dates, dashboard (entity-scoped)
src/components/eos/                   # action form (+ scope toggle on Tage only)
src/app/(app)/eos/page.tsx            # rocks · scorecard · IDS · L10 · V/TO
supabase/phase84_eos_operating_system.sql  # mirror of Tage UDL spine
src/lib/nav.ts                        # standalone "{Entity} Operating System"
```

Canonical docs: `docs/TRACTION_EOS.md`.

Nav smoke:

```ts
assert.ok(MAIN_NAV.some((n) => /Operating System$/.test(n.label)));
assert.ok(!MAIN_NAV.some((n) => n.href === '/help-desk'));
```

## Org Chart + hire impact + L10 (phase 85)

Every subsidiary OS ships:

| Control | Route | Notes |
| --- | --- | --- |
| **Org Chart** | `/admin/org-chart` | Under Admin. Name + title; click zooms subtree; Back to whole view. |
| **Hire impact** | `/admin/hire-impact` | Leadership fully-loaded cost (entity-scoped). |
| **EOS view modes** | `/eos?view=me\|team\|entity` | Filters by reports-to tree. |
| **Weekly L10** | EOS L10 panel | Per team/owner; history; Save → Document Library; Word download. |

Canonical SQL: `supabase/phase85_org_spine_l10_hire.sql` (shared UDL — apply once).

```
src/lib/org/  src/components/org/  src/app/(app)/admin/org-chart/
src/lib/hire/  src/lib/eos/l10-meetings.ts
src/components/eos/l10-meetings-panel.tsx  eos-view-mode-toggle.tsx
```
