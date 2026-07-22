# Tage VC Operating System (Phase 0)

Next.js 15 rebuild of the Tage internal OS, driven by **Tage VC Operating System** Excel (`docs/spec/Tage-VC-Operating-System.xlsx`).

The existing Vite portal at repo root (`portal.tagevc.com`) is **unchanged**. This app lives in `tagevc-os/` until cutover.

## Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase (Auth + Postgres)
- React Hook Form + Zod (ready for forms)

## Phase 0 scope

| Area | Status |
|------|--------|
| Folder structure | Done |
| Microsoft login (Supabase Azure provider) | Done |
| RBAC foundation (roles + permissions + nav gating) | Done |
| Core TypeScript types (enums + entities) | Done |
| Main layout + sidebar nav | Done |
| Command Center shell | Done |

## Phase 1 scope

| Area | Status |
|------|--------|
| Expanded types + Zod schemas (Entity Master / Portfolio Active) | Done |
| Seed data from Excel (period 2026-03) | Done |
| Portfolio roll-up (SUM / WEIGHTED / MIN / COUNT) | Done |
| Portfolio Active list + company detail | Done |
| Command Center wired to portfolio + funnel seeds | Done |
| SQL stub for future Supabase tables | `supabase/phase1_portfolio.sql` |

### Try Portfolio

```bash
cd tagevc-os && npm run dev
```

Open `/command-center` and `/portfolio` (and `/portfolio/PF-002` for Instant NDA).

## Phase 2 scope (VC Deal Flow)

| Area | Status |
|------|--------|
| Pipeline Active list + create lead | Done |
| Stage progression + Lead Process Library spawn-once | Done |
| Lead detail + Lead Tasks | Done |
| Convert Ready for DD → Deal Active | Done |
| Command Center funnel wired to live pipeline/tasks/deals | Done |

### Try VC Deal Flow

- `/deal-flow/vc` — Pipeline Active
- `/deal-flow/vc/leads/LD-005` — Orbit Data (Ready for DD → Open Deal Active)
- `/deal-flow/vc/deals` — Deal Active list

## Phase 3 scope (Shared Services + Grok/Cursor)

| Area | Status |
|------|--------|
| Ticket model + diagnose (AUTO/DRAFT/ESCALATE) | Done |
| Forbid-list + allow-list policy engine | Done |
| Ticket list/detail/create + draft approve/reject | Done |
| Append-only agent audit log | Done |
| SQL stub | `supabase/phase3_shared_services.sql` |

### Try Shared Services

- `/shared-services` — band counts + ticket queue
- Seed examples: TK-001 AUTO, TK-002 DRAFT, TK-003/004 ESCALATE (wire / Health)

## Phase 4 scope (Documents + DocuSign)

| Area | Status |
|------|--------|
| Document model + entity folder taxonomy | Done |
| Templates + merge fields | Done |
| Upload / organize into folders | Done |
| DocuSign send + webhook stub | Done |
| Human gate on capital docs | Done |

### Try Documents

- `/documents` — library index
- `/documents/entities/ENT-002` — Instant NDA folders
- Create Term Sheet → must Click **Send via DocuSign** (human)
- `POST /api/docusign/webhook` with `{ "envelope_id", "status" }`

## Phase 4.5 scope (AI Document Intelligence)

| Area | Status |
|------|--------|
| `analyzeDocument` heuristic_v1 (dates, obligations, missing companions) | Done |
| Auto-attach review on upload / template create | Done |
| Auto-open Shared Services tickets (`ai_generated`) | Done |
| Human accept / dismiss / edit suggestions on doc page | Done |
| Seed COI (DOC-002) with expiration language | Done |

### Flow

1. **Upload** (or create from template) → document stored with `ai_review: null`
2. **AI Review** runs immediately (`heuristic_v1`) → summary, expiration/renewal, suggestions
3. **Action Creation** → each suggestion opens an Open ticket titled `[AI] …` linked to `/documents/{doc_id}`
4. **Human review** on the document page: Accept / Dismiss / edit title·due (suggestion stays `pending` until accept/dismiss)

Engine is swappable: replace `analyzeDocument` in `src/lib/documents/ai-review.ts` with an LLM implementation without changing callers.

### Try AI Document Intelligence

- `/documents/DOC-002` — seed Certificate of Insurance (already reviewed)
- `/shared-services` — look for **AI** badge tickets from DOC-002
- Upload a new doc with `Expiration: 2026-09-30` in the content field

## Phase 5 scope (Expanded Deal Flow)

