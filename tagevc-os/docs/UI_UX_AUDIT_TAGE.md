# Tage OS — UI/UX + performance audit

**Date:** 2026-07-25  
**Target:** https://app.tagevc.com (Tage OS only)  
**Scope:** Shell, navigation, Shared Services, heavy surfaces — polish + measured speed. No RBAC / Live Look / domain rebuilds.

---

## Executive summary

Tage OS already has a solid operator skeleton (SSC hub, function homes, checklist engine, accordion nav, EmptyState in several places). Friction clusters around:

1. **Shared Services blank time** — checklist/hub do sequential ensure/escalate work before paint; no route-level `loading.tsx` under `/shared-services`.
2. **Inconsistent page chrome** — headers/empty/error patterns vary by surface; no shared PageHeader / ErrorState / Skeleton primitives beyond a basic EmptyState and one app-wide loading pulse.
3. **Checklist density** — long task lists render fully; filter bar not sticky; “Today / Overdue / My work” not one-click from function home.
4. **Perceived speed** — scope/period changes full-navigate with blank main; Suspense fallbacks often `null`.

**P0 this pass:** SSC + shell consistency/performance. P1 later: deeper windowing, SWR, HRIS table virtualization.

---

## Audit matrix

| Surface | Issue | User impact | Severity | Fix type | Est. |
|---------|-------|-------------|----------|----------|------|
| `/shared-services` hub | Sequential `ensurePeriodInstances` → `seedAllCompanyAudits` → `escalateOverdueSscTasks` before data `Promise.all` | Long blank on hub entry | **P0** | Structural (parallelize) | S |
| `/shared-services/checklists` | `getSscOperatorBundle`: overdue → escalate → evidence → fetch → audits → sync sequential | Slow TTFMP on every period view | **P0** | Structural (parallelize independent legs) | M |
| SSC routes | No `loading.tsx` under shared-services | Blank flash on navigation | **P0** | Quick | S |
| Function homes | Strip links only “Period checklist / Audits / Hub” — no Today/Overdue | Extra clicks for daily work | **P0** | Quick | S |
| Checklist client | Filter card scrolls away; all tasks in DOM | Operator scroll loss; jank on large periods | **P0** | Quick (sticky + window) | M |
| Checklist empty | Plain text / no CTA when filtered empty | Dead end | **P0** | Quick | S |
| Shell | App layout Suspense `fallback={null}`; only coarse `/loading.tsx` | Layout shift / empty main | **P0** | Quick | S |
| Design system | No PageHeader / ErrorState / Skeleton; EmptyState exists but uneven adoption | Visual noise, inconsistent recovery | **P0** | Quick | S |
| Accordion nav | Works; chevron ignores `prefers-reduced-motion` | Minor a11y | **P1** | Quick | S |
| CompanySelect on checklist | Default value `ENT-FIRM` in code path | Risk of raw ID leak if select mis-renders | **P1** | Quick (verify labels) | S |
| Portfolio / Net Worth / Credit | Accordion nesting OK; Credit has no dedicated loading | Mild blank on deep nav | **P1** | Quick | S |
| HRIS directory | Client list; EmptyState present; no pagination callout | Slow with large rosters | **P1** | Structural | M |
| Finance home | Parallel fetches already; no loading route | Blank on entry | **P0** | Quick (shared loading) | S |
| Manager HR | Calm page exists; needs consistent header + empty | Clarity | **P1** | Quick | S |
| Notifications / tickets | Top bar visible; competes little with SSC CTAs | OK | — | Monitor | — |
| Messages | EmptyState used | OK | — | — | — |
| Admin | Separate loading for normalization only | Uneven | **P2** | Quick | S |
| Nested scroll | Sidebar + main both scroll; OK pattern | Low | — | — | — |
| Focus / dialogs | Sheet exists; not audited end-to-end | Risk | **P1** | Polish | M |
| Status chips | Risk colors + Badge variants differ by module | Cognitive load | **P1** | Consistency | M |
| ENT-* in UI | Mostly display names; checklist CompanySelect uses names | Guardrail | Ongoing | Review | — |

