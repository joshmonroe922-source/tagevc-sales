# HR onboarding — manual vs automated (Tage OS)

Route: **Shared Services → Human Resources → Onboarding** (`/shared-services/hr/onboarding`).

Employee file: `/shared-services/hr/employees/:id` (checklist on the onboarding run).

## How to tell manual vs automated today

Each checklist step carries:

| Field | Meaning |
| --- | --- |
| `automation` | `manual` · `assist` · `auto` (seeded on `os_hris_process_template_steps`, copied to `os_hris_process_steps` on run start) |
| `system_hook` | When set, marking a step **done** may invoke `dispatchHrisStepAssist()` (Graph joiner, DocuSign, IT child run, Gusto, etc.) |
| `owner_role` | Who is expected to act (Human Resources, IT, Hiring Manager, Finance) |
| `destructive` | Requires explicit confirm before done/waived |

The employee detail UI shows an **Manual / Assist / Auto** badge per step (tooltip explains behavior).

**Assist is not fully autonomous:** a human (or manager, for manager-owned steps) still marks the step done; assists run on that transition.

**Auto** is reserved for steps the system should complete without a desk click (`bs.hris_enter` is seeded `auto` — the hire record itself).

## Flow triggers

1. **Create employee** (`createHrisEmployeeAction`) with `auto_start_onboarding: true` → `startProcessRun({ kind: 'onboarding' })`.
2. Template slug: entity-specific (`signent-onboarding-v1`, `inda-onboarding-v1`, …) else fallback **`r619-onboarding-v1`** (~44 steps).
3. **IT mirror:** fail-soft link to IT onboarding run (`linkItChildRun`, `auto_execute: false`).
4. **Cadence:** `GET/POST /api/hris/cadence-worker` (cron secret) retimes due dates and **escalates overdue** steps to **P1 HR tickets** (`escalateOverdueHrisSteps` → Help Desk / Alerts).

## Manual step pings (current + recommended)

| Channel | Today | Fit |
| --- | --- | --- |
| **Help Desk tickets** | Overdue steps → `[HRIS overdue]` P1 ticket + `escalated_ticket_id` on step | Already in stack; shows in Alerts |
| **Platform email (Graph / Resend)** | Joiner invite to personal email after Graph provision | Use for owner-role “step due today” digests |
| **In-app Alerts bell** | Ticket-driven | Primary operator surface |
| **Slack** | Not wired for HRIS steps | Optional webhook on escalate only |
| **Cursor automation** | N/A for hires | Use for internal eng tasks, not employee onboarding |

Recommended next ping: **due-today digest** to step `owner_role` (email) + ticket if still open after due date (cadence already handles overdue).

## Code map

- Templates / seeds: `supabase/phase68_hris_foundation.sql`, `phase72_hris_deepen.sql`, `phase96_gusto_multi_entity.sql`
- Run lifecycle: `src/lib/hris/runs.ts`
- Assists: `src/lib/hris/step-assists.ts`
- Escalation: `src/lib/hris/escalate.ts`
- Cadence: `src/lib/hris/cadence-runner.ts`, `src/app/api/hris/cadence-worker/route.ts`
