# Brand presence setup checklist

Human-guided LinkedIn Company Pages, Google Business Profile, and GA4 — plus Tage Marketing sync. **No passwords in git.** OAuth uses existing Marketing connectors (fail-soft until `*_LIVE`).

Related: `docs/OS_BRAND_ASSETS.md` · `docs/JOSH_LINKEDIN_PROFILE.md` · `docs/PARTNER_SPINE.md#marketing-presence-gbp--ga4--linkedin-company`

## Config in OS

| Piece | Where |
| --- | --- |
| Entity URLs / placeholders | `src/lib/shared-services/entity-brand-presence.ts` |
| Presence slots + attach UI | `/shared-services/marketing/presence` |
| Partner env | `.env.example` → `GOOGLE_BUSINESS_*`, `GA4_*`, `LINKEDIN_COMPANY_*` |
| Site footers | Each public site brand config → `linkedin_company_url` |

Optional env overrides (non-secret): `NEXT_PUBLIC_LINKEDIN_COMPANY_URL_{FIRM,R619,SIGNENT,INDA}`, `GA4_PROPERTY_ID_*`, `GBP_LOCATION_ID_*`, `LINKEDIN_ORG_URN_*`.

## Discovered LinkedIn Company Pages (2026-08-07)

| Entity | Current Page name | Public URL | Org / admin notes |
| --- | --- | --- | --- |
| Tage VC | **TAGE Global - Venture Capital** | https://www.linkedin.com/company/tage-global/ | Admin id `105187955` · URN `urn:li:organization:105187955` |
| Recruit 619 | **619 Recruiting** | https://www.linkedin.com/company/619-recruiting/ | ~4K followers |
| Signent HR | **Signent Outsourced HR** | https://www.linkedin.com/company/signent-outsourced-hr/ | ~32 followers |
| Instant NDA | *(none)* | — | **Create** Page |

**Name field on Tage Edit Page is disabled/readonly** in LinkedIn UI — Josh must use LinkedIn’s name-change / Support path. Same likely for other Pages.

## Phase checklist

### 0 — Logos ✅

- [x] SoT in Marketing / Brand + `brand-assets/marketing-sot/` (11 files, HTTP 200)
- [x] `getEntityLogo` primary + icon for ENT-FIRM / R619 / SIGNENT / INDA
- [x] No re-upload

### 1 — Inventory ✅

- [x] Marketing presence partners: GBP · GA4 · LinkedIn Company
- [x] Public footers: tagevc.com, recruit619.com, signenthr.com, instantnda.us
- [ ] GA4 / GBP ids after guided create

### 2 — Website LinkedIn links ✅ (wire live)

- [x] Footer icon/link per site → Company Page URL (aria-label, noopener, blank)
- [x] Tage / Recruit / Signent URLs set to current Pages
- [ ] Instant NDA footer empty until Page created

### 3 — LinkedIn Company Pages (guided) — **IN PROGRESS / NEED_HUMAN**

| Entity | Action | Status |
| --- | --- | --- |
| Tage Venture Capital | Rebrand Tage Global → Tage VC; library logo | 🔶 Admin opened; **name locked**; logo/about/banner + affiliation pending |
| Recruit 619 | Rebrand 619 Recruiting → Recruit 619; library logo | ☐ NEED_HUMAN |
| Signent HR | Rebrand Signent Outsourced HR → Signent HR; library logo | ☐ NEED_HUMAN |
| Instant NDA | Create Page; library logo | ☐ NEED_HUMAN |

Per page: About, website, banner, short rebrand post.
**Affiliated Pages:** Tage parent; Recruit / Signent / Instant NDA affiliated.
Store page URL + org URN via Presence → Attach (URN already seeded for Tage).

**Phase 7 gate:** Names correct **and** affiliation requested/completed (or Support ticket documented). → **NOT PASSED**

### 4 — Google Business Profile (guided) — NEED_HUMAN

| Entity | Action |
| --- | --- |
| Recruit 619 | **Update** existing only (no duplicate) |
| Tage VC | Create |
| Signent HR | Create |
| Instant NDA | Create |

Same HQ; distinct brands; logos from library; LinkedIn URL on profiles where UI allows.

### 5 — GA4 — NEED_HUMAN

- [ ] One property per site
- [ ] Attach property ids in Marketing Presence
- [ ] Sync via existing connector when `GA4_LIVE`

### 6 — Tage SSC Marketing ✅ (scaffold)

- [x] Presence health cards + attach form (Tage-only SSC)
- [ ] Connection health green after IDs attached + OAuth LIVE

### 7 — Josh personal LinkedIn (blocked on Phase 3 gate)

Copy + checklist in `docs/JOSH_LINKEDIN_PROFILE.md`. **Do not apply** until gate passes. NEED_HUMAN: titles + dates.

## Success

Company Pages live and parent/sub linked; Marketing can connect LinkedIn + GA; site footers link correctly; Josh’s personal LinkedIn reflects Tage VC + portfolio with Experience tied to the right Company Pages.
