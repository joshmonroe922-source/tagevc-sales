# Legal portal setup

Shared-services Legal lives under **`/sales/legal`** (portal slug `legal`).  
It is **not** an entity-level portal — corporate audit controls, filings, and legal tasks stay in Legal, not on Manage Portfolio entity detail pages.

## Product goal

Minimize Legal headcount for checklistable hygiene. Staff Legal should focus on **doc/contract review, disputes, and pressing matters**. Everything else is systematized here.

## Architecture

| Lane | Where | What |
|------|-------|------|
| **Overview** | `/sales/legal` | Counts + links into workspaces |
| **Corporate audit** | `/sales/legal/controls` | Audit matrix for **Tage parent** (`entity_id` null) and **each subsidiary** |
| **Tasks** | `/sales/legal/tasks` | Incomplete controls → `legal_tasks` → optional `sales_tasks` / Tage · Legal To Do |
| **Filings** | `/sales/legal/filings` | Cadenced licenses/renewals (`ops_compliance_items`) |
| **Contracts** | `/sales/legal/contracts` | Placeholder for attorney contract-review queue |
| **RA notices** | `/sales/legal/ra-notices` | Registered agent / URA mail from Outlook (Phase 1 search) |

Do **not** put the audit matrix on entity detail pages. Filter by company inside Corporate audit instead.

## Apply database migration

Run on Supabase project `hqmobgtnedmhzipusert` (SQL Editor or `supabase db push`):

1. `supabase/migrations/0026_legal_corporate_audit.sql` — templates, controls, tasks, seeds, auto-provision triggers

Requires prior migrations through `0025` (HR) and `0023` (Legal portal RLS for filings).

Creates / extends:

| Object | Purpose |
|--------|---------|
| `legal_control_templates` | Durable catalog (74 controls) for seed + auto-provision |
| `legal_controls` | Parent + subsidiary matrix rows |
| `legal_tasks` | Open work items linked to incomplete controls |
| `provision_legal_controls_for_entity()` | Clone entity-applicable templates |
| `create_legal_tasks_for_incomplete()` | Idempotent task rows for open/gap/in_progress |
| Trigger on `ops_entities` insert/status | Auto-seed controls for new/activated subsidiaries |
| HR extras | 5 recommended `hr_compliance_controls` from Employee Matters overlap |

RLS: active sales users with the **Legal** portal (admins always).

## Assign portal access

Admin → **Assignments** (`/sales/admin/portals`) → grant **Legal**.

## Routes (after deploy)

| Path | Page |
|------|------|
| `/sales/legal` | Overview |
| `/sales/legal/controls` | Corporate audit matrix |
| `/sales/legal/tasks` | Control-linked tasks + Portal To Do panel |
| `/sales/legal/filings` | Licenses / renewals |
| `/sales/legal/contracts` | Contracts stub |
| `/sales/legal/ra-notices` | Registered agent / URA Outlook notices |

Legacy stub URL `/sales/portals/legal` redirects to the live home.

## Audit source

- Local copy (gitignored): `docs/legal/Corporate Audit Checklist - 619 Recruiting.docx`
- README: `docs/legal/README.md`
- Seed: migration `0026` — **74 template controls** (71 audit + 3 recommended extras)
- Each applicable control is seeded for **parent** and for **active/forming/acquired** `ops_entities`
- Parent-only examples: structure chart, portfolio investments, business succession pack
- Both scopes: formation docs, contracts, insurance, IP, privacy, advertising, geography, tax FEIN, employee-matters legal hygiene

## Parent vs subsidiary

| Scope | `entity_id` | How to filter in UI |
|-------|-------------|---------------------|
| Parent (Tage) | `null` | Corporate audit → “Tage parent only” |
| Subsidiary | `ops_entities.id` | Filter by company name |

New entities (or status flip into active/forming/acquired) automatically receive entity-applicable template controls via DB trigger.

## Incomplete → tasks

1. Migration seeds open `legal_tasks` for incomplete controls
2. UI **Tasks for incomplete** / **Sync incomplete → To Do** calls `create_legal_tasks_for_incomplete` then `createTask(..., portal_slug: 'legal')` (Microsoft list **Tage · Legal**)
3. Gaps get high importance when pushed to To Do

## HR overlap (from this audit)

Also seeded into HR Compliance (parent + entities) when migration runs:

- Separation / termination agreement (form)
- Executive confidentiality & non-compete
- Employee vs IC headcount classification
- Employee privacy disclosures (company)
- Background check practice review

Onboarding/offboarding templates also gain background-check and separation checklist steps.