| Area | Status |
|------|--------|
| Enums aligned to Data Dictionary (M&A stages, RE Onboard, Post-Close, IC) | Done |
| Shared spawn-once + track modules (`vc/` · `ma/` · `re/`) | Done |
| VC Deal Active + Deal Process Library (DX-##) stage spawn | Done |
| IC queue / decision logging + audit trail | Done |
| Lead → Deal conversion opens IC review + deal tasks | Done |
| Full M&A Buy track (pipeline, tasks, detail, Integration handoff) | Done |
| RE Buy foundation (Residential / Commercial, stages, tasks) | Done |
| Deal Flow hub + Pipeline ↔ Deal ↔ IC nav | Done |
| Portfolio Handoff seam (PH-### Ready for Portfolio) | Done |

### Tracks (Excel Process Map)

- **VC Invest:** Sourced → … → Ready for DD → Deal Active (IC Approved → … → Wired / Closed → Post-Close)
- **M&A Buy:** Sourced → CIM Review → Management Meeting → IOI / Indication → LOI / Exclusivity → Confirmatory DD → Definitive Docs → Closing → Integration
- **RE Buy:** Sourced → Screen → Underwriting → Offer → LOI / PSA → Diligence → Closing → Onboard

### Try Phase 5

- `/deal-flow` — hub (VC / M&A / RE)
- `/deal-flow/vc` — Pipeline · `/deal-flow/vc/deals/DE-001` — Orbit Data desk + IC
- `/deal-flow/vc/ic` — IC queue
- `/deal-flow/ma` · `/deal-flow/ma/MA-001` — Midwest Ops Co (LOI / Exclusivity)
- `/deal-flow/re` · `/deal-flow/re/RE-001` — Maple St (Residential UW)
- Advance MA to **Integration** or RE to **Onboard** / VC to **Wired / Closed** → creates PH handoff stub

### Still future

- Full DD Needs Completed tracker · Scorecard / Financial Model UI
- M&A Integration Day-1/100 workstreams UI · M&A Scorecard/Model
- RE Underwrite blocks · RE Portfolio (PFRE) persistence
- Wire Entity Master + Portfolio Active from handoff (currently Ready for Portfolio stub)
- Persist stores to Supabase (phase SQL stubs)

## Phase 6 scope (Entity Pages + Subsidiary OS + Lead Intake)

| Area | Status |
|------|--------|
| Subsidiary OS aggregate (`getEntityOperatingView`) | Done |
| Entity hub + detail (`/entities`, `/entities/[entityId]`) | Done |
| Portfolio company pages reuse Entity OS surface | Done |
| CORE vs FLEX KPI distinction (catalog + UI badges) | Done |
| Linked docs / SS tickets / leads / Deal Flow tasks | Done |
| Inbound Lead Intake (`/deal-flow/vc/intake`) + `related_entity_id` | Done |
| Seed Instant NDA (ENT-002) demo pack | Done |
| SQL stub | `supabase/phase6_entity_os.sql` |

### Subsidiary OS sections (Platform Spec §8)

Overview · Financials · CORE KPIs · FLEX KPIs · Leads · Tasks (Deal Flow vs SS) · Docs · SS tickets

### Try Phase 6

- `/entities/ENT-002` — Instant NDA Subsidiary OS (docs, AI tickets, CORE+FLEX, LD-006/LD-007)
- `/portfolio/PF-002` — same OS via Portfolio Active
- `/deal-flow/vc/intake` — inbound intake with optional related entity
- `/entities` — subsidiary hub

### Still future (post Phase 6)

- Full DD Needs Completed tracker · Scorecard / Financial Model UI
- M&A Integration Day-1/100 workstreams UI · M&A Scorecard/Model
- RE Underwrite blocks · RE Portfolio (PFRE) persistence
- Handoff → auto-issue ENT + Portfolio Active row
- Live website webhook → intake (edge function cutover)

## Phase 7 scope (Production Readiness)

Live at **https://app.tagevc.com**. Focus: stability, persistence across redeploys, auth UX, activity.

| Area | Status |
|------|--------|
| Microsoft login error surfacing + production redirect hints | Done |
| `DEV_BYPASS_AUTH` disabled in production | Done |
| Supabase JSONB store snapshots (VC / MA / RE / tickets / docs) | Done — apply `supabase/phase7_production.sql` |
| Hydrate on app layout + debounced persist | Done |
| Activity log (`/activity`) + Command Center recent feed | Done |
| Broadcast notifications (new lead, doc signed) | Done |
| App error / loading / not-found | Done |
| RBAC guards on VC / MA / RE / SS / Documents mutations | Done |
| Visionary full write access | Done |
| DocuSign webhook optional secret (`DOCUSIGN_WEBHOOK_SECRET`) | Done |
| `.env.example` production secrets checklist | Done |

### Required ops step

1. In Supabase SQL editor for project `opdqybaatfbwkokbzwli`, run **`supabase/phase7_production.sql`**.
2. Optionally set on Vercel: `SUPABASE_SERVICE_ROLE_KEY`, `DOCUSIGN_WEBHOOK_SECRET`.
3. Redeploy after merge so hydrate/persist ships.

### Still future (post Phase 7)

- Normalize JSONB snapshots → first-class Postgres tables (leads, deals, tickets, docs)
- Portfolio / Entity Master cutover from seed → live tables
- Per-user notification inbox + read/unread UI
- Real DocuSign Connect + storage buckets
- Observability (Sentry) · uptime checks · backup runbooks

## Phase 8 scope (Role Impersonation)

| Area | Status |
|------|--------|
| Visionary-only Role Switcher in sidebar | Done |
| httpOnly impersonation cookie (ignored unless real role is Visionary) | Done |
| Effective role drives nav + `guardPermission` / `requirePermission` | Done |
| Persistent “Viewing as … · Exit Impersonation” banner | Done |
| Exit impersonation + clear on sign-out | Done |
| Activity audit (`impersonation_start` / `impersonation_stop`) | Done |
| **Break-glass:** block IC vote, wire (`Wired / Closed`), capital DocuSign, `write:capital` while impersonating | Done |
| Break-glass UI messaging (banner, IC form, capital send, stage select) | Done |

### Break-glass rules

While Visionary is viewing as another role, these are blocked at permission **and** UI level:

- `action:ic_vote` — IC decisions
- `action:wire` — advancing Deal Active to **Wired / Closed**
- `action:docusign_capital` — DocuSign send on capital docs
- `write:capital` — firm capital mutations

Exit impersonation to unlock.

### Try Role Impersonation

1. Sign in as Visionary
2. Sidebar → **Role switcher** → pick Associate → **View as**
3. Confirm nav shrinks and banner appears (includes break-glass notice)
4. Open IC queue or a capital document — actions should be disabled
5. **Exit Impersonation** (banner or switcher)

## Phase 9 scope (Schema Normalization Foundation)

| Area | Status |
|------|--------|
| Stabilization of Phase 7–8 impersonation / activity UX | Done |
| Break-glass on capital DocuSign simulate webhook | Done |
| Activity/notifications distinguish empty vs load failure | Done |
| Impersonation context on activity audit rows | Done |
| `os_leads` + `os_lead_tasks` + `os_tickets` tables | Done — apply `supabase/phase9_normalized.sql` |
| Dual-write: mutations → JSONB snapshot **and** normalized tables | Done |
| Dual-read: prefer SQL rows when present; migrate snapshot→SQL once | Done |
| Deals / IC / docs / MA / RE still on JSONB snapshots | Deferred |

### Required ops step

Run **`supabase/phase9_normalized.sql`** in the tagevc-os Supabase SQL editor. After apply, create or edit a lead/ticket — rows should appear in Table Editor under `os_leads` / `os_tickets`. Snapshots continue as backup.

### Still future (post Phase 9)

- Normalize Deals, IC, Documents, MA, RE (stop writing those into JSONB)
- Portfolio Active + Entity Master live tables
- Drop snapshot dependency after dual-run soak
- Per-user notification read/unread inbox UI
- Real DocuSign Connect + storage · Sentry

## Phase 10 scope (Internal Messaging Foundation)

| Area | Status |
|------|--------|
| DM + small group chats | Done |
| Realtime send/receive + history | Done |
| Global Messages nav + unread badges | Done |
| Presence (online/offline) | Done |
| Schema stubs for entity linking + subsidiary scope | Done |
| SQL | Apply `supabase/phase10_messaging.sql` |

### Required ops step

Run **`supabase/phase10_messaging.sql`** in the tagevc-os Supabase SQL editor, then open `/messages`.

### Architecture (forward-looking)

- `entity_id` on conversations → subsidiary-scoped messaging later
- `linked_ref_type` / `linked_ref_id` → attach chats to leads, deals, entities, tasks
- `parent_id` on messages → threading without shipping thread UI yet
- `kind = channel` reserved; Phase 10 only uses `dm` and `group`

Docs: `docs/OS_PHASE10.md`

### Phase 11+ backlog (messaging)

- Entity / deal / lead / task linked conversations
- Subsidiary-scoped rooms
- Channels, @mentions, attachments, rich text
- Threading UI, search, push/email digests
- Retention / moderation tools

## Phase 11 scope (Contextual chat + Deals/Docs normalize)

| Area | Status |
|------|--------|
| Threading / replies | Done |
| Formatting + in-chat search | Done |
| Link chats to leads/deals/entities/tasks/tickets/docs | Done |
| Contextual Chat buttons on entity pages | Done |
| Chat notifications + richer Activity inbox | Done |
| `os_deals` / `os_deal_tasks` / `os_documents` dual-write | Done |
| SQL | Apply `supabase/phase11_chat_and_normalize.sql` |

### Required ops step

Run **`supabase/phase11_chat_and_normalize.sql`** in the tagevc-os Supabase SQL editor, then redeploy.

Docs: `docs/OS_PHASE11.md`

### Phase 12+ backlog

- Member invites on linked chats; task deep-links
- Channels / @mentions / attachments
- Normalize IC + MA/RE; snapshot retirement plan
- Push/email digests; DocuSign + storage

## Phase 12 scope (Channels + IC/MA normalize)

| Area | Status |
|------|--------|
| Channels | Done |
| @mentions + mention notifications | Done |
| Document attachments + reactions | Done |
| Global search + mobile chat panes | Done |
| Notification digest grouping | Done |
| `os_ic_reviews` + `os_ma_*` dual-write | Done |
| SQL | Apply `supabase/phase12_channels_and_normalize.sql` |

Docs: `docs/OS_PHASE12.md`

### Phase 13+ backlog

- Email/push digests + prefs
- RE normalization; snapshot retirement soak
- Binary file upload / storage
- Private channels + moderation
- Real DocuSign

## Phase 13 scope (Uploads + private channels + RE)

| Area | Status |
|------|--------|
| Chat file uploads (Storage) + previews | Done |
| Private channels + member management | Done |
| Soft-delete + channel settings + mute | Done |
| Notification prefs + digest API | Done |
| `os_re_deals` / `os_re_tasks` dual-write | Done |
| Snapshot retirement plan | Done — `docs/OS_SNAPSHOT_RETIREMENT.md` |
| SQL | Apply `supabase/phase13_uploads_and_re.sql` |

Docs: `docs/OS_PHASE13.md`

### Phase 14 scope (Portfolio/Entity + soak)

| Area | Status |
|------|--------|
| Entity Master + Portfolio Active SQL dual-read | Done |
| P&L / CORE+FLEX KPI sync from seed | Done |
| Shared dual-read gate + sync stats | Done |
| Normalization status API + counts view | Done |
| Snapshot retirement soak docs | Done — `docs/OS_SNAPSHOT_RETIREMENT.md` |
| SQL | Apply `supabase/phase14_portfolio_entity.sql` |

Docs: `docs/OS_PHASE14.md`

### Phase 15 scope (Write cutover + Portfolio edits)

| Area | Status |
|------|--------|
| Env-gated snapshot write cutover | Done |
| Handoffs + IC/ticket/doc audits dual-write | Done |
| Portfolio / Entity SQL-first edit forms | Done |
| Normalization status write-cutover fields | Done |
| SQL | Apply `supabase/phase15_write_cutover.sql` |

Docs: `docs/OS_PHASE15.md`

### Phase 16 scope (Cutover ops + observability)

| Area | Status |
|------|--------|
| `WRITE_CUTOVER_ALL` (MA/RE included) | Done |
| Snapshot soft-archive table + RPC + API | Done |
| Admin normalization health UI | Done |
| Optional Sentry (`SENTRY_DSN`) | Done |
| SQL | Apply `supabase/phase16_snapshot_archive.sql` |

Docs: `docs/OS_PHASE16.md`

### Phase 17 scope (Integrity + entity scope + UX)

| Area | Status |
|------|--------|
| FK validate + orphan cleanup | Done — `phase17_validate_fks.sql` |
| Entity-scoped RLS + app filters | Done — `phase17_entity_rls.sql` |
| Fixed sidebar shell | Done |
| Portfolio/Entity edit polish + admin FK health | Done |
| SQL | Apply both Phase 17 SQL files |

Docs: `docs/OS_PHASE17.md`

### Phase 18 scope (Snapshot drills + pipeline scope + CORE $)

| Area | Status |
|------|--------|
| Empty-snapshot drills + Stage 4 plan | Done |
| Pipeline entity RLS + scoped list pages | Done — `phase18_pipeline_entity_rls.sql` |
| CORE financial edits + audit | Done — `phase18_financial_audit.sql` |
| Soak health cron + Sentry tags | Done |
| SQL | Apply both Phase 18 SQL files |

Docs: `docs/OS_PHASE18.md` · `docs/OS_SNAPSHOT_STAGE4.md`

### Phase 19 scope (Stage 4b + KPI/FLEX + harder scope)

| Area | Status |
|------|--------|
| SQL-only hydrate (Stage 4b) | Done — auto with write cutover |
| CORE / FLEX KPI edits + audit history | Done |
| Hide null-entity pipeline rows (default) | Done — `PIPELINE_NULL_ENTITY_MODE` |
| Archive metadata export (4d) | Done — `/api/admin/archive-export` |

Docs: `docs/OS_PHASE19.md`

### Phase 20 scope (SS foundations + Stage 4 polish)

| Area | Status |
|------|--------|
| Soak last-run + Stage 4e checklist on Admin | Done |
| DocuSign architecture + stub hub | Done — `docs/OS_DOCUSIGN.md` |
| IT assets/licensing architecture + stub hub | Done — `docs/OS_IT_ASSETS.md` |
| Optional SQL stubs | `phase20_docusign_events.sql`, `phase20_it_assets.sql` |

Docs: `docs/OS_PHASE20.md`

### Phase 21 scope (DocuSign live + IT CRUD + Stage 4c)

| Area | Status |
|------|--------|
| DocuSign JWT + Connect + `os_docusign_events` | Done |
| IT hardware/licenses CRUD + assign history | Done |
| Stage 4c load skip + drill + archive retention tooling | Done |
| Stage 4e DROP `os_store_snapshots` | Deferred |
| SQL | Apply `phase21_shared_services.sql` |

Docs: `docs/OS_PHASE21.md` · `docs/OS_DOCUSIGN.md` · `docs/OS_IT_ASSETS.md`

### Phase 22 scope (Marketing foundation + SS hub)

| Area | Status |
|------|--------|
| Multichannel Marketing data model + stub AI/scheduler | Done |
| Marketing hub UI | Done — `/shared-services/marketing` |
| SS hub cards (live + foundation, by service) | Done |
| Archive export confirm + Stage 4e table-retained check | Done |
| Stage 4e DROP `os_store_snapshots` | Deferred |
| SQL | Apply `phase22_marketing.sql` |

Docs: `docs/OS_PHASE22.md` · `docs/OS_MARKETING.md`

### Phase 23 scope (Marketing functional + automation)

| Area | Status |
|------|--------|
| Live AI + brand voice + OAuth/stub + schedule worker | Done |
| DocuSign signed PDF/text archive to 07_Signed | Done |
| IT offboarding checklists | Done |
| Snapshot retention visibility | Done |
| Stage 4e DROP | Deferred |
| SQL | Apply `phase23_automation.sql` |

Docs: `docs/OS_PHASE23.md`

### Phase 24 scope (Marketing maturation + Storage + HR offboarding)

| Area | Status |
|------|--------|
| OAuth token refresh + Meta/YouTube platforms + analytics hub | Done |
| DocuSign signed PDFs → Supabase Storage | Done |
| IT offboarding from HR/IT tickets | Done |
| Stage 4e retention checklist (no DROP) | Done |
| SQL | Apply `phase24_maturation.sql` |

Docs: `docs/OS_PHASE24.md` · `docs/OS_MARKETING.md`

### Phase 25 scope (Engagement · CoC · status offboarding)

| Area | Status |
|------|--------|
| Live LinkedIn/Meta engagement + analytics trends | Done |
| DocuSign CoC, void, Storage backfill | Done |
| Inactive-profile offboarding + MDM webhook hook | Done |
| Stage 4e approval gate (no DROP) | Done |
| SQL | Apply `phase25_engagement_docusign.sql` |

Docs: `docs/OS_PHASE25.md`

### Phase 26 scope (X engagement · reminders · onboarding)

| Area | Status |
|------|--------|
| X engagement + richer analytics | Done |
| DocuSign reminders + template cache | Done |
| IT onboarding mirror + MDM lifecycle | Done |
| Stage 4e gates (no DROP) | Retained |
| SQL | Apply `phase26_onboarding_templates.sql` |

Docs: `docs/OS_PHASE26.md`

### Phase 27 scope (Approval SLA · impressions · template send · Graph)

| Area | Status |
|------|--------|
| Marketing approval SLA + LinkedIn Marketing impressions | Done |
| DocuSign send-from-template + scheduled reminder jobs | Done |
| IT active-profile onboarding scan + Graph Intune | Done |
| Stage 4e visibility (no DROP) | Retained |
| SQL | Apply `phase27_approval_sla_reminders.sql` |

Docs: `docs/OS_PHASE27.md`

### Phase 28 scope (YT/TT analytics · CoC email · role map · renewals)

| Area | Status |
|------|--------|
| YouTube/TikTok analytics + approval SLA digests | Done |
| DocuSign CoC email + template role-mapping UI | Done |
| Graph groups/SKUs + license renewal alerts | Done |
| Stage 4e soft-rename visibility (no DROP) | Retained |
| SQL | Apply `phase28_analytics_coc_renewals.sql` |

Docs: `docs/OS_PHASE28.md`

### Phase 29 scope (TikTok OAuth · paid stubs · void audit · warranty)

| Area | Status |
|------|--------|
| TikTok OAuth + paid campaign stubs + SLA assignee | Done |
| Live template refresh + void audit | Done |
| Graph offboard remove + hardware warranty | Done |
| Stage 4e soft-rename env gate (no DROP) | Retained |
| SQL | Apply `phase29_paid_media_warranty.sql` |

Docs: `docs/OS_PHASE29.md`

### Phase 30 scope (TikTok publish · paid ads · void policy · mailbox · warranty bulk)

| Area | Status |
|------|--------|
| TikTok publish + paid ads foundation + assignee digests | Done |
| DocuSign filters + void policy | Done |
| Graph mailbox disable + bulk warranty import | Done |
| Stage 4e soft-rename path (no DROP) | Retained |
| SQL | Notice only: `phase30_stage4e_drop.sql` |

Docs: `docs/OS_PHASE30.md`

### Phase 31 scope (video · Ads ROI · envelope management · retention automation)

| Area | Status |
|------|--------|
| TikTok video URL publish + LinkedIn Ads insights / ROI | Done |
| Live envelope management + safe void replacement | Done |
| Litigation hold / mailbox modes + warranty CSV + Intune audit | Done |
| Durable Stage 4e soft-rename governance (no DROP) | Done |
| SQL | Apply `phase31_marketing_it_governance.sql` |

Docs: `docs/OS_PHASE31.md`

### Phase 32 scope (verified publishing · durable intent · safer automation)

- TikTok publish-status polling and current-snapshot engagement analytics
- Currency-aware paid reporting with deeper LinkedIn Ads efficiency metrics
- Recipient-aware DocuSign search plus pre-void and reciprocal replacement audit
- Verified litigation-hold gating, retry-safe offboarding, richer Intune inventory,
  and auditable warranty imports
- Fail-closed snapshot drills and durable Stage 4e soak evidence; no DROP
- SQL: apply `phase32_operational_evidence.sql`

Docs: `docs/OS_PHASE32.md`

### Phase 33 scope (bound connections · atomic operations · continuous evidence)

- Entity/purpose-bound one-time OAuth state and account-bound paid sync
- Resumable TikTok binary upload with explicit privacy and durable progress
- DocuSign envelope/template pagination and idempotent multi-role replacement
- Atomic warranty preview/commit and structured Intune action verification
- Continuous Stage 4e soak epochs and retirement timeline; no app rename/DROP
- SQL: apply `phase33_marketing_connections.sql`,
  `phase33_docusign_lineage.sql`, and
  `phase33_it_warranty_intune_soak.sql`

Docs: `docs/OS_PHASE33.md`

### Phase 34 scope (typed metrics · reconciliation · approved automation)

- Provider-backed Meta/LinkedIn ad-account discovery and explicit selection
- Typed daily paid metrics with entity-safe 7/30/90-day reporting
- Observe-only DocuSign envelope/document/event/lineage reconciliation
- Explicit Intune retirement approval and leased submit/poll worker
- Structured, hashed Stage 4e drill runs and non-qualifying manual observations
- SQL: apply `phase34_marketing_analytics.sql`,
  `phase34_docusign_reconciliation.sql`, and
  `phase34_intune_drill_governance.sql`

Docs: `docs/OS_PHASE34.md`

### Phase 35 scope (backfills · transactional sends · dual control)

- Leased seven-day paid-metrics windows, rolling refresh, 90-day bootstrap, and
  coverage evidence
- Transactional DocuSign document/template send intents and exact transaction
  recovery
- Intune asset matching, expiring match-bound approval, cancel, and bounded
  fresh-child retry
- Two-actor offline rollback rehearsal manifests and external artifact hashes
- SQL: apply `phase35_marketing_paid_backfill.sql`,
  `phase35_docusign_transactional_send.sql`, and
  `phase35_intune_rollback_attestations.sql`

Docs: `docs/OS_PHASE35.md`

### Phase 36 scope (coverage truth · recovery fencing · lifecycle evidence)

- Per-account paid coverage, missing-date scheduling, connection revisions, and
  currency-grouped totals
- Replay-safe transactional DocuSign replacements, evidence-verified recovery,
  and intent-aware reconciliation
- One-at-a-time version-fenced Intune workers, durable expiry events, structured
  error classes, and worker timelines
- Versioned rollback evidence bundles with expiry, supersession, and full
  reviewer visibility
- SQL: apply `phase36_marketing_paid_reliability.sql`,
  `phase36_docusign_send_hardening.sql`,
  `phase36_intune_worker_fencing.sql`, and
  `phase36_snapshot_attestation_lifecycle.sql`

Docs: `docs/OS_PHASE36.md`

### Phase 37 scope (contracts · dispatch boundaries · SLOs)

- Versioned Meta/LinkedIn runtime contracts, durable validation evidence, and
  governed paid-sync recovery
- Two-actor DocuSign manual-review candidate binding or local closure without
  resend authorization
- Final Intune pre-dispatch authorization bound to current asset, approval,
  provider identity, lease, and row version
- Transactional snapshot drill/check/epoch/observation persistence with exact
  replay handling
- Entity-scoped Shared Services SLO evaluations, durable alert lifecycle, and
  generic worker history
- SQL: apply `phase37_marketing_paid_contracts.sql`,
  `phase37_docusign_manual_review.sql`,
  `phase37_intune_dispatch_boundary.sql`,
  `phase37_snapshot_evidence_transaction.sql`, and
  `phase37_shared_service_slos.sql`

Docs: `docs/OS_PHASE37.md`

### Phase 38 scope (reconciliation · governance · delivery)

- Authoritative Meta/LinkedIn account totals, exact campaign-allocation
  reconciliation, binding supersession, and mixed-currency-safe reporting
- Leased, frozen-window DocuSign reconciliation with immutable page evidence,
  strict pagination, sticky ambiguity, and checkpoint recovery
- Two-actor Intune ambiguity outcomes with independent Graph evidence and
  redispatch limited to a newly matched and approved child
- Versioned SLO policies, incident ownership, acknowledgement, durable delivery,
  and worker cadence visibility
- Canonical snapshot evidence cycles with durable replay conflicts and
  transactional epoch/rehearsal invalidation
- SQL: apply `phase38_marketing_paid_reconciliation.sql`,
  `phase38_docusign_reconciliation_batches.sql`,
  `phase38_intune_ambiguity_governance.sql`,
  `phase38_slo_ownership_delivery.sql`, and
  `phase38_snapshot_cycle_lifecycle.sql`

Docs: `docs/OS_PHASE38.md`

### Phase 39 scope (attribution · recovery · governed operations)

- Append-only paid-attribution revenue revisions with exact micro-unit
  arithmetic and settlement-lag visibility
- Dedicated two-actor DocuSign mapping review and content-bound signed-archive
  manifests with drift detection
- Entity/provider/operation-scoped Intune circuit breaker with governed,
  token-fenced half-open canaries
- Draft/validate/maker-checker SLO policy editing, named owners, and isolated
  delivery-route tests
- Immutable snapshot evidence export manifests and bounded replay/concurrency
  canaries that cannot qualify retirement evidence
- SQL: apply `phase39_marketing_attribution_settlement.sql`,
  `phase39_docusign_mapping_archive.sql`,
  `phase39_intune_provider_circuit_breaker.sql`,
  `phase39_slo_policy_editing_route_tests.sql`, and
  `phase39_snapshot_retirement.sql`

Docs: `docs/OS_PHASE39.md`

### Phase 40 scope (authoritative integrity · long-running governance)

- Authoritative revenue connectors with leased ingestion, governed
  corrections, and aligned attribution-model comparison
- Legacy signed-archive backfill and scheduled integrity scans with
  drift quarantine
- Intune breaker tuning history, aggregate outage episodes, and read-only
  health canaries
- SLO draft comparison, historical counterfactual simulation, and owner
  coverage expiry alerts
- Signed snapshot export packages, external retention checks, and multi-hour
  non-qualifying canary orchestration
- SQL: apply `phase40_marketing_authoritative_revenue.sql`,
  `phase40_docusign_archive_governance.sql`,
  `phase40_intune_resilience_observability.sql`,
  `phase40_slo_governance.sql`, and
  `phase40_snapshot_retirement.sql`

Docs: `docs/OS_PHASE40.md`

### Phase 41

Production ledgers and authenticity modes, DocuSign archive campaigns, Intune
postmortems with bounded threshold drafts, SLO simulation exports and coverage
calendars, and externally verifiable cold snapshot receipts.

Apply after Phase 40:

1. `phase41_marketing_production_ledgers.sql`
2. `phase41_docusign_archive_campaigns.sql`
3. `phase41_intune_outage_postmortems.sql`
4. `phase41_slo_exports_coverage.sql`
5. `phase41_snapshot_external_receipts.sql`

Docs: `docs/OS_PHASE41.md`

### Phase 42

Production ops on Phase 41 rails: revenue authenticity/settlement SLOs, DocuSign
campaign ops and quarantine aging, Intune recommendation soak, SLO export
retention/succession, and public snapshot verify material with cold HEAD cadence.

Apply after Phase 41:

1. `phase42_marketing_production_slos.sql`
2. `phase42_docusign_campaign_ops.sql`
3. `phase42_intune_recommendation_soak.sql`
4. `phase42_slo_export_retention_succession.sql`
5. `phase42_snapshot_verify_cold_ops.sql`

Docs: `docs/OS_PHASE42.md`

### Phase 43

Ops loop closure: marketing critical SLO alerts and credential binding health,
gated first DocuSign quarterly, Intune soak open→closed cycles, SLO export
archival and succession drills, firm-wide snapshot verify and production cold
HEAD.

Apply after Phase 42:

1. `phase43_marketing_slo_ops_alerts.sql`
2. `phase43_docusign_first_quarterly_ops.sql`
3. `phase43_intune_soak_cycle_evidence.sql`
4. `phase43_slo_export_archival_succession_drills.sql`
5. `phase43_snapshot_verify_cold_production.sql`

Docs: `docs/OS_PHASE43.md`

### Phase 44

Ops maturity and evidence depth: revenue correction validation and attribution
conflicts, DocuSign drift/backfill health with integrity alerts, Intune
breaker performance trends and resilience correlation, SLO scenario library
with handoff suggestions and revision ledger, snapshot package integrity plus
retention/canary monitoring.

Apply after Phase 43:

1. `phase44_marketing_revenue_ops.sql`
2. `phase44_docusign_archive_ops.sql`
3. `phase44_intune_resilience_ops.sql`
4. `phase44_slo_governance_ops.sql`
5. `phase44_snapshot_retention_ops.sql`

Docs: `docs/OS_PHASE44.md`

### Phase 45

Automation maturity and gate discipline: tuned auto-reject rules and webhook
delivery SLOs, DocuSign gate-clearing with drift budgets, Intune postmortem
quality gates before tuning promote, nightly SLO scenario replay and quarterly
handoff digests, dual-key ed25519 snapshot rotation with consecutive-failure
paging. Stage 4e non-qualifying flags remain false; no snapshot relation
mutations.

Apply after Phase 44:

1. `phase45_marketing_revenue_ops.sql`
2. `phase45_docusign_archive_ops.sql`
3. `phase45_intune_resilience_ops.sql`
4. `phase45_slo_governance_ops.sql`
5. `phase45_snapshot_key_rotation_ops.sql`

Docs: `docs/OS_PHASE45.md`

Optional env: `SNAPSHOT_CONSECUTIVE_FAILURE_THRESHOLD` (default 3); reuse
`SLO_WEBHOOK_OPS_ALERTS` + `SLO_WEBHOOK_ALLOWED_HOSTS` for paging.

### Phase 46

Controlled promotion and production cadence: auto-reject promotion gated on
healthy webhook delivery SLOs, first DocuSign quarterly completion with
recurring arms and tightened drift budgets, dual-approver Intune promote
waives with deeper postmortem scorecards, firm-wide nightly SLO scenario
replay with published handoff digests, and dual-acceptance ed25519 cutovers
with on-call page routing. Stage 4e non-qualifying flags remain false; no
snapshot relation mutations.

Apply after Phase 45:

1. `phase46_marketing_revenue_ops.sql`
2. `phase46_docusign_archive_ops.sql`
3. `phase46_intune_resilience_ops.sql`
4. `phase46_slo_governance_ops.sql`
5. `phase46_snapshot_cutover_ops.sql`

Docs: `docs/OS_PHASE46.md`

Optional env: `SNAPSHOT_ONCALL_WEBHOOK` (allowlisted via
`SLO_WEBHOOK_ALLOWED_HOSTS`); falls back to `SLO_WEBHOOK_OPS_ALERTS`.

### Phase 47

Cohort promotion, recurring cadence, and ack SLOs: multi-entity auto-reject
promotion cohorts with attribution conflict closures, first armed DocuSign
recurring quarterly under tightened drift budgets, dual-approver Intune waive
expiry with scorecard↔MTTR correlation, owner notify on published handoff
digests, and offline-script-required snapshot cutovers with on-call
acknowledgment SLOs. Stage 4e non-qualifying flags remain false; no snapshot
relation mutations.

Apply after Phase 46:

1. `phase47_marketing_revenue_ops.sql`
2. `phase47_docusign_archive_ops.sql`
3. `phase47_intune_resilience_ops.sql`
4. `phase47_slo_governance_ops.sql`
5. `phase47_snapshot_cutover_ops.sql`

Docs: `docs/OS_PHASE47.md`

Optional env: `SNAPSHOT_ONCALL_ACK_SLO_MINUTES` (default 60).

### Phase 48+ backlog

- Autopilot healthy cohort promotions; archive closed conflict cohorts
- Schedule subsequent DocuSign recurring quarterlies; tighten on drift breaches
- Feed MTTR↔scorecard into postmortem templates; page on waive_expired
- Allowlisted owner digest webhooks + notification delivery SLOs (not full push)
- CI offline_script dual acceptance; on-call ack SLO dashboards
- Continue Stage 4e soak; do not drop snapshots
- Push · user admin

## Run locally

```bash
cd tagevc-os
cp .env.example .env.local
# fill NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

Open http://localhost:3000 → redirects to Command Center (after auth).

### Microsoft auth setup

1. Supabase Dashboard → Authentication → Providers → **Azure** (Microsoft)
2. Create an Entra app registration; add redirect URI from Supabase
3. Add site callback: `http://localhost:3000/auth/callback`
4. Apply SQL: `supabase/phase0_identity.sql`
5. Promote your user: `update profiles set role = 'visionary' where email = '…';`

### Dev without Supabase

Set `DEV_BYPASS_AUTH=1` in `.env.local` to preview the shell as Visionary (local only).

## Spec map

- Roles / modules → Portal Architecture, Platform Spec
- Enums / entities → Data Dictionary, Entity Master
- Home KPIs → Command Center
- Brand → Brand & Styling Guide (`#3A414F`, `#9F957C`, `#ECE9E6`, …)

## Next phases (from Cursor Brief)

Phase 40 adds authoritative revenue ingestion, archive integrity scans, Intune
outage observability, SLO simulation/owner expiry, and signed multi-hour
snapshot packages. Remaining: continued Stage 4e soak and separately approved
offline retirement, production connector rollout, push, and user admin.