---

## Role journeys — friction notes

| Role | First action after login | Friction |
|------|--------------------------|----------|
| **SSC operator** | Home briefing → Shared Services (or deep link) | Hub seed/escalate delay; checklist filters not sticky; no Today shortcut from Finance/HR home |
| **COO / leadership** | Home / Command | Overview OK; deep SSC detail same blank cost |
| **Manager (HR)** | `/shared-services/hr/manager` | Path clear from HR home; header density not aligned with SSC strip |
| **Visionary** | Home + Live Look | Accordion Portfolio → Net Worth → Credit nesting OK; Live Look rules unchanged |
| **Standard user** | Home | Fewer SSC tools; empty states must not expose ENT-* |

---

## Priority list (implement order)

1. **P0 — Shared primitives:** `PageHeader`, `ErrorState`, `Skeleton` (+ light EmptyState CTA consistency)
2. **P0 — Route loading:** `shared-services/loading.tsx` (and reuse pattern)
3. **P0 — Bundle/hub parallelization** in checklist engine + hub page
4. **P0 — Function home strip:** Today / Overdue / Checklist quick links
5. **P0 — Checklist UX:** sticky filter bar, task windowing, empty CTA, overdue shortcut
6. **P1 —** reduced-motion on nav chevron; Portfolio loading already exists; HRIS pagination later

---

## Before / after (key routes)

| Route | Before (observed in code) | After (this pass target) |
|-------|---------------------------|--------------------------|
| SSC hub | 3 sequential ensure/seed/escalate then 5-way parallel fetch | Ensure ops parallelized; loading skeleton on navigate |
| SSC checklist current | Sequential maintenance + sequential audits/sync before trends | Maintenance parallelized; audits/sync/trends/packages/ai in one `Promise.all`; sticky filters + windowed tasks |
| SSC HR home | Parallel data already; no loading.tsx | Shared SSC loading skeleton; richer function strip (Today/Overdue) |
| Firm / app shell | Coarse pulse loading only at `(app)` | Unchanged shell RBAC; better child route skeletons |

Dev timing: optional `console` marks behind `TAGE_UI_PERF=1` on bundle generation (documented below).

---

## Guardrails confirmed

- No permission / Live Look / personal-credit changes
- No SSC UI in subsidiary portals
- Company display names remain the UI contract
- Additive components; domain features untouched

## Click-test script

1. Login as SSC operator → Shared Services hub (should show skeleton briefly, not blank forever).
2. Open Finance (or HR) function home → click **Today (current period)** → checklist loads with sticky filters.
3. Toggle **Overdue** → filtered list; empty state offers **Reset to today** if none.
4. Change scope Parent ↔ single company → loading skeleton; no jarring empty main.
5. Complete one task (Done) → refresh still smooth.
6. Visionary → Portfolio accordion → Net Worth → Credit (nesting clear).
7. Manager → `/shared-services/hr/manager` → reports only, clear complete path.
8. Narrow viewport → sidebar accordion Expand/Collapse with keyboard still works; chevron respects reduced motion.

## Perf notes

- Set `TAGE_UI_PERF=1` to log `[TAGE_UI_PERF] ssc-bundle …` on checklist bundle generation.
- Hub: `ensurePeriodInstances` ‖ `seedAllCompanyAudits`, then escalate.
- Bundle: overdue ‖ evidence drafts; then audits ‖ sync ‖ trends ‖ packages ‖ AI.
- **List vs detail HTML:** list queries must not `SELECT description_html` / large HTML bodies (`src/lib/content/list-vs-detail.ts`). Sanitize rich HTML **on write** (`sanitizeRichContentOnWrite`); detail routes only render HTML. See also entity select order (`docs/OS_ENTITY_SELECT_ORDER.md`) and Shared Services accordion children (`docs/OS_NAV_ACCORDION.md`).
- **SSC function homes:** chrome loads via Suspense; entity change updates list region with skeleton (not full-app blank). Entity options cached (`entity-select-cache`).
