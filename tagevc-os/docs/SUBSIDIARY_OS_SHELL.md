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

## Reload scroll restore (required)

Hard refresh keeps scroll position on the same path. Soft route changes still jump to top. Hash links win over saved Y.

Wire `ReloadScrollRestore` in root `src/app/layout.tsx`. Mark app shell scroller:

```tsx
<main data-scroll-restoration className="… overflow-y-auto …">
```

Copy targets:

```
src/components/layout/reload-scroll-restore.tsx
src/lib/platform/shell/reload-scroll-restore.tsx   # portable twin
```

Caveat: dynamic content that changes height after load makes restore best-effort (retries briefly after paint).


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

## Cards | List (required on every card section)

Every navigational or metric **card grid** on Tage and subsidiaries must ship a **Cards | List** toggle. Preference persists in `localStorage` (`tagevc.view.mode.v1.<surface>`).

| Control | Behavior |
| --- | --- |
| **Toggle** | Accessible segmented control: Cards \| List |
| **Persist** | Per-surface key via `viewModeStorageKey(surface)` |
| **List mode** | Real table of the same rows — not a stub |
| **Default** | Usually `cards` (see `VIEW_MODE_DEFAULTS`) |

### Copy targets (scaffold)

```
src/lib/platform/view-mode/           # types, defaults, storage keys
src/lib/view-mode.ts                  # thin re-export (compat)
src/components/ui/view-mode-toggle.tsx # useViewMode · ViewModeToggle · ViewModeLayout
src/components/platform/module-link-board.tsx  # link/module hubs
src/components/platform/metric-card-board.tsx  # KPI / breakdown boards
```

Canonical imports: `@/lib/platform/view-mode`, `@/components/platform/module-link-board`.

**Rule:** Do not ship new card-only grids for hubs, KPIs, Net Worth breakdowns, Personal Finance modules, or A&F module maps. Wrap with `ViewModeLayout`, `ModuleLinkBoard`, or `MetricCardBoard`.

Smoke:

```ts
assert.match(viewMode, /VIEW_MODE_STORAGE_PREFIX/);
assert.match(moduleLinkBoard, /ViewModeLayout/);
assert.match(moduleLinkBoard, /<table/);
```

## Traction EOS (required on every entity OS)

Every subsidiary OS ships **Traction EOS** under the **Grow** left-nav section (HR-owned conceptually). On Tage it is also nested under Shared Services → HR.

| Control | Behavior |
| --- | --- |
| **Nav parent** | **Grow** (section label on R619 / Instant NDA / Signent; accordion on Tage) |
| **Nav label** | **Tage:** `{Entity Name} Performance Management` (Tage shortens to **Tage VC Performance Management**). **Subsidiary clones:** plain **Performance Management** (no company prefix — single-entity portals). Nested under Shared Services → HR on Tage: **Performance Management**. |
| **Route** | `/eos` (Recruit 619 also keeps `/desk/eos`) |
| **Data** | Shared UDL `os_eos_*` tables, hard-scoped to the portal `entity_id` |
| **Tage rollup** | Consolidated \| Tage VC \| each subsidiary scope toggle on Tage `/eos` — page titles stay company-qualified for entity recognition |

### Copy targets (scaffold)

```
src/lib/eos/                          # types, dates, dashboard (entity-scoped)
src/components/eos/                   # action form (+ scope toggle on Tage only)
src/app/(app)/eos/page.tsx            # rocks · scorecard · IDS · L10 · V/TO
supabase/phase84_eos_operating_system.sql  # mirror of Tage UDL spine
src/lib/nav.ts                        # Grow → Performance Management (+ Training)
```

Canonical docs: `docs/TRACTION_EOS.md`.

Nav smoke:

```ts
// Tage — under Grow accordion (also flattenNavItems for HR nested link)
const grow = MAIN_NAV.find((n) => n.label === 'Grow');
assert.ok(grow?.children?.some((c) => /Performance Management$/.test(c.label)));
assert.ok(grow?.children?.some((c) => c.label === 'Training & Development'));
// Subsidiary clone — Grow section
assert.ok(NAV_SECTIONS.some((s) => s.id === 'grow' && s.label === 'Grow'));
assert.ok(MAIN_NAV.some((n) => n.label === 'Performance Management'));
assert.ok(MAIN_NAV.some((n) => n.label === 'Training & Development' || n.label.startsWith('Training & Development')));
assert.ok(!MAIN_NAV.some((n) => n.href === '/help-desk'));
```

## Grow — Performance + Training (required on every entity OS)

Every entity OS (Tage + current subsidiaries + **future clones**) ships a **Grow** nav group with at least:

| Child | Route (canonical) | Notes |
| --- | --- | --- |
| **Performance Management** | `/eos` (R619: `/desk/eos`) | Traction EOS — see § Traction EOS |
| **Training & Development** | `/training` (R619: `/desk/training`) | Full LMS on Recruit 619; placeholder landing on other clones until content lands |

Recruit 619 may keep additional Grow children (KPI Hierarchy, Content & Brand, Marketing, Reports, Team, Leadership). Clones inherit the **minimum** pair above.

### Copy targets (scaffold)

```
src/lib/nav.ts                        # Grow section / accordion with PM + T&D
src/app/(app)/training/page.tsx       # landing (or /desk/training on R619)
```

## A&F — Accounting & Finance (required on every entity OS)

Canonical finance lives under **`{Entity} A&F`**, not a separate Shared Services → Finance item.

| | |
| --- | --- |
| **Hub** | `/shared-services/af` |
| **Sibling sections** | Accounting · Finance · Audit · Controls, Security & Governance |
| **Routes** | `/shared-services/af/accounting` · `/finance` · `/audit` · `/controls` |

**Do not** revive legacy `/shared-services/finance` in subsidiary nav. On Tage OS that path soft-redirects to A&F Finance.

Shared Services nav labels (platform-standard): **Human Resources** (not HR), **Technology** (not IT). Keep URL paths `/shared-services/hr` and `/shared-services/it/*` stable.

Every entity OS (Tage + current subsidiaries + **future clones**) ships the **Tage VC A&F** concept as a standardized spine — not Tage-only nav.

| Control | Behavior |
| --- | --- |
| **Nav label** | `{Entity Name} A&F` (Tage: **Tage VC A&F** under Shared Services) |
| **Hub** | `/shared-services/af` |
| **Sibling sections** | Accounting · Finance · Audit · Controls, Security & Governance |
| **Routes** | `/shared-services/af/accounting` · `/finance` · `/audit` · `/controls` |
| **Status** | Scaffold / placeholders until full A&F instructions land |

### Copy targets (scaffold)

```
src/lib/platform/af/                  # sections.ts + nav.ts (buildAfNavBranch / Flat)
src/app/(app)/shared-services/af/     # hub + four section placeholders
src/lib/nav.ts                        # wire "{Entity} A&F" (+ nested or flat children)
```

Portable twins live under Tage `src/lib/platform/af/` (same pattern as `platform/shell/` / AppTopBarShell). Copy into each subsidiary and future OS clone. Canonical product doc: `docs/TAGE_VC_AF.md`.

Nav smoke:

```ts
assert.ok(
  MAIN_NAV.some((n) => /A&F$/.test(n.label)) ||
    NAV_SECTIONS?.some((s) => /A&F$/.test(s.label ?? '')),
);
assert.ok(AF_SECTIONS.map((s) => s.id).join() === 'accounting,finance,audit,controls');
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
