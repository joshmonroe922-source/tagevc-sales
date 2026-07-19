# Human Resources portal setup

Shared-services HR lives under **`/sales/hr`** (portal slug `human-resources`).  
It is **not** an entity-level portal — compliance and people workflows stay in HR, not on Manage Portfolio entity detail pages.

## Architecture (two lanes)

| Lane | Where | What |
|------|-------|------|
| **Company compliance** | `/sales/hr/compliance` | Audit matrix for **Tage parent** and **each portfolio entity** — policies, records, evidence expectations, owner, due date, gap/compliant status |
| **Employee files** | `/sales/hr/employees` → `/sales/hr/employees/:id` | Per-person digital file: prospect → talent acquisition → onboarding → tenure → offboarding |

Do **not** put the audit matrix on entity detail pages. Filter by company inside HR Compliance instead.

## Talent acquisition → onboarding flow

1. **Add prospect** — Employees → Add prospect / employee (defaults to **Prospect**). Creates a talent acquisition checklist.
2. Work the **Talent acquisition** checklist (resume screen → offer accepted).
3. **Offer accepted → Onboarding** on the employee file closes TA and starts the Signent/TAGE onboarding template (`signent-onboarding-v1`).
4. Completing onboarding moves status to **Active**.

Templates are seeded in migration `0035` (`hr_checklist_templates` / `hr_checklist_template_items`). Signent-specific steps are tagged `scope = signent` (mark N/A for parent-only hires when not applicable).

## Apply database migrations

Run in order on Supabase project `hqmobgtnedmhzipusert` (SQL Editor or `supabase db push`):

1. `supabase/migrations/0024_hr_foundation.sql` — employees, checklists, compliance table
2. `supabase/migrations/0025_hr_compliance_audit_and_employee_files.sql` — audit seed + employee documents/activities
3. `supabase/migrations/0035_hr_talent_acquisition_onboarding.sql` — talent acquisition kind, template tables, Signent onboarding seed

Creates / extends:

| Table | Purpose |
|-------|---------|
| `hr_employees` | Parent (`entity_id` null) + portfolio people (`prospect` default) |
| `hr_onboarding_checklists` / `hr_checklist_items` | Per-employee talent acquisition, onboarding & offboarding runs |
| `hr_checklist_templates` / `hr_checklist_template_items` | Seeded template catalog |
| `hr_compliance_controls` | Company-scoped audit controls |
| `hr_employee_documents` | Documents / acks on the employee file |
| `hr_employee_activities` | Tenure timeline (notes, status, checklist, docs) |

RLS: active sales users with the **Human Resources** portal (admins always).

## Assign portal access

Admin → **Assignments** (`/sales/admin/portals`) → grant **Human Resources**.

## Routes (after deploy)

| Path | Page |
|------|------|
| `/sales/hr` | → Employees directory |
| `/sales/hr/employees` | Directory (filter Prospect / Onboarding / Active) |
| `/sales/hr/employees/:id` | **Employee file** (overview / talent / onboarding / tenure / offboarding) |
| `/sales/hr/talent-acquisition` | Cross-employee talent acquisition queue |
| `/sales/hr/onboarding` | Cross-employee onboarding queue |
| `/sales/hr/offboarding` | Cross-employee offboarding queue |
| `/sales/hr/compliance` | Company audit matrix (parent + entities) |

Legacy stub URL `/sales/portals/human-resources` redirects to the live home.

## Audit source

- Local copy (gitignored): `docs/hr/HR Compliance Audit.pdf`
- Seed: migration `0025` — **81 audit controls** + **15 recommended** best-practice controls
- Each applicable control is seeded for **parent** (`entity_id` null) and for **active/forming/acquired** `ops_entities`
- UI labels **Recommended** distinctly from **From audit**

Evidence expectations from the PDF (Latest File, Actual Sample(s), On-Site Inspection) are stored on each control.

## Onboarding source (Signent)

- Local copy (gitignored): `docs/hr/TAGE Global - Onboarding Checklist - Signent.docx`
- Parse notes: `docs/hr/_onboarding_checklist_notes.md`
- Seed: migration `0035` — talent acquisition (8 steps) + Signent onboarding (44 steps) + offboarding

## Phase roadmap

1. **Phase 1 (shipped)** — Employees, checklist templates, compliance CRUD foundation
2. **Phase 2 (shipped)** — Audit seed + employee file; audit hooks on checklists
3. **Phase 2b (this)** — Prospect status, talent acquisition checklist, Signent onboarding template, advance-to-onboarding
4. **Phase 3** — Payroll / IT / asset integrations via `system_hook` + Edge Functions
5. **Phase 4** — Swag / marketing partner webhooks
6. **Later** — Upload binary HR docs into private Storage; payroll APIs

## What to provide later (never commit secrets)

| Integration | What to provide |
|-------------|-----------------|
| Payroll | Vendor, OAuth/API via Supabase secrets only |
| IT provisioning | IdP + app assignment owner |
| Asset audit | System of record |
| Document vault | Prefer portal Files / OneDrive links on employee docs until Storage is wired |

## Related docs

- Legal (corporate audit + filings): `SETUP_LEGAL.md` and `/sales/legal`
- Microsoft Files / vault: `SETUP_CALENDAR.md`
- Portal assignments: README + `/sales/admin/portals`
