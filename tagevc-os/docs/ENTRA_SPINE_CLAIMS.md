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

Code: `src/lib/spine/auth/entra-claims.ts` · SQL: `supabase/migrations/spine/0009_rls.sql` · Hook: `supabase/phase95_spine_claims_hook.sql`

## Apply + enable (production)

1. **SQL** (already shippable):

```bash
cd tagevc-os
set -a && source .env.local && set +a
node scripts/apply-phase95-spine-claims-hook.mjs
```

2. **Supabase Dashboard → Authentication → Hooks → Custom Access Token**  
   - Enable Postgres function: `public.custom_access_token_hook`  
   - (Optional alternate) Edge Function `supabase/functions/spine-claims` — prefer Postgres hook.

3. **Memberships** — Admin → Enrichment → **Ensure my spine org memberships** (visionary), or call `ensureAdminMemberships` so Josh covers `tage` / `recruit619` / `signent` / `instant_nda`.

4. **Verify** — re-login, then `select auth.jwt()->'org_ids';` (or decode access token) shows 4 org UUIDs.

## Scaffold without Dashboard toggle

Until the Auth Hook is toggled on:

- Server routes use **service role** for graph writes (persist client).
- `buildSpineClaimsForUser({ email, entraOid })` derives the same shape from `user_profiles` + `memberships` for app-layer checks.
- RLS policies remain correct for when JWT claims land — no rewrite needed.

## Acceptance

- [x] Hook SQL + Edge Function scaffold in repo
- [ ] Hook enabled in Supabase Dashboard (Josh one-click)
- [ ] Josh JWT contains 4 org UUIDs after ensure-memberships
- [ ] Non-admin user only sees linked accounts via RLS (not service role)
