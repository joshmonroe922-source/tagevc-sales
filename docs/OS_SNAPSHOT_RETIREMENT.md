# Snapshot Retirement Plan — `os_store_snapshots`

**Status:** Phase 32 — Stage 4e fails closed on query errors and requires
approval before rename, a non-empty verified retired table, correlated database
evidence, and durable soak observations. The app does not rename or drop
`os_store_snapshots`. Offline guide: `phase32_stage4e_soft_rename.sql`.

## Dual-write / dual-read map

| Domain | Normalized tables | Snapshot writes |
|--------|-------------------|-----------------|
| `deal_flow` | leads/deals/IC + audits/handoffs | Skip via `WRITE_CUTOVER_MATURE` or `WRITE_CUTOVER_ALL` |
| `tickets` / `documents` | + audit tables | Same |
| `ma` / `re` | + handoffs | Skip via `WRITE_CUTOVER_ALL` or `SNAPSHOT_SKIP_DOMAINS` |
| Portfolio / Entity | live tables | No snapshots |
| Messaging | first-class | N/A |

## Stages

1. **Soak** — Dual-write; prefer SQL on hydrate.  
2. **Read cutover** — `USE_NORMALIZED_TABLES=1`.  
3. **Write cutover** — `WRITE_CUTOVER_MATURE` → then `WRITE_CUTOVER_ALL` (or skip list).  
4. **Soft-archive (Phase 16)** — `archive_store_snapshot(collection)` copies to `os_store_snapshot_archive`, clears live payload to `{}`.  
5. **Drop (later)** — See **`docs/OS_SNAPSHOT_STAGE4.md`**.

## Ops

### Enable cutover
```bash
WRITE_CUTOVER_MATURE=1   # deal_flow, tickets, documents
WRITE_CUTOVER_ALL=1      # + ma, re
```

### Soft-archive
- UI: `/admin/normalization`  
- API: `POST /api/admin/snapshot-archive` with `{ "only_cutover": true }`  
- Safety: refuses archive when primary normalized table is empty  

### Empty-snapshot drills
- UI: Admin Normalization → Empty-snapshot drills  
- API: `GET /api/admin/snapshot-drill`  

### Soak health
- Cron: every 6h → `/api/admin/soak-health`  
- Alerts Sentry on sync failures / FK orphans / failed drills  
- Phase 32 persists observations in `os_snapshot_soak_observations`.

### Rollback write cutover
Unset cutover env vars and redeploy. Snapshot upserts resume. Restore from archive with SQL (see Stage 4 doc).

### Governed soft rename

1. Apply `phase31_marketing_it_governance.sql`,
   `phase32_operational_evidence.sql`, and
   `phase33_it_warranty_intune_soak.sql`.
2. Complete production drills, retention, export, and written approval gates.
3. Review `phase33_stage4e_soft_rename.sql`; it contains guidance only.
4. Perform the rename offline and record `os_snapshot_retirement_events`.
5. Set the four `SNAPSHOT_SOFT_RENAME*` / retired-table environment values.
6. Observe the durable rename epoch. Any unhealthy result, observation gap
   over eight hours, or rollback breaks qualification.

The Phase 33 application and guide contain no rename or DROP execution path.

## Phase 34 evidence controls

1. Apply `phase34_intune_drill_governance.sql`.
2. Cron and operator drills persist a run, every domain/check result, deployment
   revision, configuration fingerprint, and SHA-256 evidence hash.
3. Only healthy cron observations in distinct six-hour buckets can advance an
   epoch. Manual observations remain visible but are non-qualifying.
4. Duplicate cron delivery is idempotent. A configuration fingerprint change,
   unhealthy check, excessive gap, or rollback breaks continuity.
5. An epoch cannot start until the latest matching durable event is
   `rename_verified` and the structured drill passed.
6. Review `phase34_stage4e_drill_governance.sql` for read-only evidence queries.

Phase 34 adds no application relation-rename or destructive execution path.

## Exit criteria before drop

