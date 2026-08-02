# Entra JWT `org_ids[]` for graph RLS (C2)

## Goal

Spine RLS helpers (`fn_org_ids()`, `fn_has_org()`, `fn_can_see_account`) read claims from `auth.jwt()`. Entra OIDC users need those claims injected before Postgres RLS can isolate tenants.

## Claims contract

| Claim | Type | Meaning |
|-------|------|---------|
| `entra_oid` | string | Maps `user_profiles.entra_oid` |
| `org_ids` | uuid[] | Active memberships |
| `active_org_id` | uuid | UI selected org |
| `roles` | text[] | Roles in active org |
| `is_tage_admin` | bool | Cross-tenant break-glass |

Code: `src/lib/spine/auth/entra-claims.ts` · SQL: `supabase/migrations/spine/0009_rls.sql`

## Setup (Josh / Entra admin — once)

1. **Supabase Dashboard → Authentication → Hooks → Custom Access Token**  
   Point at Edge Function `spine-claims` (scaffold SQL/docs below) **or** HTTP hook that returns claims JSON.
2. **Entra app** (`905649ff-…`, tenant `aecc0efa-…`) already used for OS login — ensure OID is available on the ID token (`oid` / `sub`).
3. After login, call `ensureAdminMemberships` once for Josh so `memberships` cover `tage` / `recruit619` / `signent` / `instant_nda`.
4. Verify in SQL: `select auth.jwt();` as the user shows `org_ids`.

## Scaffold without full Entra admin

Until the Auth Hook is live:

- Server routes use **service role** for graph writes (existing persist client).
- `buildSpineClaimsForUser({ email, entraOid })` derives the same shape from `user_profiles` + `memberships` for app-layer checks.
- RLS policies remain correct for when JWT claims land — no rewrite needed.

## Edge Function sketch (deploy later)

```ts
// supabase/functions/spine-claims/index.ts (not deployed yet)
// Input: { user_id, claims }
// Lookup user_profiles by entra_oid / email → memberships → return
// { claims: { org_ids, active_org_id, roles, is_tage_admin, entra_oid } }
```

## Acceptance

- [ ] Hook enabled in Supabase
- [ ] Josh JWT contains 4 org UUIDs
- [ ] Non-admin user only sees linked accounts via RLS (not service role)
