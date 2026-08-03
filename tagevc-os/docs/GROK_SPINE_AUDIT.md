# Grok spine pack — audit vs current Tage OS (2026-08-02)

**SSOT workbook:** `~/Downloads/Database Refresh.xlsx`  
**Master brief:** sheet `CURSOR_MASTER_PROMPT` · Build order: `12_Repo_Cursor_Pack` C0–C12

## Decision locked (from pack)

Tage OS = parent OS. Subsidiaries = apps on one spine: Entra → Supabase graph → enrichment worker → AI agents → product UIs. No per-app contact tables. User beats agent. No LinkedIn session scrapers.

## Current process (before this pack)

| Area | What exists today | Gap vs pack |
|------|-------------------|-------------|
| CRM graph | Deal-flow **leads** (`deal-flow-store`, website intake). No shared `accounts`/`contacts`/`employments`/`org_edges`. | Need canonical graph + org links |
| Enrichment | Apollo partner **stub** in `partners/adapters`. No waterfall, jobs, credit ledger, ZeroBounce gate. | Full C4–C6 |
| Email | Platform-email scaffold (Graph helper + pixel); live sends mostly Resend/ad-hoc; W-9 via `mailto:`. Josh locked M365 model. | Wire orchestrator; shared mailboxes for AP/W-9; CRM log on graph activities |
| Identity | Supabase auth + OS RBAC roles; not Entra JWT `org_ids[]` claims for graph RLS. | C2 Entra claims hook |
| Subsidiaries | Separate portals (R619 / Signent / INDA) + multi-sub registry; HRIS `client_org_id` for Signent. | Map portals → apps on graph; keep Signent client tenancy |
| Product tables | Recruit/NDA live in portals; not FK’d to shared graph. | C11 product FKs |
| Repo layout | `tagevc-os` Next app inside `tagevc-sales`; portals as sibling repos — **not** greenfield Turborepo. | **Adapt:** spine packages live in `tagevc-os/src/lib/spine` + `supabase/migrations/spine`; worker under `tagevc-os/apps/worker`; portals consume later |

## Prior Josh decisions (integrate, don’t drop)

- Email: user M365 1:1; bulk tracked + Reply-To user; shared M365 AP/W-9; opens/clicks analytics; signature AI = backlog
- Website→lead → graph account/contact bootstrap (agent.routing)
- DocuSign entity sync, Signent `client_org_id` empty structure, D06=C intake outbox
- Instant NDA App Store: do not block

## Adaptation map (pack → this repo)

| Pack path | This repo |
|-----------|-----------|
| `apps/tage-admin` | `tagevc-os` (Next 15) |
| `apps/recruit619` | sibling `recruit619-portal` (wire later C11) |
| `apps/signent` | sibling `signenthr-portal` |
| `apps/instant-nda` | sibling `instantnda-portal` |
| `apps/worker` | `tagevc-os/apps/worker` |
| `packages/db` | `tagevc-os/src/lib/spine/db` |
| `packages/enrichment` | `tagevc-os/src/lib/spine/enrichment` |
| `packages/agents` | `tagevc-os/src/lib/spine/agents` |
| `supabase/migrations` | `tagevc-os/supabase/migrations/spine/0001–0008` + apply bundle `phase94_graph_spine.sql` |

## Phase progress (2026-08-02 build)

| Phase | Status |
|-------|--------|
| C0 layout | Adapted — `src/lib/spine/*`, `apps/worker`, migrations under `supabase/migrations/spine` |
| C1 schema+RLS+seed | **Shipped** — `0001–0010` + apply bundle `phase94_graph_spine.sql` |
| C2 Entra claims | **SQL hook** `phase95_spine_claims_hook.sql` + Edge scaffold; Dashboard enable still Josh |
| C3 graph CRUD UI | `/shared-services/crm` + account/contact detail + create forms + APIs · Admin nav |
| C4 worker | `apps/worker` mock `account.bootstrap` |
| C5–C6 Apollo/waterfall | Live providers fail-closed; Admin → Enrichment + `ENRICHMENT_LIVE_FLIP.md` |
| C7 hierarchy | Account org-chart panel + rule suggester + accept/reject |
| C8 suggestions | `/shared-services/crm/suggestions` inbox + contact pending updates |
| C9 Cmd-K + site research | Global `CmdKPalette` + account site-research agent (public meta) |
| C10 brief | Graph-derived account brief + tool-gated `/api/spine/copilot` |
| C11 product FKs | Signent convert + client detail ops scaffolds; portals later |
| C12 budgets | Org budgets + kill switch UX on Admin → Enrichment |
| Website→graph | Per-entity org routing (`entity` / `/website-intake/[entity]`) |
| DocuSign autofill/attach/send | Library-send + attach stash → webhook apply |
| Email / AP | W-9 campaign UI + AP poll cron (fail-closed without Graph) |
| CRM polish | Suggestion accept applies+locks · bell · job toaster · Cmd-K |
