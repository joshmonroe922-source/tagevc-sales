# Phase 41 — Production Ledgers, Campaigns, and Verifiable Evidence

Phase 41 advances Phase 40 rails: production revenue authenticity, governed
archive campaigns, Intune postmortems with bounded recommendations, SLO export
and coverage calendars, and externally verifiable cold snapshot receipts.
`os_store_snapshots` is never mutated.

## Marketing

- Production ledger profiles (`production_v1` / `sandbox_v1`) and expanded
  authenticity modes (`signed_headers_v1`, `jwt_bearer_v1`) fail closed.
- Append-only authenticity probe evidence stores digests/metadata only.
- Settlement-lag visibility joins Phase 39 paid revenue evidence when present.
- Hub panel: correction approve/reject queue, authenticity status, settlement
  lag; visionary/admin source upsert/bind.

Apply `supabase/phase41_marketing_production_ledgers.sql` after Phase 40
marketing SQL.

## DocuSign

- Campaigns: `legacy_backfill_completion` and `quarterly_full_integrity` with
  gates (remaining unhashed, quarantine backlog/aging).
- Worker campaign ticks no-op until due; never create/void/resend envelopes.
- Hub shows campaign progress, remaining %, quarantine aging, last full scan.

Apply `supabase/phase41_docusign_archive_campaigns.sql`.

Cron: monthly `/api/docusign/archive-governance-worker?mode=full&campaign=quarterly`
(`0 5 1 * *`) — returns `not_due` until the quarter needs a full campaign.

## Intune

- Aggregate outage postmortems (no entity-level leak) with maker-checker publish.
- Bounded threshold recommendation drafts create Phase 40 tuning proposals only;
  blocked while breaker is open/half-open; still require independent review.
- Follow-ups generated after outage correlation in the existing Intune worker.

Apply `supabase/phase41_intune_outage_postmortems.sql`.

## Shared Services and observability

- Signed simulation result exports (HMAC metadata packages; counterfactual
  labeled; no webhook URLs/secrets).
- Owner coverage calendar over upcoming day buckets.
- Admin UI: export action + coverage calendar on SLO policy admin.

Apply `supabase/phase41_slo_exports_coverage.sql`.

Env: `SLO_SIMULATION_EXPORT_HMAC_KEY_ID` and key / keyring.

## Snapshot retirement

- Externally verifiable ed25519 receipts with public verify material.
- Warm/cold retention tiers; cold cadence longer; packages and receipts remain
  non-qualifying for soak/attestation.
- Phase 41 contains no insert, update, delete, rename, alter, truncate, or drop
  against `os_store_snapshots`.

Apply `supabase/phase41_snapshot_external_receipts.sql`.

Env:

- `SNAPSHOT_EXPORT_ED25519_KEY_ID`
- `SNAPSHOT_EXPORT_ED25519_PRIVATE_KEYS` (server)
- `SNAPSHOT_EXPORT_ED25519_PUBLIC_KEYS` (offline verify)

## Deployment order

Apply after all Phase 40 migrations (and the Shared Services SLO hotfix if not
already applied):

1. `phase41_marketing_production_ledgers.sql`
2. `phase41_docusign_archive_campaigns.sql`
3. `phase41_intune_outage_postmortems.sql`
4. `phase41_slo_exports_coverage.sql`
5. `phase41_snapshot_external_receipts.sql`

Deploy the application immediately after the migrations.

Verify:

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 42+ recommendations

Phase 42 implemented the ops layer. See `docs/OS_PHASE42.md` for apply order and
Phase 43+ recommendations. Remaining theme: continue Stage 4e soak and
attestation governance; do not drop `os_store_snapshots` without separately
approved retirement.
