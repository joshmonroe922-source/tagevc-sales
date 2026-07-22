# Phase 42 — Production Ops and Evidence Cadence

Phase 42 operationalizes Phase 41 rails: production revenue SLO monitoring,
DocuSign campaign ops and quarantine aging, Intune recommendation soak,
SLO export retention/succession, and public snapshot verify material with cold
HEAD cadence. `os_store_snapshots` is never mutated.

## Marketing

- Append-only authenticity and settlement SLO snapshots for `production_v1`.
- Worker records SLO ticks after production pulls (warn/crit thresholds).
- `production_v1` gate: HTTPS + `production_ledger` + strong authenticity modes.
- Hub badges for probe-fail and settlement overdue/late rates.

Apply `supabase/phase42_marketing_production_slos.sql` after Phase 41 marketing.

## DocuSign

- Ops readiness report (backfill remaining, quarantine aging, quarterly due).
- Append-only campaign ops milestones (gated / completed / aging cleared).
- Quarantine aging queue on the DocuSign hub.
- Monthly quarterly cron unchanged (`not_due` until due).

Apply `supabase/phase42_docusign_campaign_ops.sql` after Phase 41 DocuSign.

## Intune

- Append-only soak observations after accepted Phase 41 recommendations.
- Observe tick runs after outage follow-ups; open breakers recorded only
  (`breaker_open_observed`) — never close/reset.
- IT hub shows soak status with manual refresh.

Apply `supabase/phase42_intune_recommendation_soak.sql` after Phase 41 Intune.

## Shared Services and observability

- Simulation export retention (`retained_until`) and append-only audit access.
- Owner succession proposals write Phase 40 `replacement_owner_id` only.
- Admin UI: export history/retention badges; calendar succession CTA.

Apply `supabase/phase42_slo_export_retention_succession.sql`.

Optional env: `SLO_SIMULATION_EXPORT_RETENTION_DAYS` (default 90, bounds 30–730).

## Snapshot retirement

- Published public verify material (`key_id`, SPKI fingerprint; no private keys).
- Cold-only retention check cadence evidence; warm unchanged.
- Offline verify bundle download + `scripts/verify-snapshot-receipt.mjs`.
- Phase 42 contains no insert, update, delete, rename, alter, truncate, or drop
  against `os_store_snapshots`.

Apply `supabase/phase42_snapshot_verify_cold_ops.sql`.

Env: reuse `SNAPSHOT_EXPORT_ED25519_*` and retention allowlists; optional
`SNAPSHOT_COLD_RETENTION_CHECK_CADENCE_HOURS` (default 168).

## Deployment order

Apply after all Phase 41 migrations:

1. `phase42_marketing_production_slos.sql`
2. `phase42_docusign_campaign_ops.sql`
3. `phase42_intune_recommendation_soak.sql`
4. `phase42_slo_export_retention_succession.sql`
5. `phase42_snapshot_verify_cold_ops.sql`

Deploy the application immediately after the migrations.

Verify:

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 43+ recommendations

1. Bind live production ledger credentials and alert on authenticity/settlement
   SLO critical windows in ops channels.
2. Clear DocuSign backfill to zero remaining, age down quarantine, then execute
   the first governed quarterly full integrity campaign with ops milestones.
3. Close the loop on Intune soak: publish real postmortems, accept bounded
   recommendations, observe soak through open/closed breaker cycles.
4. Enforce SLO export retention purge policy (metadata-only archival) and run
   succession drills from the coverage calendar.
5. Publish ed25519 public keys firm-wide; schedule cold HEAD cadence against
   production destinations; keep Stage 4e soak evidence accumulating.
6. Continue Stage 4e soak and attestation governance. Do not drop
   `os_store_snapshots` without the separately approved retirement operation.
