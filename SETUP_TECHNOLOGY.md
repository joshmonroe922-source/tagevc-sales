# Technology portal setup

Shared-services Technology lives under **`/sales/technology`** (portal slug `technology`).  
It is **not** an entity-level portal — audit controls and technology tasks stay in Technology, not on Manage Portfolio entity detail pages.

## Product goal

Systematize hybrid parent/subsidiary technology (strategy, infra, apps, data, security, support, Suite integrations) so incomplete items become team tasks.

## Architecture

| Lane | Where | What |
|------|-------|------|
| **Overview** | `/sales/technology` | Counts + links into workspaces |
| **Compliance / controls** | `/sales/technology/controls` | Audit matrix for **Tage parent** (`entity_id` null) and **each subsidiary** |
| **Tasks** | `/sales/technology/tasks` | Incomplete controls → `technology_tasks` → optional `sales_tasks` / portal To Do |

Do **not** put the audit matrix on entity detail pages. Filter by company inside Compliance / controls instead.

## Apply database migration

Apply migrations:

1. `supabase/migrations/0029_technology_plan_audit.sql` — templates, controls, tasks, seeds, auto-provision triggers
2. `supabase/migrations/0030_audit_evidence_and_review.sql` — shared evidence columns + `audit-evidence` bucket + due helpers
3. `supabase/migrations/0032_technology_control_evidence_due.sql` — Technology due seed, `mark_technology_control_reviewed`, task due sync

Requires prior migrations through `0028` (Marketing plan audit). Legal=`0026`, Finance=`0027`, Marketing=`0028`, Technology seed=`0029`.

Creates:

| Object | Purpose |
|--------|---------|
| `technology_control_templates` | Durable catalog (**71** controls) for seed + auto-provision |
| `technology_controls` | Parent + subsidiary matrix rows |
| `technology_tasks` | Open work items linked to incomplete controls |
| `provision_technology_controls_for_entity()` | Clone entity-applicable templates |
| `create_technology_tasks_for_incomplete()` | Idempotent task rows for open/gap/in_progress |
| Trigger on `ops_entities` insert/status | Auto-seed controls for new/activated subsidiaries |

RLS: active sales users with the **Technology** portal (admins always).

## Assign portal access

Admin → **Assignments** (`/sales/admin/portals`) → grant **Technology**.

## Routes (after deploy)

| Path | Page |
|------|------|
| `/sales/technology` | Overview |
| `/sales/technology/controls` | Compliance / controls matrix |
| `/sales/technology/tasks` | Control-linked tasks + Portal To Do panel |

Legacy stub URL `/sales/portals/technology` redirects to the live home.

## Audit source

- Local copy (gitignored): `docs/technology/Technology Plan and Audit.docx`
- README: `docs/technology/README.md`
- Seed: migration `0029` — **71 template controls** (66 audit + 5 recommended)
- Each applicable control is seeded for **parent** and for **active/forming/acquired** `ops_entities`
- Parent-only examples: group strategy/governance, Zero Trust framework, central IAM/SIEM, ITSM, BCDR plans, API management
- Both scopes: entity roadmaps, local infra/apps/helpdesk, Suite data flows, Suite RBAC, entity budgets, local security

## Parent vs subsidiary

| Scope | `entity_id` | How to filter in UI |
|-------|-------------|---------------------|
| Parent (Tage) | `null` | Compliance → “Tage parent only” |
| Subsidiary | `ops_entities.id` | Filter by company name |

New entities (or status flip into active/forming/acquired) automatically receive entity-applicable template controls via DB trigger (mirrors Legal/Finance/Marketing).

## Incomplete → tasks

1. Migration seeds open `technology_tasks` for incomplete controls (due = control `next_due_at`)
2. UI **Tasks for incomplete** / **Sync incomplete → To Do** calls `create_technology_tasks_for_incomplete` then `createTask(..., portal_slug: 'technology')`
3. Gaps get high importance when pushed to To Do
4. Marking reviewed closes open control-linked tasks; when `next_due_at` arrives again, controls reopen and new tasks are created

## Evidence files + annual review

| Feature | Behavior |
|---------|----------|
| **Per-entity due** | Filter Compliance → company; edit **Next due** on that row only |
| **Review frequency** | Column is **`cadence`** (annual default) — shared name across Legal/Finance/Marketing/Technology |
| **Mark reviewed** | RPC `mark_technology_control_reviewed` sets `last_reviewed_at`, status `compliant`, rolls `next_due_at` by cadence |
| **Evidence file** | Upload into `audit-evidence` bucket path `technology/{parent\|entityId}/{controlId}/…` |
| **SoS login** | **Not built** — no Secretary of State credential automation; attach filed PDFs as evidence after humans/registered agents file |

## Overlap with Finance / Legal / Marketing (do not duplicate here)

| Topic | Owns |
|-------|------|
| Intuit Suite close, consolidation, GL/AR/AP | Finance |
| Corporate filings, contracts, claims policies | Legal |
| MarTech stack, campaign tools, content ops | Marketing |
| Hybrid IT strategy, infra, IAM, integrations into Suite | **Technology** |

Technology owns the platform/integration/security layer — not finance close books or marketing campaign execution.

## Phase roadmap

1. **Phase 1 (this)** — Technology audit seed, auto-provision, tasks sync, Technology nav
2. **Phase 2** — Evidence links into Microsoft Files / document vault
3. **Phase 3** — Security review calendar + assignment routing to Technology portal users

## Related docs

- `SETUP_FINANCE.md`, `SETUP_LEGAL.md`, `SETUP_HR.md`
- `docs/technology/README.md`
