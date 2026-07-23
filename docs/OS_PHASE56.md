# Phase 56 — Legal / DocuSign Production Hardening

Phase 56 hardens the existing DocuSign hub at
`/shared-services/legal/docusign`. Template governance completeness, capital
send dual-control (never silent-send), archive integrity alerts, quarterly
process monitoring, and subsidiary legal request visibility (`ENT-R619` /
`ENT-INDA`) ship as append-only evidence. Monitoring logic never creates,
voids, or resends envelopes.

## Surface

- DocuSign hub → `/shared-services/legal/docusign` (extended; Phase 56 panel)
- Template governance completeness KPIs
- Capital send propose + dual-approve gate (operator sends after gate)
- Archive integrity alerts / quarantine probe
- Quarterly process monitoring checklist
- Subsidiary legal visibility (`ENT-R619` first; `ENT-INDA` when evidence exists)

## Data

Apply `tagevc-os/supabase/phase56_legal_docusign_hardening.sql` after Phase 55.

- `os_docusign_template_gov_phase56_snapshots` — governance completeness
- `os_docusign_capital_send_phase56_proposals` / `_approvals` — dual-approve
  capital send gates (`envelope_send_executed` always false)
- `os_docusign_archive_integrity_phase56_alerts` — integrity monitoring
- `os_docusign_quarterly_process_phase56_events` — quarterly steps
- `os_docusign_subsidiary_legal_phase56_events` — R619 / INDA visibility
- `os_docusign_phase56_ops_alerts` — ops visibility alerts
- `refresh_legal_docusign_hardening_phase56` — probes template cache /
  quarantine fail-soft; never mutates envelopes
- `get_legal_docusign_hardening_phase56_report` — entity-scoped report
- `propose_capital_send_phase56` / `approve_capital_send_phase56` — human gates
- `record_quarterly_process_phase56` — append-only quarterly steps

Safe metadata denylist via `phase56_legal_safe_detail`.
`os_sha256_hex` uses `search_path = public, extensions`.
Contract: `phase56-v1`.

## App

- `src/lib/docusign/legal-hardening-phase56.ts` — contracts + stubs
- `src/lib/docusign/legal-hardening-phase56-server.ts` — RPC helpers
- `src/components/shared-services/legal-hardening-phase56-client.tsx` — UI
- DocuSign page + actions extended for Phase 56 refresh / capital propose /
  dual-approve / quarterly steps
- Hub DocuSign card description updated

## Verify

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 57 note

**Phase 57 = HR + IT hardening** (onboarding/offboarding run completeness,
Intune/asset soak). Do not start Phase 57 from this phase’s Legal workstream
without an explicit go-ahead.

## Phase 57+ recommendations

1. Wire live subsidiary legal request feeds so R619/INDA move from `missing`
   → `ok`/`partial`.
2. Continue archive quarterly cadence soak (Phases 44–52 rails remain).
3. Continue Stage 4e soak; do not drop snapshot retirement tables.
4. Still out of scope here: autonomous create/void/resend, silent capital send,
   HR page (Phase 57).
