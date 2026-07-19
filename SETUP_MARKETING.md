# Marketing portal setup

Shared-services Marketing lives under **`/sales/marketing`** (portal slug `marketing`).  
It is **not** an entity-level portal — plan & audit controls and marketing tasks stay in Marketing, not on Manage Portfolio entity detail pages.

Content ops (Blog / Social) remain under `/sales/content` and stay part of the same Marketing portal nav.

## Product goal

Systematize marketing hygiene across **Tage parent** and **each subsidiary**: strategy, brand, channels, budget/ROI, analytics, MarTech, team, compliance, and review — with incomplete controls becoming team tasks.

## Architecture

| Lane | Where | What |
|------|-------|------|
| **Overview** | `/sales/marketing` | Counts + links into workspaces |
| **Plan & audit** | `/sales/marketing/controls` | Audit matrix for **Tage parent** (`entity_id` null) and **each subsidiary** |
| **Tasks** | `/sales/marketing/tasks` | Incomplete controls → `marketing_tasks` → optional `sales_tasks` / Tage · Marketing To Do |
| **Content** | `/sales/content` | Existing blog + social hub |

Do **not** put the audit matrix on entity detail pages. Filter by company inside Plan & audit instead.

## Apply database migrations

Run on Supabase project `hqmobgtnedmhzipusert`:

1. `0028_marketing_plan_audit.sql` — templates, controls, tasks, seeds, auto-provision
2. `0030_audit_evidence_and_review.sql` — shared helpers (`advance_due_by_cadence`), `audit-evidence` bucket, shared evidence columns
3. `0031_marketing_control_evidence_due.sql` — Marketing due seed, `mark_marketing_control_reviewed`, task due sync

**Shared pattern:** `cadence` **is** the review frequency (annual default). Do not add a separate `review_frequency` column. Each control row (parent or entity) has its own `next_due_at`.

## Due dates & annual review

| Capability | How |
|------------|-----|
| **Per-entity dates** | Filter by company in Plan & audit → expand row → **Next due** |
| **Review frequency** | UI label for `cadence` (annual / monthly / quarterly / one-time / custom) |
| **Roll-forward** | **Reviewed** calls `mark_marketing_control_reviewed` → stamps `last_reviewed_at`, advances `next_due_at`, closes open tasks |
| **Tasks** | Task `due_at` = control `next_due_at`; trigger keeps them in sync; sync to To Do carries the due date |

## Evidence files

Expand a control → **Choose file** (or Evidence URL). Storage: bucket `audit-evidence`, path `marketing/{control_id}/…`. Shared UI: `ControlEvidenceEditor`.

## Secretary of State / state filings

**We do not auto-login to state Secretary of State portals.** Most SoS sites lack official filing APIs; credential scraping is fragile and often against terms. For annual reports / SoS filings, use Legal filings due dates + evidence upload after a human or registered agent files. Future option: registered-agent vendor APIs — not raw SoS login.

## Assign portal access

Admin → **Assignments** (`/sales/admin/portals`) → grant **Marketing**.

## Routes

| Path | Page |
|------|------|
| `/sales/marketing` | Overview |
| `/sales/marketing/controls` | Plan & audit matrix |
| `/sales/marketing/tasks` | Control-linked tasks + Portal To Do |
| `/sales/content` | Content hub |

## Audit source

- Local (gitignored): `docs/marketing/Marketing Plan and Audit.docx`
- Seed: migration `0028` — **69 template controls** (64 audit + 5 recommended)
