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
- Persist stores to Supabase (phase SQL stubs)
- Live website webhook → intake (edge function cutover)


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

P1: VC pipeline + live Command Center counts · P2: Close + docs · M&A/RE · Portfolio · Shared Services
