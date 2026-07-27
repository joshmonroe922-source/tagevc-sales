# My Recruiting Desk — where it lives

**Product name:** My Recruiting Desk (formerly Talent Desk / TalentDesk)  
**Intent:** Day-to-day experience for recruiters, managers, leadership. Tage / R619 OS spine (help desk, messaging, technology, financial + KPI rollups) stays separate; systems flow both ways.

## Open it (Josh)

| Entry | URL | Status |
|-------|-----|--------|
| **Full desk (live)** | https://app.recruit619.com | **Live** — Vercel project `recruit619` |
| Placement queue | https://app.recruit619.com/placement | Live |
| Performance / commissions | https://app.recruit619.com/performance | Live |
| Hierarchy KPIs | https://app.recruit619.com/hierarchy | Live (local scaffold also) |
| Mass email + analytics | https://app.recruit619.com/bulk-email | Live |
| Training | https://app.recruit619.com/training | Live |
| Login | https://app.recruit619.com/login | Live |
| **R619 OS desk hub** | https://portal.recruit619.com/desk/my-recruiting-desk | Live after this pass deploy |
| AM Desk (OS spine) | https://portal.recruit619.com/desk | Live |
| Tage entity OS (ENT-R619) | https://app.tagevc.com/entities/ENT-R619 | Card + rollup links |

Local codebase: **`/Users/joshmonroe/Recruiting Tools`** (package name / README: “My Recruiting Desk Portal”).

## Packages / apps

| App | Path | Deploy | Role |
|-----|------|--------|------|
| My Recruiting Desk | `/Users/joshmonroe/Recruiting Tools` | `app.recruit619.com` (`recruit619`) | Full desk UX |
| Recruit 619 OS | `/Users/joshmonroe/Projects/recruit619-portal` | `portal.recruit619.com` | Subsidiary OS spine + `/desk` |
| Tage OS | `tagevc-sales/tagevc-os` | `app.tagevc.com` | Firm spine + ENT-R619 rollups |
| Tage sales portal (legacy Vite) | `tagevc-sales` (root) | `portal.tagevc.com` | SSO helper → TalentDesk |

## Nav entry points

- **My Recruiting Desk app:** left `AppShell` nav (Search, Jobs, Accounts, Placement, Performance, Training, …)
- **R619 portal:** Sidebar → Desk → **My Recruiting Desk** → `/desk/my-recruiting-desk`
- **Tage OS:** Entities → Recruit 619 → **My Recruiting Desk** card + rollup drill-downs
- **Tage sales portal:** Manage Portfolio → Recruit 619 → Platform → SSO (`talentdesk-sso`)

## Status notes

- Not archived — still the production full desk.
- Renamed in product copy from Talent Desk → **My Recruiting Desk**.
- R619 portal README still says it “replaces” TalentDesk for ops; cutover is **parallel**: portal = OS spine, app.recruit619.com = full desk until features are fully inlined.
- SSO: portal → desk via HMAC JWT (`SETUP_RECRUIT619.md`). Direct visits use desk login.