- [x] Soft-archive completed for cut-over collections (Phase 16)  
- [x] FKs validated (Phase 17)  
- [x] Empty-snapshot drills documented + tooling (Phase 18)  
- [x] SQL-only hydrate for cut-over domains (Phase 19 Stage 4b)  
- [ ] Empty-snapshot drills passing in production (ops confirm)  
- [ ] Archive backup retained (use `/api/admin/archive-export`)  
- [ ] App hydrate paths no longer require snapshot payloads for pipeline domains  
- [ ] Written soft-rename approval and durable audit evidence recorded
- [ ] Retired table verified and continuous healthy soak epoch qualified

## Blockers for fully retiring `os_store_snapshots`

1. Stage 4c full stop (no table reads at all) not required while soft-archived `{}` rows remain.  
2. Need confirmed production drill pass + soak window.  
3. Stage 4e DROP still deferred.  

## Phase 35 two-actor rollback evidence

- An operator records a hashed manifest from an isolated offline rollback
  rehearsal plus the external artifact and reviewed procedure hashes.
- The manifest must explicitly prove no production relation mutation and passed
  restore/application validation.
- A distinct reviewer must attest the exact manifest hash before the evidence
  becomes valid.
- Actor reuse, hash drift, stale row version, epoch/config mismatch, and expiry
  fail closed.
- Accepted evidence is valid for 90 days and is required by the Stage 4e
  checklist for the active epoch.
- The application accepts evidence only; it cannot run rollback SQL or mutate
  `os_store_snapshots`.

SQL: `phase35_intune_rollback_attestations.sql`. Read-only evidence inspection:
`phase35_stage4e_attestation_guide.sql`.

## Phase 36 attestation lifecycle

- A versioned manifest and one evidence-bundle hash bind the epoch, retired
  relation, configuration, manifest, external artifact, and procedure.
- Pending and accepted evidence are explicitly expired when time, epoch status,
  or configuration no longer qualifies.
- Newly accepted evidence supersedes prior valid evidence atomically; rejected
  pending evidence does not invalidate a prior valid attestation.
- The reviewer sees the complete manifest, artifact link, hashes, actor
  separation, validity, and lifecycle timeline before deciding.
- The application does not drop `os_store_snapshots`; Stage 4e remains governed
  evidence and offline operations only.

SQL: `phase36_snapshot_attestation_lifecycle.sql`.

## Phase 37 transactional evidence cycles

- One service-role RPC atomically persists the drill run, every check, epoch
  transition, and linked soak observation.
- Transaction-scoped locking and an effective-epoch uniqueness rule prevent
  concurrent epoch forks.
- Exact cron retries return the committed cycle; hash or check-count conflicts
  fail closed.
- Qualification preserves its first timestamp and requires linked, hashed cron
  evidence.
- Hourly Shared Services SLO evaluation proactively refreshes attestation
  lifecycle state and monitors observation age, validity, and evidence
  integrity.
- No Phase 37 migration drops, renames, alters, or writes
  `os_store_snapshots`.

SQL: `phase37_snapshot_evidence_transaction.sql` and
`phase37_shared_service_slos.sql`.

## Phase 38 canonical lifecycle evidence

- Canonical evidence binds the exact observation time, requested actor,
  normalized configuration, contract version, code revision, complete drill
  report, and soak observation.
- Exact replays return the committed cycle. Conflicting same-key input is
  retained as an immutable conflict event and fails closed.
- Broken or rolled-back epochs transactionally invalidate linked observations,
  drill runs, evidence cycles, and pending or attested rollback rehearsals.
- Natural rehearsal expiry remains distinct from governance invalidation.
- Snapshot integrity SLOs evaluate the latest cycle, including failed or
  conflicted cycles, rather than selecting an older qualifying observation.
- No Phase 38 migration drops, renames, alters, or writes
  `os_store_snapshots`.

SQL: `phase38_snapshot_cycle_lifecycle.sql` and
`phase38_slo_ownership_delivery.sql`.

## Non-goals

- Dropping the table in Phase 16–19  
- DocuSign / push
