# Database Refresh C0–C12 — Honest Audit (code-side)

**Date:** 2026-08-03  
**Branch:** `feat/email-campaign-center`  
**Spine lander:** `96ceaca` — “Ship Database Refresh graph spine to LIVE-ready completion” (+ follow-ups `44d03a1`, `69e9cb7`, `24dd524`, `221bce8` ECC)  
**Workspace:** `/Users/joshmonroe/Projects/tagevc-sales/tagevc-os`  
**SSOT:** `~/Downloads/Database Refresh.xlsx` · sheet `12_Repo_Cursor_Pack`

**Method:** Spreadsheet “Done when” vs actual code. Prior `GROK_SPINE_AUDIT.md` was optimistic.  
**Excluded from “incomplete”:** Josh-only items (API keys, `*_LIVE` flags, hosting the worker process, Dashboard Auth Hook toggle, optional Realtime table enable if already documented).

---

## Headline

UI spine looks finished; live enrichment pipeline is about halfway. Company Apollo works when keys are on — **people expand still uses fake employees**, PDL is not coded, merge is not used by the worker, and Copilot cannot enqueue refresh. Prior “LIVE-ready completion” overstates C5–C6 and C10–C12.

**Biggest code lie:** Apollo people search exists but bootstrap never calls it — expand is always mock.

| Metric | Count |
|--------|------:|
| Phases **Done** | 6 |
| Phases **Partial** | 7 |
| Whole phases not started | 0 |
| Acceptance tests passed | 21 (unit/static — not LIVE e2e) |

**Scorecard**

- **Done:** C0, C1, C3, C4, C7, C8
- **Partial:** C2, C5, C6, C9, C10, C11, C12
- Inside Partial, C5 people-import and C6 PDL are effectively “not started.”

---

## Plain language (non-coder)

Think of Database Refresh as: one shared company/people Rolodex for Tage + Recruit 619 + Signent + Instant NDA, with background “research assistants” that fill in emails and org charts.

### What you can already use (without Josh’s API keys)

- Create companies and people in CRM; browse by subsidiary (org switcher).
- A background worker can run a **demo** enrich that invents sample employees so UI/job progress works.
- Org chart: draw, accept, reject, drag-fix; user edits lock on the edit path so agents shouldn’t silently overwrite.
- Search (Cmd-K), suggestions inbox, freshness colors, Admin → Enrichment (provider readiness + budgets display).
- Nightly “stale data” cron and a simple data-quality report are coded.

### What is NOT really done yet (even after keys land)

- Turning on Apollo will enrich the **company** card, but **will not yet pull real employee lists** — expand still generates fake people. That is an **engineering miss**, not a key miss.
- People Data Labs is listed on the health screen but not coded to call the API.
- The “smart merge” brain that respects locks is tested in isolation but not used by the worker when writing contacts.
- Copilot cannot yet “go refresh this account” from chat — debug buttons only.
- Recruit / Signent / Instant NDA product apps are not fully on this shared Rolodex yet (scaffolds inside Tage OS only).
- Admin cannot change budgets/kill switch from the UI; observability is basic.

---

## Phase table (code-side only)

| Phase | Status | Spreadsheet “Done when” | What’s actually shipped | What’s still engineering (not Josh keys) |
|-------|--------|-------------------------|-------------------------|------------------------------------------|
| **C0** | **Done** | Scaffold boots | Adapted layout: `src/lib/spine/*`, `apps/worker`, migrations, `.env.example` (not greenfield Turborepo — intentional) | None material |
| **C1** | **Done** | SQL + RLS + seed | `0001–0010`, `phase94_graph_spine.sql`, apply script, seed orgs | Live DB RLS integration tests still thin (suite is mostly static SQL proof) |
| **C2** | **Partial** | Correct org data only | Org switcher UX; claims builder; phase95 hook SQL/docs | Graph CRUD still **service-role** (bypasses RLS). Cutover to user-scoped JWT-RLS path after hook is engineering. |
| **C3** | **Done** | Manual create w/o enrich | `/shared-services/crm`, create account/contact, spine APIs | Polish: cross-org “exists in network” UX (T18) is silent link, not a message |
| **C4** | **Done** | Realtime progress demo | Worker drain loop; mock bootstrap; job toaster (poll + Realtime subscribe) | Worker hosting = Josh. Realtime Dashboard toggle = Josh (poll fallback already coded) |
| **C5** | **Partial** | Live company → employees | Apollo **company** enrich when LIVE; ZeroBounce verify fn; merge engine **unit-only** | **Wire `apolloSearchPeople` into bootstrap** (today always `mockExpandPeople`). Cap hard-clamped to 10. **Call merge engine on writes**. `contact.bootstrap` / `contact.enrich` job handlers missing |
| **C6** | **Partial** | Waterfall + budget block | Hunter find + ZB + `credit_ledger` + budget gate + Admin health | **No PDL adapter** (health/cost only). Person waterfall not PDL→Apollo→Hunter. Budget block not proven end-to-end on live expand |
| **C7** | **Done** | Confirmed edges stick | React Flow chart; accept/reject/drag; rules hierarchy; never overwrite confirmed/rejected | Optional: LLM hierarchy pass; auto-run after expand (manual button today) |
| **C8** | **Done** | Agent can’t overwrite user email | Suggestions inbox + bell; provenance panel; user PATCH locks; accept/dismiss | Runtime risk until C5 wires merge into worker (bootstrap bypasses merge) |
| **C9** | **Partial** | Cmd-K + site research + E2E | Cmd-K FTS search; freshness badges; site research = public `<title>` → suggestion | Real site people extract. True E2E happy path. Worker `site_research` is bookkeeping only |
| **C10** | **Partial** | Copilot enqueue refresh | Template account brief; daily stale-refresh cron; data_qa agent | Copilot is a **tool probe** — **no chat, no `jobs.enqueue`**. Brief is markdown template, not LLM |
| **C11** | **Partial** | Products use shared graph | Recruit/NDA/Signent **tables + account UI create/list**; HM user-owned guard in schema/tests | Sibling portals not on graph. NDA party-resolve scaffold only. Product deep links incomplete |
| **C12** | **Partial** | Prod checklist green | Admin → Enrichment: provider READY/LIVE display, month spend, org budget **display**, kill-switch **read** | No budget/flag **write UI**; kill switch env-only; no observability dashboards; no load-test caps |

