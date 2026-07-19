# Accounting & Finance portal setup

Shared-services Finance lives under **`/sales/finance`** (portal slug `accounting-finance`).  
It is **not** an entity-level portal — audit controls, close checklists, and finance tasks stay in Accounting & Finance, not on Manage Portfolio entity detail pages.

## Product goal

Systematize Intuit Enterprise Suite multi-entity accounting, close, consolidation, and finance hygiene so incomplete items become team tasks. Staff Finance focuses on exceptions, close judgment, and auditor support.

## Architecture

| Lane | Where | What |
|------|-------|------|
| **Overview** | `/sales/finance` | Counts + links into workspaces |
| **Compliance / controls** | `/sales/finance/controls` | Audit matrix for **Tage parent** (`entity_id` null) and **each subsidiary** |
| **Month End Close** | `/sales/finance/month-end` | Per-entity monthly close checklist (`YYYY-MM`) |
| **Year End Close** | `/sales/finance/year-end` | Per-entity annual close checklist (`YYYY`) |
| **Tasks** | `/sales/finance/tasks` | Incomplete controls → `finance_tasks` → optional `sales_tasks` / portal To Do |

Do **not** put the audit matrix or close checklists on entity detail pages. Filter by company inside Finance workspaces instead.

## Apply database migrations

Run on Supabase project `hqmobgtnedmhzipusert` (SQL Editor or `supabase db push`):

1. `supabase/migrations/0027_finance_accounting_audit.sql` — templates, controls, tasks, seeds, auto-provision triggers
2. `supabase/migrations/0030_audit_evidence_and_review.sql` — evidence file columns, `audit-evidence` storage, due defaults, mark-reviewed RPC
3. `supabase/migrations/0034_finance_close_periods.sql` — month/year close periods, checklist templates/items, tasks, provision + roll-forward RPCs

Requires prior migrations through `0026` (Legal corporate audit).

Creates / extends:

| Object | Purpose |
|--------|---------|
| `finance_control_templates` | Durable catalog (50 controls) for seed + auto-provision |
| `finance_controls` | Parent + subsidiary matrix rows |
| `finance_tasks` | Open work items linked to incomplete controls |
| `finance_close_item_templates` | Month/year close checklist catalog (standard close steps + audit areas) |
| `finance_close_periods` | Per entity + period (`month`/`YYYY-MM` or `year`/`YYYY`); status open \| in_progress \| closed |
| `finance_close_items` | Checklist instance rows with evidence + due dates |
| `finance_close_tasks` | Incomplete close items → tasks → portal To Do |
| `open_finance_close_period()` / `provision_finance_close_period()` | Open/seed a period checklist for parent or entity |
| `ensure_finance_close_periods_for_year()` | Seed all 12 months + year for parent + active entities |
| `complete_finance_close_period()` | Mark closed; auto-open next month/year |
| `mark_finance_close_item_done()` | Done + close linked tasks; auto-complete period when all done/na |
| `create_finance_close_tasks_for_incomplete()` | Idempotent close task rows |
| Evidence columns | `evidence_storage_path`, `evidence_file_name`, `evidence_mime_type` |
| Storage bucket `audit-evidence` | Private evidence file attach |
| Trigger on `ops_entities` insert/status | Auto-seed controls **and** current-year close periods for new/activated subsidiaries |

RLS: active sales users with the **Accounting and Finance** portal (admins always).

## Assign portal access

Admin → **Assignments** (`/sales/admin/portals`) → grant **Accounting and Finance**.

## Routes (after deploy)

| Path | Page |
|------|------|
| `/sales/finance` | Overview |
| `/sales/finance/controls` | Compliance / controls matrix |
| `/sales/finance/month-end` | Month End Close |
| `/sales/finance/year-end` | Year End Close |
| `/sales/finance/tasks` | Control-linked tasks + Portal To Do panel |

Legacy stub URL `/sales/portals/accounting-finance` redirects to the live home.

## Month / year-end close

1. Open **Month End Close** or **Year End Close**
2. Filter **company** (Tage parent or a subsidiary) and pick **period** (`YYYY-MM` or year)
3. If empty: **Seed YYYY periods** (full year for all entities) or **Open / seed checklist** for the selected scope
4. Expand rows → mark **Done** / attach evidence / set due dates
5. **Tasks for incomplete** creates `finance_close_tasks` and pushes to portal To Do
6. **Mark period closed** (or finish every item) → auto-opens the next month/year checklist

How entities get checklists:

- Migration `0034` seeds the **current calendar year** (12 months + year) for parent + each active/forming/acquired `ops_entities`
- New entities (or status flip into active/forming/acquired) get the current year's periods via DB trigger
- UI **Seed / Open** calls `ensure_finance_close_periods_for_year` / `open_finance_close_period` (idempotent)

## Audit source

- Local copy (gitignored): `docs/finance/Finance and Accounting Functions and Audit.docx`
- README: `docs/finance/README.md`
- Seed: migration `0027` — **50 template controls** (45 audit + 5 recommended)
- Close seed: migration `0034` — month/year checklist templates mapped to control keys where relevant

## Parent vs subsidiary

| Scope | `entity_id` | How to filter in UI |
|-------|-------------|---------------------|
| Parent (Tage) | `null` | Compliance / Close → “Tage parent” |
| Subsidiary | `ops_entities.id` | Filter by company name |

## Evidence attach

On Compliance / controls or Close checklists → expand a row → **Attach evidence file** (or paste an Evidence URL). Files land in private Storage bucket `audit-evidence`.

## Phase roadmap

1. **Phase 1 (shipped)** — Finance audit seed, auto-provision, tasks sync, Finance nav
2. **Phase 2 (shipped)** — Evidence file attach, per-control due / cadence roll-forward on review
3. **Phase 3 (this)** — Month/year-end close calendar: per-entity checklists, evidence, tasks, roll-forward
4. **Later** — Assignment routing to Finance portal users; registered-agent filing handoff (no SoS auto-login)

## Customer master (Recruit 619)

**Going forward, Recruit 619 Customer / Client master lives in Intuit Enterprise Suite (IES)** — not the legacy QBO company. One-time Customer-only migration (no invoices/AR history): Recruiting Tools `docs/QBO_TO_IES_CUSTOMER_MIGRATION.md`. Future SF ↔ IES AR sync is a later phase.

## Related docs

- Legal: `SETUP_LEGAL.md`
- Human Resources: `SETUP_HR.md`
- Microsoft To Do / calendar: `SETUP_CALENDAR.md`
- Portal assignments: README + `/sales/admin/portals`