## Review due dates + evidence files

Each control row is **independent** (Tage parent = `entity_id` null; each subsidiary has its own row):

| Field | Meaning |
|-------|---------|
| `cadence` | Review frequency (annual default; monthly / quarterly / one_time / custom) |
| `next_due_at` | Next review/filing due — **set per entity** (e.g. annual report date differs by company) |
| `last_reviewed_at` | Last completed review |
| `evidence_*` | File in private Storage bucket `audit-evidence`, plus optional URL/notes |

**UI:** Corporate audit → expand a control → set **Next due** / **Review frequency** → **Attach evidence file** → **Mark reviewed (roll due)** to stamp `last_reviewed_at` and advance `next_due_at` by cadence. Overdue rows highlight in the list; open `legal_tasks.due_at` mirrors control `next_due_at`.

Apply (with Finance shared pieces): `0030_audit_evidence_and_review.sql`, then `0033_legal_hr_audit_due_review.sql` for Legal mark-reviewed + task due sync.

## Secretary of State — no credential auto-filing

**Generally no.** Most state Secretary of State portals do **not** offer official APIs to log in as the company and auto-file annual reports. Browser automation / credential scraping is fragile, often against ToS, and state-specific.

This portal intentionally does **not** build SoS login automation. Best practice:

1. Track **per-entity** annual report / SOS due dates on the relevant control rows
2. Human or **registered agent** files on the state site
3. Upload confirmation / stamped report as **evidence** on that control
4. Reminders via Legal tasks / Microsoft To Do (`Tasks for incomplete`)

Optional future: integrate a **registered agent / formation vendor API** (not raw SoS credentials). Soft stub only — no SoS password vault.

## Registered agent notices (Universal Registered Agents → Legal)

**Yes** — give URA a dedicated notice email, and land that mail where Legal reviews it in the portal.

### Josh admin steps (M365 + URA)

1. **Create a Microsoft 365 mailbox** (user mailbox or shared mailbox), e.g.:
   - `registered-agent@tagevc.com`, or
   - `legal-notices@tagevc.com`
2. **Grant Legal users access** — shared mailbox Full Access (and preferably Open shared with AutoMap), *or* forward a copy into each Legal user’s inbox.
3. **Update Universal Registered Agents** with that address as the notice / document-delivery email (client portal / EntitySafe contact, or by calling URA at (855) 236-9172). This is **admin-side on URA** — not Secretary of State auto-login.
4. URA typically **emails notifications** and uploads scans to their secure portal; they do **not** publish a public API for notice push into Tage. Prefer email + EntitySafe for document copies.

### How the portal ingests (Phase 1 vs Phase 2)

| Phase | Behavior | Status |
|-------|----------|--------|
| **Phase 1 (shipped)** | Legal → **RA notices** (`/sales/legal/ra-notices`) searches the signed-in user’s Outlook (Graph `microsoft-mail`) for messages matching `registered-agent@…`, `legal-notices@…`, `universalregisteredagents.com`, or “Universal Registered Agents”. Open thread → **Create Legal To Do** (Tage · Legal). | Live |
| **Phase 2 (not built)** | App-only / service mailbox token + Graph **subscription (webhook)** on new mail → insert `legal_tasks` (or `legal_ra_notices`) automatically. Needs extra Azure app permission + edge webhook infra. | Future |

**Requirement for Phase 1:** Legal users must **Connect Microsoft** with Mail scopes, and the RA mailbox mail must be **visible in that Graph mailbox** (shared access or forwarding). The portal does not yet open an arbitrary shared mailbox by SMTP address without user access.

### Prefer dedicated / shared mailbox

- Dedicated or shared `registered-agent@` / `legal-notices@` keeps personal inboxes clean and makes audit/forwarding clear.
- Give that one address to URA once; Legal users who have access see the same notices in **RA notices**.

## Phase roadmap

1. **Phase 1** — Corporate audit seed, auto-provision, tasks sync, Legal nav
2. **Phase 2** — Evidence attach (`audit-evidence` Storage) + annual due roll-forward (this)
3. **Phase 3** — Assignment routing to legal portal users; dispute workflow; optional registered-agent vendor
4. **RA notices** — Phase 1 Outlook search UI (this); Phase 2 webhook auto-tasks later

## Related docs

- Human Resources: `SETUP_HR.md`
- Finance / Marketing / Technology audit matrices: matching `SETUP_*.md`
- Microsoft To Do / calendar: `SETUP_CALENDAR.md`
- Portal assignments: README + `/sales/admin/portals`
