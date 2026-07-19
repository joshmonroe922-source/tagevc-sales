# Recruit 619 (TalentDesk) setup

See **[docs/recruit619/PHASE1_INTEGRATION.md](docs/recruit619/PHASE1_INTEGRATION.md)** for feasibility, repo locations, auth model, and phase plan.

**KPI hierarchy (Recruiter → Manager → Location → Region → COO):** see **[docs/recruit619/KPI_HIERARCHY.md](docs/recruit619/KPI_HIERARCHY.md)**. Portal KPIs tab + TalentDesk `/hierarchy`. Migration `0044` (local/staging only until Josh green-lights).

## Quick links

- Portal entity: Manage Portfolio → **Recruit 619** (`slug: recruit-619`)
  - Tabs: Overview · Leadership · Think Tank · Financial · KPIs · Platform
  - **Recruiters / Managers removed** from portfolio nav — use Platform → Recruiting Desk SSO (or open TalentDesk directly). See [SETUP_PORTFOLIO_ENTITIES.md](./SETUP_PORTFOLIO_ENTITIES.md).
- Live recruiter app: https://app.recruit619.com/placement
- KPI hierarchy (TalentDesk): https://app.recruit619.com/hierarchy (after deploy; local `/hierarchy`)
- Local TalentDesk codebase: `/Users/joshmonroe/Recruiting Tools`

## Portal → TalentDesk SSO

When a Recruit 619 employee is already signed into the **Tage VC portal** and clicks **TalentDesk Login** / **Open Placement**, the portal mints a **short-lived (~60s) HMAC JWT** and redirects to TalentDesk, which creates an Auth.js session and lands on `/placement` — **no second login**.

Opening **https://app.recruit619.com** directly (outside the portal) still requires normal TalentDesk email/password login. Password auth is unchanged.

### Email identity (portal vs TalentDesk)

Portal login and TalentDesk accounts often use **different domains**:

| Surface | Typical email |
|---------|----------------|
| Tage VC portal | `joshmonroe@tagevc.com` |
| TalentDesk | `joshmonroe@recruit619.com` |

**Do not** change the TalentDesk account to `@tagevc.com`. SSO maps by local-part:

1. Already `@recruit619.com` → use as-is
2. Else `@tagevc.com` (and optional `TALENTDESK_MAP_DOMAINS`) → same local-part `@recruit619.com`
3. Optional explicit overrides via `TALENTDESK_EMAIL_MAP` (`from=to` pairs)

TalentDesk `/api/auth/portal-sso` accepts the mapped email (or either address on `AUTH_ALLOWLIST`).

### Flow

1. Portal user clicks **Log into Recruiting Desk (SSO)** on the entity **Platform** tab (or legacy Recruiters/Managers routes that redirect there).
2. Authenticated call → Supabase edge `talentdesk-sso` with the portal session Bearer token.
3. Edge function uses `work_email ?? email`, **maps** to TalentDesk email (see above), checks `@recruit619.com` / `AUTH_ALLOWLIST`, signs JWT (`iss=tagevc-portal`, `aud=talentdesk`, `exp≈60s`) with the **mapped** address.
4. Browser opens `https://app.recruit619.com/api/auth/portal-sso?token=…&next=/placement`.
5. TalentDesk verifies signature, remaps if needed, match/creates `User` by TalentDesk email, Auth.js session → redirect to `/placement`.

### Shared secret (required)

Generate once and set the **same value** on both sides:

```bash
openssl rand -base64 32
```

| Where | Env var |
|-------|---------|
| **Supabase** (portal edge secrets) | `TALENTDESK_SSO_SECRET` |
| **TalentDesk Vercel** (`recruit619`) | `PORTAL_SSO_SECRET` |

Optional aliases are accepted (`PORTAL_SSO_SECRET` on portal / `TALENTDESK_SSO_SECRET` on TalentDesk), but prefer the names above.

Also set on the portal edge (if not already defaulted):

```bash
TALENTDESK_ORIGIN=https://app.recruit619.com
# Optional: comma-separated extras beyond @recruit619.com (mirror TalentDesk)
# AUTH_ALLOWLIST=
# Optional email map (edge cases): joshmonroe@tagevc.com=joshmonroe@recruit619.com
# TALENTDESK_EMAIL_MAP=
# Optional extra source domains for local-part mapping (default: tagevc.com)
# TALENTDESK_MAP_DOMAINS=tagevc.com
```

On TalentDesk (Vercel), the same optional map/domain vars are honored as defense-in-depth. Backup allowlist (not a substitute for mapping):

```bash
# AUTH_ALLOWLIST=joshmonroe@tagevc.com
```

### Portal frontend env

```bash
# optional override
VITE_TALENTDESK_ORIGIN=https://app.recruit619.com
```

### Deploy notes

1. Set `TALENTDESK_SSO_SECRET` in Supabase → Project → Edge Functions → Secrets (and `TALENTDESK_ORIGIN` if needed).
2. Deploy function: `supabase functions deploy talentdesk-sso`
3. Set `PORTAL_SSO_SECRET` in Vercel project **recruit619** (Production + Preview as needed).
4. Deploy TalentDesk + portal (Vercel).

### Failure modes

| Case | Behavior |
|------|----------|
| Email not mappable to `@recruit619.com` / not allowlisted | Portal shows clear error; TalentDesk login page shows allowlist message if token already issued |
| Token expired / bad signature | Redirect to TalentDesk `/login` with a clear SSO error; password login still works |
| Secret missing | Portal returns 503; TalentDesk shows misconfigured SSO message |
