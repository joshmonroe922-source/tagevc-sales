# HRIS spine — Tage + Signent client segmentation

**Product truth (canonical):** Shared Services → Human Resources is a **full operational HRIS** for Tage Venture Capital, **spined into every OS entity**. It is not a stub desk.

**Signent HR** (`ENT-SIGNENT`) is a fractional / outsourced HR subsidiary of Tage that **sells HR services**. Signent uses the **same HRIS platform**, segmenting **new Signent clients** as multi-tenant client orgs on that spine — **not** a separate HRIS product.

## Tenancy model

| Tenant | `entity_id` | `client_org_id` | Who |
|--------|-------------|-----------------|-----|
| Firm / subsidiary employees | `ENT-FIRM` · `ENT-R619` · `ENT-SIGNENT` · `ENT-INDA` | `null` | Internal operating workforce |
| Signent client workforce | `ENT-SIGNENT` | UUID (real client only) | External customer of Signent HR |

Code seam: `src/lib/hris/tenancy.ts` (`HrisTenantRef`, `SIGNENT_HRIS_MODEL`).

Do **not** invent client orgs or seed fake Signent customers. Client rows appear when Signent onboards a paying client.

## Related docs

- `docs/OS_PHASE72_HRIS.md` — process depth / Graph / DocuSign assists
- `docs/MS_GRAPH_HRIS.md` — joiner Graph provision
- `docs/VERIFIED_FIRST_SCREENING_SPINE.md` — screening consumers (HRIS + Recruit + Signent)
- `docs/PARTNER_SPINE.md` — partner enablement inherited with entities
- `docs/CONTRACTS_PAYMENTS_SOR.md` — commercial vs AP vs partner posture

## Registry

`ENT-SIGNENT` is a **canonical operating subsidiary** in `src/lib/multi-sub/entity-registry.ts` (Active).

| Surface | URL |
|---------|-----|
| Portal / desk | `https://portal.signenthr.com` |
| Marketing | `https://www.signenthr.com` |

Employment: hired via Tage OS HR Shared Services; employed by Signent HR (same pattern as R619 / INDA). Empty client tenancy SQL: `supabase/phase91_signent_client_tenancy.sql`. Vision: `docs/SIGNENT_HR_OS_VISION.md`.

## Soft stop (D07)

When joiner partner hooks are not `live_ok`, notify Visionary + HR; allow override with audit note (`src/lib/hris/partner-hook-gate.ts`). Automation health alerts stay visible — do not silently mark complete.
