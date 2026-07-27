# AI C-Suite (Visionary executive intelligence)

Firm-level AI executives on top of Shared Services. **Not** Think Tank / Home AI.

| Role | Function | Reports to Visionary on |
|------|----------|-------------------------|
| AI CFO | Finance | Cash, close, anomalies, runway, sub financial health, IES |
| AI CTO | IT | Security, access, uptime, assets/licenses, incidents, integrations |
| AI CMO | Marketing | Pipeline quality, campaigns, channel ROI, brand/content ops |
| AI CHRO | HR | Headcount, JML, onboarding risk, retention, HR compliance |
| AI CLO | Legal | Matters, contracts, deadlines, DocuSign risk, compliance |

## Architecture

- **Nav:** Accordion **C-Suite** between Home and Dashboard — HQ, CFO, CTO, CMO, CHRO, CLO. Visionary-only; `hideDuringLiveLook`.
- **Config:** `src/lib/ai-csuite/roles.ts`
- **SQL:** `supabase/phase79_ai_csuite.sql` — `os_csuite_briefings`, `os_csuite_threads`, `os_csuite_messages`, `os_csuite_actions`, `os_csuite_reports` + `csuite-private` storage bucket
- **RLS:** Visionary only via `is_visionary_role()`; deny all other roles in v1
- **LLM:** Server-side Grok/xAI via `grokChatCompletion` (`XAI_API_KEY` / `GROK_API_KEY`) — never in browser
- **Context builders:** `src/lib/ai-csuite/context.ts` — fail-soft packs; company display names; `data_gaps` when feeds missing; **never invent KPIs**
- **Auto briefings:** `src/lib/ai-csuite/briefing.ts` — on load of `/c-suite` and `/c-suite/[role]`, build context → Grok structured JSON → **AI Analysis** card (health, what matters, top risk, primary action, summary). Persist to `os_csuite_briefings` (`period_type=on_demand`) when table exists; **fail-soft** if SQL missing (still show card + soft apply hint). Cache/reuse within ~20 minutes; **Refresh analysis** forces regenerate.
- **CFO Financial Report:** CFO page adds a markdown **Financial Report** section (cash/runway/close, subsidiary health, anomalies, overdue SSC finance work, draft-only next actions) from live IES / control-plane / SSC signals when present — gaps marked, no fabricated numbers.
- **HQ rollup:** HQ auto-briefing synthesizes the five function context packs into one Visionary firm briefing.
- **Actions:** Draft-only status machine `proposed → approved|rejected → executed` — no money movement, legal send/void, or secret changes

## Human gates

- Money movement, DocuSign send/void, production secrets remain human dual-control outside C-Suite
- “Executed” on a C-Suite action means Visionary confirmed a **draft**, not that OS auto-ran a forbidden op

## Residuals

1. **Weekly email digest** — scaffold only; wire firm email provider; store under `csuite-private/{visionary_id}/weekly/{role}/{week}.md.pdf`
2. **Context pack quality** — deepen non-CFO feeds (Intune, HRIS headcount, DocuSign risk, paid marketing ROI) without inventing numbers; CFO IES deepening continues as OAuth/sync coverage expands
3. **Apply SQL:** run `supabase/phase79_ai_csuite.sql` if not already applied (`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tagevc-os/supabase/phase79_ai_csuite.sql`) so briefings/threads/actions persist

## SSC boundary

C-Suite UI is Tage OS only — not Recruit 619 / Instant NDA portals.
