# My Recruiting Desk — where it lives

## Open it now

| Surface | URL | Status |
|---------|-----|--------|
| **My Recruiting Desk (full app)** | https://app.recruit619.com | **Live** — Vercel project `recruit619` |
| Login | https://app.recruit619.com/login | Auth.js email/password (`@recruit619.com`) |
| Placement / GTM | https://app.recruit619.com/placement | Live |
| Performance / commissions | https://app.recruit619.com/performance | Live |
| KPI hierarchy | https://app.recruit619.com/hierarchy | Live |
| Bulk email analytics | https://app.recruit619.com/bulk-email | Live |
| Training | https://app.recruit619.com/training | Live |
| Think Tank | https://app.recruit619.com/think-tank | Live |

**Local codebase:** `/Users/joshmonroe/Recruiting Tools` (package name / README: **My Recruiting Desk Portal**; formerly Talent Desk / TalentDesk).

## Related portals (easy to confuse)

| App | URL | Role |
|-----|-----|------|
| **Recruit 619 OS** | https://portal.recruit619.com | Subsidiary OS spine (help desk, jobs, pipeline, AM Desk) — Vercel `recruit619-portal` |
| **Tage OS** | https://app.tagevc.com | Firm spine — entity `ENT-R619` rollups + drill-downs |
| **Tage Vite portal** | https://portal.tagevc.com (sales) | Deal sourcing; Platform tab **SSO → Recruiting Desk** |

## How to open from Tage / R619 OS

1. **Tage OS → Companies → Recruit 619** (`/entities/ENT-R619`) — **My Recruiting Desk** CTAs (OS spine + full desk).
2. **R619 portal** — nav **My Recruiting Desk** → `/my-recruiting-desk` hub (OS desk + deep links to full app).
3. **Tage Vite portal** — Manage Portfolio → Recruit 619 → **Platform** → SSO (`talentdesk-sso` edge → `app.recruit619.com`).

## Product intent (confirmed)

- Keep **OS spine** (help desk, shared services, messaging, tech, financial + KPI rollups to Tage).
- Day-to-day for recruiters / managers / leadership = **My Recruiting Desk** layout & features (reporting, commissions, revenue, KPIs, training, AI matching).
- Systems flow **desk ↔ spine** both ways.