Acceptance suite: `src/lib/spine/acceptance/t01-t18.test.ts` — **21 tests passed** (unit/static). Not LIVE e2e (DB + providers).

---

## Remaining engineering work (not Josh credentials)

### Priority A — must fix before calling C5/C6 “Done”

1. Wire `apolloSearchPeople` into `runAccountBootstrap` when Apollo is ready; stop always using `mockExpandPeople`.
2. Honor org `auto_expand_cap` (remove/raise the hard `Math.min(..., 10)` clamp once safe).
3. Implement PDL person enrich adapter and run waterfall PDL → Apollo match → Hunter → ZeroBounce as specified.
4. Run contact writes through `decideMergeField` / merge engine (provenance, locks, invalid-email skip, suggestions). Bootstrap currently raw-inserts.
5. Implement real `contact.bootstrap` / `contact.enrich` (and enqueue on `createContact`), not worker noops.

### Priority B — C10 / UX exit criteria

6. Copilot: add tool `jobs.enqueue` (refresh/bootstrap) + minimal chat UI; meet “Copilot enqueue refresh.”
7. Optional but spec’d: LLM account brief (OPENAI) instead of template-only.
8. Site research: extract people from public `/team`|`/about` pages into suggestions (today only page title → description suggestion).
9. T18 UX: when domain/email already exists in another subsidiary, show “exists in network” (not silent link-only).

### Priority C — tenancy / prod hardening

10. After Auth Hook is on: cut graph CRUD from service-role to user-scoped clients so RLS actually protects reads/writes (C2 completion).
11. C12: Admin write path for org budgets / feature flags; in-app kill switch (or clear ops runbook + status); basic job/credit observability (even without full OTel).
12. Stronger acceptance: a few integration tests against local/staging Supabase (RLS T01/T02 for real; bootstrap enqueue T03) — unit/static alone is not the spreadsheet bar.

### Priority D — C11 product graph (scoped)

13. Keep Instant NDA App Store untouched (decision). Wire Recruit/Signent portal FKs or deep-links to spine accounts/contacts when those repos are in scope; finish HM lock end-to-end in product UI.

---

## Josh ops (not eng debt)

- Provider API keys + `*_LIVE=1`
- Hosting/running `apps/worker`
- Supabase Dashboard: Auth Hook enable; optional Realtime on `enrichment_jobs`
- Signing vendor DPAs / spend approval

---

## Email Campaign Center — PR status (short)

| Item | Detail |
|------|--------|
| PR | [#1 — Ship Email Campaign Center (HubSpot-class, owned spine)](https://github.com/joshmonroe922-source/tagevc-sales/pull/1) — **OPEN** |
| Branch | `feat/email-campaign-center` (tip `221bce8`; 5 commits ahead of `main`) |
| UI | Shared Services → Marketing → Email Campaign Center |

**Build-plan snapshot** (`docs/campaign/build-plan.md`):

| ECC phase | Status |
|-----------|--------|
| 0 Foundation | Done |
| 1 Compliance | Done |
| 2 Templates + merge | Done |
| 3 Audiences | Done |
| 4 Owned send path | Done (controlled_graph day-1; Postal adapter ready) |
| 5 ECC UI + CRM + team | Done |
| 5b DocuSign hooks | Partial (port + envelope_actions tables) |
| 5c Multichannel VM+email | Done |
| 6 Journeys visual builder | Partial (graph_json + starter sequence nodes) |
| 7 Intelligence | Stub (no AI auto-send) |

CRM contact page deliberately decoupled from unfinished campaign panel (`24dd524`).

---

*Canvas review copy also at:*  
`~/.cursor/projects/Users-joshmonroe-Projects-InstaNDA/canvases/database-refresh-phase-audit.canvas.tsx`
