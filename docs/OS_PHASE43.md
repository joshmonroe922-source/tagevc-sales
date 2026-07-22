# Phase 43 — Ops Loop Closure

Phase 43 closes production ops loops on Phase 42 rails: marketing critical SLO
alerts and credential binding health, gated first DocuSign quarterly, Intune
soak open→closed cycle evidence, SLO export archival and succession drills, and
firm-wide snapshot verify with production cold HEAD cadence.
`os_store_snapshots` is never mutated.

## Marketing

- Credential binding health checks env **names** only (present/absent flags;
  never stores secrets).
- Idempotent critical-window ops alerts delivered via existing
  `SLO_WEBHOOK_OPS_ALERTS` + `SLO_WEBHOOK_ALLOWED_HOSTS`.
- Worker runs Phase 43 tick after Phase 42 SLO snapshots; hub badges for
  binding health and alert delivery.

Apply `supabase/phase43_marketing_slo_ops_alerts.sql` after Phase 42 marketing.

Optional env: `MARKETING_SLO_ALERT_COOLDOWN_HOURS` (default 24).

## DocuSign

- Unlock first quarterly when remaining unhashed = 0 and quarantine aging/backlog
  gates pass.
- Append-only runbook evidence through completion; hub CTA only while unlocked
  and not yet completed.
- Workers still never create/void/resend envelopes.

Apply `supabase/phase43_docusign_first_quarterly_ops.sql` after Phase 42 DocuSign.

## Intune

- Observe-only cycle evidence: `breaker_open_observed` →
  `breaker_closed_observed` / `cycle_complete` when the breaker is already
  closed naturally.
- Requires published postmortem; never closes or resets breakers.
- IT hub shows open→closed cycle timeline.

Apply `supabase/phase43_intune_soak_cycle_evidence.sql` after Phase 42 Intune.

## Shared Services and observability

- Metadata-only archival of expired simulation exports (append receipt;
  soft-hide from default list; no destructive deletes).
- Succession drills distinct from live Phase 42 succession proposals.
- Admin UI: archive expired + run succession drill.

Apply `supabase/phase43_slo_export_archival_succession_drills.sql`.

## Snapshot retirement

- Firm-wide published public verify catalog (no private keys).
- Production cold HEAD against allowlisted `SNAPSHOT_RETENTION_DESTINATIONS`
  for due cold packages.
- Phase 43 contains no insert, update, delete, rename, alter, truncate, or drop
  against `os_store_snapshots`.

Apply `supabase/phase43_snapshot_verify_cold_production.sql`.

Env: reuse `SNAPSHOT_EXPORT_ED25519_*`, retention allowlists, optional
`SNAPSHOT_COLD_RETENTION_CHECK_CADENCE_HOURS`.

## Deployment order

Apply after all Phase 42 migrations:

1. `phase43_marketing_slo_ops_alerts.sql`
2. `phase43_docusign_first_quarterly_ops.sql`
3. `phase43_intune_soak_cycle_evidence.sql`
4. `phase43_slo_export_archival_succession_drills.sql`
5. `phase43_snapshot_verify_cold_production.sql`

Deploy the application immediately after the migrations.

Verify:

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 44+ recommendations

1. Wire live production ledger secrets into bound env names and monitor
   critical alert delivery success rates.
2. Drive DocuSign backfill/quarantine to unlock and complete the first
   governed quarterly campaign; schedule recurring quarterlies thereafter.
3. Exercise Intune soak cycles on real outages; feed cycle evidence into
   postmortem quality reviews.
4. Automate nightly SLO export archival and quarterly succession drills with
   audit reporting.
5. Rotate and publish ed25519 public keys firm-wide; alert on cold HEAD
   failures against production destinations.
6. Continue Stage 4e soak and attestation governance. Do not drop
   `os_store_snapshots` without the separately approved retirement operation.
