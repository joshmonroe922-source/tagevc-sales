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

### Phase 15+ backlog

- Write cutover (stop snapshot persists for healthy domains)
- Normalize handoffs + audit trails
- Push notifications; richer moderation
- Real DocuSign + observability


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

Phase 14 adds Portfolio/Entity Master live tables and snapshot soak tooling. Remaining: write cutover, handoff/audit normalize, DocuSign, push, observability.
