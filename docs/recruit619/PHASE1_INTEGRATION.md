# Recruit 619 × TalentDesk — Phase 1 integration

Large integration plan for embedding the recruiter platform into **Manage Portfolio → Recruit 619**, plus manager roles and HR-driven provisioning. This document is the Phase 1 foundation; Phases 2–3 are not implemented yet.

## Can we do all of it?

**Yes — phased.** Do not expect manager KPIs + HR auto-provision in one pass.

| Phase | Scope | Est. |
|-------|--------|------|
| **1** | Entity nav (Leadership / Recruiters / Managers shells); deep-link (+ optional iframe preview) to TalentDesk `/placement`; **portal SSO** (`talentdesk-sso` → `/api/auth/portal-sso`) | **Started** (portal + SSO live) |
| **2** | `manager` role + assignments in TalentDesk; manager dashboard (per-employee + team KPI rollup); **Location / Region / COO hierarchy scaffold** (`/hierarchy`); portal assignment UI | Medium (1–2 weeks focused) — **KPI hierarchy scaffolded locally** (see [KPI_HIERARCHY.md](./KPI_HIERARCHY.md)); not production-deployed |
| **3** | HR hire → Onboarding/Active for Recruit 619 entity → provision TalentDesk user by **work email** + role | Medium (depends on Phase 2 roles) |

## Repos

| App | Path | Notes |
|-----|------|--------|
| Tage portal (this repo) | `/Users/joshmonroe/Projects/tagevc-sales` | Manage Portfolio entity `slug = recruit-619` |
| **TalentDesk** (recruiter app) | `/Users/joshmonroe/Recruiting Tools` | Live at **https://app.recruit619.com** (Vercel project `recruit619`) |
| Marketing site | `/Users/joshmonroe/Projects/recruit619-website` | recruit619.com — not TalentDesk |
| Salesforce scripts | `/Users/joshmonroe/Projects/619-recruiting` | SF Connected App helpers — not the web app |

## TalentDesk auth model

- **Auth.js / NextAuth v5** (`next-auth` beta) with **Credentials** (email + bcrypt password)
- Allowlist: **`@recruit619.com`** + optional `AUTH_ALLOWLIST` (`src/lib/auth/allowlist.ts`)
- Roles on `User.role`: **`admin | recruiter`** only today (`prisma/schema.prisma`) — **no manager yet**
- Session: JWT; Microsoft Entra ID stubbed for later
- DB: Prisma + **Postgres in prod** (Neon); SQLite optional locally
- KPIs: `/performance` and a strip on `/placement` lead with **send outs** (day / week / month, local timezone) and **send outs per placement** (`Submittal` ÷ confirmed `Placement`). Manager view uses the same primary metrics org-wide until Phase 2 assignments.

**Not** Clerk, and **not** Supabase Auth (portal uses Supabase; TalentDesk does not).

## Phase 1 embed / rehome strategy (do not destroy live app)

**Keep** `https://app.recruit619.com` as the TalentDesk origin. Phase 1 does **not** move Next.js routes into the Vite portal.

### Preferred UX (shipped)

1. Portal: Manage Portfolio → Recruit 619 → **Recruiters**
2. Primary CTAs: **Open Placement →** / **TalentDesk Login** — mint short-lived SSO JWT, open TalentDesk already signed in
3. Optional **embed preview** iframe — expect blank frame / unauthenticated until TalentDesk sets CSP `frame-ancestors` for the portal origin (embed does not carry SSO cookies)

Direct visits to `https://app.recruit619.com` still use email/password. See **SETUP_RECRUIT619.md**.

### Later options (not done)

| Option | Pros | Cons |
|--------|------|------|
| A. Deep-link only | Zero framing/CSP risk | Leaves portal shell |
| B. iframe after CSP | Feels “inside” entity | Cookie / SameSite / third-party issues; still separate login |
| C. Reverse-proxy same origin | Cleaner cookies | Ops heavy; riskier for live deploy |
| D. Rehome UI routes into portal | Single SPA | Large rewrite; don’t do in Phase 1 |

### SSO / auth bridge (shipped)

Short-lived HMAC JWT from Tage portal (`talentdesk-sso` edge) → TalentDesk
`/api/auth/portal-sso`. Shared secret: `TALENTDESK_SSO_SECRET` (Supabase) =
`PORTAL_SSO_SECRET` (Vercel). Direct `app.recruit619.com` visits still use
email/password. See **SETUP_RECRUIT619.md**.

**Email mapping:** portal can stay `@tagevc.com`; TalentDesk stays `@recruit619.com`.
SSO remaps by local-part (`joshmonroe@tagevc.com` → `joshmonroe@recruit619.com`),
plus optional `TALENTDESK_EMAIL_MAP` / `AUTH_ALLOWLIST`. Do not force TalentDesk
accounts onto `@tagevc.com`.

### HR provisioning bridge (Phase 3 — not done)

Shared identity key: **work email** (`hr_employees.work_email` ↔ TalentDesk `User.email`).

```text
HR: status → onboarding|active, entity = recruit-619
        │
        ▼
Portal edge / webhook
        │  create-or-update TalentDesk User
        │  role = recruiter | manager (from job title / flag)
        │  mustChangePassword = true (temp password or magic reset link)
        ▼
TalentDesk allowlist (@recruit619.com already ok)
```

Bridge options for Phase 3 provisioning:

1. **Provision API** on TalentDesk (server-to-server secret) called from Supabase edge when HR status changes
2. **Shared allowlist sync** — portal pushes emails into TalentDesk `User` rows; credentials email/password or Entra later
3. **Entra SSO** — both apps trust Microsoft Entra (portal already MS Graph–oriented; TalentDesk has Entra stub)

Phase 1 portal login SSO is live; Phase 3 still owns HR-driven user provisioning.

## Portal routes shipped (Phase 1)

Only for entity `slug === recruit-619` (others redirect to overview):

| Path | Section |
|------|---------|
| `/sales/ops/entities/:id` | Overview (existing checklist/docs) + section nav |
| `/sales/ops/entities/:id/leadership` | Leadership shell |
| `/sales/ops/entities/:id/recruiters` | Deep-link + optional embed |
| `/sales/ops/entities/:id/managers` | Managers shell / roadmap |

Optional env: `VITE_TALENTDESK_ORIGIN` (default `https://app.recruit619.com`).

## Phase 2 / 3 reminder

- **Phase 2** owns manager product (assignments + real KPI rollups).
- **Phase 3** owns HR → TalentDesk provisioning.
- Do not claim full manager/KPI product from Phase 1 shells alone.
