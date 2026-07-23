# Multi-subsidiary readiness (P1–P6)

Tage VC OS as the org-wide backbone for subsidiaries — one ticketing system,
one messaging system, additive SQL, least privilege, local-first entity
visibility. `os_store_snapshots` is never dropped or mutated. Money is never
auto-approved. Diagnose / approve / escalate + forbid-list safety preserved.

**Portal:** https://app.tagevc.com

## Canonical entities

| Code | Name | Portal | Notes |
|------|------|--------|-------|
| `ENT-FIRM` | Tage Venture Capital | https://app.tagevc.com | Parent |
| `ENT-R619` | Recruit 619 | https://portal.recruit619.com | Seeded |
| `ENT-INDA` | Instant NDA | *TODO* | Canonical; legacy seed code `ENT-002` aliases here |

Alias resolution: `resolve_canonical_entity_id('ENT-002') → ENT-INDA` (SQL + TS).
Existing `ENT-002` rows remain valid; new writes prefer `ENT-INDA`.

## SQL apply order

```bash
# From repo root, with DATABASE_URL set:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tagevc-os/supabase/phase_ms_p1_entity_registry_policy.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tagevc-os/supabase/phase_ms_p2_ticketing_multi_entity.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tagevc-os/supabase/phase_ms_p3_messaging_multi_entity.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tagevc-os/supabase/phase_ms_p4_ss_operator_ux.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tagevc-os/supabase/phase_ms_p5_identity_lifecycle.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tagevc-os/supabase/phase_ms_p6_parent_health_verification.sql
```

Prefix `phase_ms_pN_` avoids colliding with OS phase numbers (Phase 55+).

## What shipped

### P1 — Entity registry + policy spine
- `os_entity_registry`, `os_entity_aliases`, `os_entity_policy`, append-only
  `os_entity_policy_audits`
- Directory / cross-entity messaging / ticket visibility defaults
- RPC: `list_entity_registry_ms_p1`, `resolve_canonical_entity_id`

### P2 — Ticketing multi-entity
- Fail-closed `entity_id` on new creates (app + form)
- Context link types: Recruit account/person/job/placement/application/offer;
  Instant NDA customer/subscription/lead/support_case/usage_event
- Null-entity backfill → `ENT-FIRM` (append-only audit)
- Subsidiary API: `POST/GET /api/subsidiary/tickets`
- Phase 54 inbox entity filter treats `ENT-002` ≡ `ENT-INDA`

### P3 — Messaging multi-entity
- Home-entity membership provision/deprovision RPCs
- Default channels per entity; directory entity badges
- Cross-entity DM/room policy (`dm_opt_in_rooms_deny`)
- Portal deep-link / SSO hooks (INDA portal URL TODO)

### P4 — Shared Services operator UX
- Operator board by service / entity / priority + parent vs subsidiary
- Entity-aware assignment rule seeds
- Ticket detail header shows parent vs subsidiary context
- `/shared-services#multi-sub` panels

### P5 — Central identity lifecycle
- Joiner / mover / leaver checklists (same engine for R619 + INDA)
- Leaver revoke-first: portal → messaging → ticketing → IT → evidence
- Control center RPC + `POST/GET /api/identity/lifecycle`
- Failed-step append-only audits + retry status

### P6 — Parent health + verification
- Health: ticket volume/SLA by entity, messaging provision failures,
  lifecycle success/failure
- Eight dual-sub verification scenarios (automated contract tests)

## Subsidiary ticket API contract

**Base:** `https://app.tagevc.com/api/subsidiary/tickets`

**Auth (least privilege):**
1. `Authorization: Bearer <signed token>` — HMAC body
   `base64url(clientId.entityId.exp).sig` with `SUBSIDIARY_API_SECRET`
   (or `SUBSIDIARY_API_SECRET_<CLIENT>` / `CRON_SECRET`)
2. Headers: `x-tagevc-subsidiary-client: recruit619_portal|instantnda_portal`
   + `x-tagevc-subsidiary-secret: <secret>`

**Clients:**

| client_id | entity_id | scopes |
|-----------|-----------|--------|
| `recruit619_portal` | `ENT-R619` | `tickets:read`, `tickets:write` |
| `instantnda_portal` | `ENT-INDA` | `tickets:read`, `tickets:write` |

**POST create**
```json
{
  "title": "Need access",
  "service": "IT",
  "priority": "P2",
  "entity_id": "ENT-R619",
  "description": "...",
  "context_links": [
    { "link_type": "r619_job", "external_ref": "JOB-123" }
  ]
}
```
Response includes `autonomy_band`, `forbid_hits`, `draft_approval`
(diagnose preserved). Client may only create for its own entity.

**GET status:** `?ticket_id=TK-123`  
**GET list entity:** (default) optional `?service=IT`  
**GET list mine:** `?mine=1` or `?requester=...`

Money is never auto-approved (`money_auto_approve: false`).

## Identity lifecycle API

**Base:** `https://app.tagevc.com/api/identity/lifecycle`  
Auth: `CRON_SECRET` / `DIGEST_SECRET` Bearer or `write:it_assets` session.

**POST** `{ "lifecycle_kind": "joiner"|"mover"|"leaver", "user_id": "...", "home_entity_id": "ENT-R619" }`  
**GET** control center (failed steps + runs). Fail-soft preview if SQL not applied.

## Admin steps

1. Apply SQL P1→P6 in order (above).
2. Set `SUBSIDIARY_API_SECRET` (and optional per-client secrets) in Vercel.
3. Publish Instant NDA `portal_url` — update `os_entity_registry` + deeplink row
   (search `TODO: Instant NDA portal`).
4. Optionally migrate display of seed `ENT-002` → `ENT-INDA` in UI copy only;
   do not mass-rewrite FKs without a follow-up migration plan.
5. Wire Recruit / Instant NDA portals to subsidiary ticket API with signed tokens.
6. Run joiner for new MS-tied users via lifecycle API; confirm messaging
   membership + default channels.
7. Refresh SS inbox + multi-sub health from `/shared-services`.

## Ready / not-ready

| Surface | Status |
|---------|--------|
| Entity registry + ENT-INDA alias | **Ready** (SQL + TS) |
| Ticketing multi-entity + subsidiary API | **Ready** (fail-closed creates; auth requires secrets in prod) |
| Messaging multi-entity | **Ready** — RPCs + badges; DM/channel open gated by cross-entity policy |
| SS operator UX | **Ready** on `/shared-services` |
| Identity lifecycle JML | **Ready** (control center; ties into existing IT on/offboarding) |
| Parent health panels | **Ready** (partial feed until SQL applied in env) |
| Instant NDA portal URL | **Not ready** — TODO placeholder |
| Live dual-sub E2E against prod portals | **Not ready** — contract tests cover 8 scenarios; live feeds fail-soft |

## Residual risks

- Seed/demo data still uses `ENT-002` in places; alias layer covers equivalence
  but operators should prefer `ENT-INDA` going forward.
- Messaging cross-entity enforcement: `startDirectMessageAction` /
  `startChannelAction` call `can_cross_entity_message_ms_p3` (TS fail-soft).
- Subsidiary API is powerless until secrets are configured in production.
- Do not auto-approve capital / dual-approve gates — unchanged.

## Verify

```bash
export PATH="/Users/joshmonroe/.nvm/versions/node/v24.18.0/bin:$PATH"
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
```
