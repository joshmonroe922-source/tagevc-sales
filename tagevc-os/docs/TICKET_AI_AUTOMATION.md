# Ticket AI automation — AUTO / DRAFT / ESCALATE

Tage Shared Services tickets already diagnose on create. Phase 76 deepens the loop.

## Bands
| Band | Meaning | Who acts |
|------|---------|----------|
| **AUTO** | Allow-listed, ≥90% confidence, no forbid hits, not P0 | Agent executor (narrow) |
| **DRAFT** | Concrete proposal; human Approve / Reject before side effects | Service Lead+ |
| **ESCALATE** | Forbid-list, P0, money/legal/HR/credit/secrets, or low confidence | Human queue + AI brief |

## Never AUTO (forbid-list)
Money wires, DocuSign capital send, role/permission changes, HR termination, credit-file writes, production secrets, data deletion, IC approve, silent-close P0, portfolio health change, external founder/investor email without approve.

## Allow-list (start narrow)
`spawn_missing_stage_tasks`, `tag_ticket_service`, `sla_nudge`, `route_inbound_form`, `draft_status_summary`, `retry_failed_parse`, `retry_noncritical_webhook`, `clear_stale_cache_flag`, `document_known_fix`.

### How to add a new AUTO item safely
1. Add code to `ALLOW_ACTIONS` in `src/lib/types/enums.ts`.
2. Add signals + label in `src/lib/shared-services/allow-list.ts`.
3. Implement a **reversible / logged** branch in `auto-executors.ts`.
4. Add a unit test that AUTO succeeds for that signal and that a forbid signal never AUTO-executes.
5. Ship behind audit — never skip `assertCanAutoExecute`.

## Grok enrichment
- `diagnoseTicketEnriched` (optional via `TICKET_GROK_DIAGNOSE_ENABLED`, needs `XAI_API_KEY`).
- Rule engine always runs first. Grok may demote toward safer bands and enrich summary / proposed_actions.
- Grok **cannot** promote forbid/P0 into AUTO.

## UI
Ticket detail: band badge, confidence, AI summary, proposed actions, AUTO result, Re-diagnose, Approve proposed action / Reject.

## Metrics (`os_automation_metrics`)
- `tickets_auto_attempted`
- `draft_approvals`
- `time_to_first_ai_diagnosis_ms`

## SQL
`supabase/phase76_ticket_ai_diagnose.sql`
