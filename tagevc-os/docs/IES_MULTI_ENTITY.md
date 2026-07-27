# IES multi-entity architecture

## Boundary

Intuit Enterprise Suite (IES) is the sole accounting system of record and GL.
Tage OS reads compact reporting snapshots for visibility, close, anomalies, and
AI CFO context. It does not recreate journals, account balances, or transaction
subledgers. Subsidiary portals show read-only strips only. SSC remains a
Tage-only operator experience.

OS write-back is off by default. The only supported objects are draft
proposals. Two distinct human approvers other than the proposer are required
before an eligible proposal can be submitted. Payments, transfers, voids,
refunds, and payroll pushes are forbidden. There is no provider mutation
adapter in phase 81.

## Current vs target

| Area | Before phase 81 | Phase 81 target |
|---|---|---|
| Company map | Partial realm map | Four locked IES company IDs + parent flag + exact display names |
| Reports | COA, invoice signals, compact finance feed | Explicit per-company P&L and balance-sheet snapshots plus existing signals |
| Consolidation | Sum of available company feeds | Clearly labeled management consolidation; no hidden statutory claim or eliminations |
| Finance | Consolidated card and company list | Consolidated or selected-company posture, P&L, stale badge, scoped close links |
| AI CFO | Firm rollup with subsidiary signals | Consolidated default plus company-scoped context and explicit data gaps |
| Portals | Fail-soft finance handoff strips | Entity-locked read-only snapshot strips; never cross-company |
| Write-back | Human-gated operational pattern | Database-enforced proposal + two-human approval scaffold; fail-closed env gate |

## Authoritative company mapping (LOCKED)

Canonical storage: `os_ies_entity_map.realm_id` (digit string). Readable view:
`os_ies_company_map` (`ies_company_id` = `realm_id`). Typed mirror:
`src/lib/ies/company-map.ts`.

| IES company | IES company ID (`ies_company_id`) | OS entity_id | Display name | Parent | Sort |
|---|---|---|---|---:|---:|
| Tage Venture Capital | `9341457251412290` | `ENT-FIRM` | Tage Venture Capital | yes | 10 |
| Recruit 619 | `9341457251406251` | `ENT-R619` | Recruit 619 | no | 20 |
| Signent HR | `9341457251424506` | `ENT-SIGNENT` | Signent HR | no | 30 |
| Instant NDA | `9341457533727282` | `ENT-INDA` | Instant NDA | no | 40 |

IDs are exact digit strings with no spaces. Display labels in Finance / SSC /
CFO scopes use the names above (never raw `ENT-*`).

Global selector order:

1. **Consolidated** (OS management scope — not an IES company)
2. **Tage Venture Capital**
3. **Recruit 619**
4. **Signent HR**
5. **Instant NDA**

## Exact environment variables

Existing OAuth/API variables:

- `IES_CLIENT_ID` — Intuit app client ID
- `IES_CLIENT_SECRET` — Intuit app client secret
- `IES_TOKEN_SECRET` — at least 16 characters; encrypts OAuth tokens at rest
- `IES_ENVIRONMENT` — `sandbox` (default) or `production`
- `IES_REDIRECT_URI` — optional exact callback override
- `NEXT_PUBLIC_APP_URL` — production origin used for callback derivation
- `CRON_SECRET` or `DIGEST_SECRET` — protects the sync endpoint

Phase 81 gates:

- `IES_SYNC_ENABLED=1` — exact opt-in for read sync; missing/`0` skips safely
- `IES_WRITE_ENABLED=1` — exact opt-in checked immediately before any future
  eligible submission; missing/`0` fails closed

Company IDs live in the database map (seeded above). Do not invent alternate
per-company env IDs.

## Snapshot model and sync

`os_ies_financial_snapshots` stores compact summaries keyed by `entity_id`,
`realm_id`, report type, period/as-of, and sync time. P&L payloads contain only
revenue, expenses, and net income. Balance-sheet payloads contain only cash,
AR, and AP. Existing `os_ies_coa_snapshots`, `os_ies_invoice_signals`, and
`os_ies_finance_feed` remain supported.

Each mapped company is pulled separately. A company failure does not block
other companies. Missing reports remain null and are listed in `data_gaps`.
`last_sync_at` and `last_sync_status` live on the map; UI considers a snapshot
stale after 36 hours. The consolidated display sums available company facts
and is always labeled “management consolidation — eliminations not applied.”
Operating revenue remains in subsidiary books; parent books are for capital,
SSC/holdco, and intercompany activity.

## AI CFO

The CFO office defaults to Consolidated and permits the same four company
scopes. A company pack requests only that entity's IES, finance-control-plane,
portfolio, ticket, and anomaly facts where those sources support scoping.
Snapshot `as_of`, stale status, and `data_gaps` are included. Generated actions
remain draft tickets/checklist notes; CFO auto paths cannot submit IES writes.

## Subsidiary strips

- Recruit 619 is locked to `ENT-R619` / IES `9341457251406251`.
- Instant NDA is locked to `ENT-INDA` / IES `9341457533727282`.
- Signent HR has marketing-site shell only — see
  `signent-hr/docs/IES_FINANCE_STRIP_SCAFFOLD.md` (no portal strip shipped).

Portal strips read `/api/finance/ies/snapshot` with subsidiary auth. They must
validate the returned `entity_id`; a mismatch is discarded as a data gap.
Empty, stale, and partial states show no fabricated numbers.

## Write proposal lifecycle

`os_ies_write_proposals` supports `proposed`, `approved`, `rejected`,
`submitted`, and `failed`. Supported proposal types are draft journal, invoice,
vendor bill, and checklist note. `os_ies_write_proposal_approvals` requires
distinct approvers. A database trigger blocks approval/submission with fewer
than two approvals. Application policy additionally excludes the proposer and
checks `IES_WRITE_ENABLED`.

No phase-81 code calls an IES mutation API. Enabling `IES_WRITE_ENABLED` alone
therefore cannot post anything. A future provider adapter must preserve the
same final gate and audit the response.

## SSC operating discipline

Monthly Finance library tasks include intercompany balance review, management
fee review, and shared-cost allocation review. They are manual/guided. No
allocations are posted automatically.

Operating revenue stays in sub companies. Parent (Tage Venture Capital) holds
capital, SSC/holdco, and intercompany. Do not auto-post allocations.

## Apply and operate

1. Apply `supabase/phase81_ies_multi_entity.sql` (seeds the four locked IDs).
2. Confirm OAuth secrets (`IES_CLIENT_ID`, `IES_CLIENT_SECRET`, `IES_TOKEN_SECRET`).
3. Connect each IES company as needed so tokens exist for the seeded realms.
4. Verify `os_ies_company_map` shows the four IDs above.
5. Set `IES_SYNC_ENABLED=1` when ready to pull.
6. Keep `IES_WRITE_ENABLED=0` until a separately reviewed submission adapter exists.

The migration is additive and does **not** drop or alter `os_store_snapshots`.
SSC Finance UI remains Tage-only.
