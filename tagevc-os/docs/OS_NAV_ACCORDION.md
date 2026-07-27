# Left nav accordion groups

Tage OS sidebar (`app-sidebar.tsx`) treats parent nav items with `children` as accordion groups.

## Behavior
- **Top-level order** → Home → **Assets** → **C-Suite** → Dashboard → **To Do List** → **Firm** → **Business Development** → **Command Center** → Shared Services → Message Center
- **To Do List** → `/to-do` — SSC checklist tasks + lead/deal/M&A/RE follow-ups (not Help Desk tickets). Visible to all roles with Home access. Help Desk stays on Create Ticket dropdown only
- **C-Suite** (Visionary-only) → HQ, CFO, CTO, CMO, CHRO, CLO — between Assets and Dashboard; hidden during Live Look. Command Center is top-level (not nested under C-Suite)
- **Firm** / **Command Center** — top-level (not nested under BD / C-Suite); **hidden for COO (subsidiaries)**, **Associate / VC Sourcer**, **M&A Associate**, **Sourcer**, and **SSC operators** (Counsel/Ops + `ssc_*` + Service Lead)
- **Business Development** → Lead Intake, Deal Flow, role-gated sourcing links — **hidden for COO (subsidiaries)** and **SSC operators** (`hiddenForRoles`); **Associate / VC Sourcer** keeps BD accordion with **VC Sourcing** → `/deal-flow/vc` + **M&A Sourcing** → `/deal-flow/ma`; **M&A Associate** collapses BD to top-level **M&A Activities** → `/deal-flow/ma` (owner-assigned targets); **Sourcer** collapses BD to **Sourcing Platform** → `/deal-flow/re`. BD stays top-level (not under Assets) so role transforms keep working
- **SSC Role Switcher** → Counsel/Ops + Accounting / Finance / Human Resources / Legal / Technology / Marketing land on their function homes; each scoped role (including Service Lead → led desk only, Finance default) sees only its SSC function + Ticket Portal + **Admin** (Document Library; DocuSign for Legal/Counsel) — not firm-wide portfolio / C-Suite / BD
- **Associate / VC Sourcer Role Switcher** → lands on `/deal-flow/vc`; C-Suite / Command Center / Firm / Assets hidden; BD shows VC + M&A sourcing only
- **M&A Associate Role Switcher** → lands on `/deal-flow/ma`; C-Suite / Command Center / Firm / Assets hidden
- **Assets** (renamed from Portfolio; under Home — not under Dashboard) → Net Worth, Businesses, Real Estate, Investments
  - **Net Worth** + **Investments**: Visionary-only + hidden during Live Look
  - **Businesses** + **Real Estate**: portfolio module; COO / subsidiary leaders only see entities they are assigned to lead (`coo_owner` / profile entity)
- **Shared Services** → Finance, HR, IT, Marketing, Legal, Ticket Portal, Admin (direct function homes; hub at `/shared-services` remains optional; Ticket Portal keeps `/activity`)
- **Legal** → `/shared-services/legal` (matters · tasks · counsel ops). DocuSign is **not** Legal primary nav — under Admin
- **HR** (under Shared Services) → Screening (`/shared-services/hr/screening`) — nested accordion; HR keeps its own home link
- **IT / Technology** (under Shared Services) → Activity log (`/shared-services/it/activity`, `read:it_assets` / Technology) + Audit log (`/admin/audit`, Visionary-only) — nested accordion; IT keeps its own home link (`/shared-services/it/assets`)
- **Admin** (under Shared Services) → `/admin` (users · roles when permitted) + nested **Document Library** (`/documents`) + **DocuSign** (`/shared-services/legal/docusign`). Roles without `admin:users` still see the Admin accordion with Document Library (and DocuSign when in scope); parent href is omitted. Audit log remains under IT, not Admin. Help Desk is Create Ticket dropdown only (not left nav)
- First tap expands; second tap collapses
- Active child route forces parent open on navigation (nested: Screening keeps Shared Services + HR expanded; IT Activity / Audit keeps Shared Services + IT expanded; Document Library / DocuSign keeps Shared Services + Admin expanded)
- Expanded state persisted in `localStorage` key `tagevc.nav.accordion.v1`
- Chevron rotates; parent is a focusable button (Enter/Space); hybrid parents with `href` + `children` use a link + chevron toggle
- Children without access are hidden (`requiredPermission`, `visionaryOnly`, `hiddenForRoles`, module RBAC) — no empty dead links

Nav config remains data-driven in `src/lib/nav.ts` (`MAIN_NAV` with optional nested `children`).
