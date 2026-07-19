# Recruit 619 — KPI hierarchy

**Recruiter → Manager → Location → Region → COO**

Sandbox / local scaffold. Do **not** deploy production until Josh asks.

## KPI pack (confirmed)

| Key | Label | Date basis |
|-----|-------|------------|
| `send_outs` | Send outs / submittals | Activity (submittal date) |
| `interviews` | Interviews | Activity (app stage INTERVIEW/OFFER) |
| `job_board_applies` | Job board applies / ATS pipeline | Activity (early-stage apps; SF job-board sync later) |
| `placements` | Placements / starts | **Placement date** |
| `send_outs_per_placement` | Send outs per placement | Derived |
| `placement_conversion_pct` | Send-out → placement % | Derived |
| `interview_to_placement_pct` | Interview → placement % | Derived |
| `revenue` | Revenue | **Placement date** = revenue month |
| `commissions_earned` | Commissions earned | **Placement date** |
| `commissions_paid` | Commissions paid | **Commission paid date** (typically following month) |
| `time_to_fill_days` | Time to fill (avg days) | Placement window |

Aligned with portal `entity_kpi_templates` for `recruit-619` (migration `0044`) and TalentDesk `RECRUITING_KPI_CATALOG`.

### Date semantics

- **Revenue month** = calendar month of `placementDate` (fallback `startDate` → `createdAt`)
- **Commission earned** = same month as placement date
- **Commission paid** = month of `commissionPaidDate` (default suggestion: 1st of following month)

## Where Manager / Location / Region were added

### TalentDesk (`/Users/joshmonroe/Recruiting Tools`) — live rollups

| Dimension | Where |
|-----------|--------|
| **Manager** | Existing `ManagerAssignment` (manager ↔ recruiter). Role `manager` / `admin` / `coo`. |
| **Location** | New `OrgLocation` + `User.locationId` |
| **Region** | New `OrgRegion`; `OrgLocation.regionId` |
| **COO** | Role `coo` or `admin` → company-wide rollup |
| Placement dates | `Placement.placementDate`, `commissionAmount`, `commissionPaidDate`, `hireType`, `splitPct` |

Seed sample West/East + SD/LA/NYC:

```bash
cd "/Users/joshmonroe/Recruiting Tools"
npx prisma db push   # local sandbox schema
npx tsx scripts/seed-org-hierarchy.ts
# Then assign User.locationId and ManagerAssignment rows
```

UI: **Grow → KPI Hierarchy** (`/hierarchy`). Manager team view remains at `/team`.

### Tage portal (`tagevc-sales`) — COO mirror + seeding

Migration `0044_recruit619_kpi_hierarchy.sql`:

| Table | Purpose |
|-------|---------|
| `recruiting_regions` | Region dimension per entity |
| `recruiting_locations` | Location → Region |
| `recruiting_org_members` | Recruiter/manager/coo + manager + location |
| `recruiting_kpi_facts` | Monthly per-recruiter facts (manual / future sync) |

UI: Manage Portfolio → Recruit 619 → **KPIs** → “Recruiter KPI hierarchy” panel (SSO to TalentDesk `/hierarchy`).

### Salesforce (Setup clicks — not auto-deployed)

No SFDX metadata deploy in this stack (jsforce describe only). Create in **sandbox** first:

#### User fields

| API name | Type | Notes |
|----------|------|--------|
| `ManagerId` | Lookup(User) | Standard — use if not already populated |
| `Recruiting_Location__c` | Lookup(`Recruiting_Location__c`) or Text | Org location |
| `Recruiting_Region__c` | Formula or Lookup | Or derive from Location |

#### Custom objects (recommended)

| Object | Fields |
|--------|--------|
| `Recruiting_Region__c` | `Name`, `Code__c` |
| `Recruiting_Location__c` | `Name`, `Code__c`, `Region__c` (Lookup Region) |

#### Placement / commission (on existing Placement object — confirm API name via describe)

| Field | Type | Semantics |
|-------|------|-----------|
| `Placement_Date__c` / Start Date | Date | **Revenue month** |
| `Commission_Amount__c` | Currency | Earned amount |
| `Commission_Paid_Date__c` | Date | **Paid month** |
| `Hire_Type__c` | Picklist | permanent / contract / C2H / temp (report packs) |
| Recruiter + split % | Existing split fields | Keep; map to local `splitPct` |

Probe script (run locally with SF creds):

```bash
cd "/Users/joshmonroe/Recruiting Tools"
npx tsx scripts/sf-probe-kpi-hierarchy.ts
```

## How rollups work

```text
Per recruiter monthly facts
        │
        ├─ Manager rollup = Σ assigned recruiters
        ├─ Location rollup = Σ users with that locationId
        ├─ Region rollup   = Σ locations in region
        └─ COO rollup      = Σ all recruiters / regions
```

Ratios (`send_outs_per_placement`, conversion %) are recomputed from summed counts (not averaged). Time-to-fill averages across recruiters with samples.

## What’s live in sandbox vs needs SF Setup

| Piece | Status |
|-------|--------|
| TalentDesk schema + `/hierarchy` + catalog | **Code ready** — needs local `prisma db push` + seed |
| Portal migration 0044 + KPI page hierarchy | **Code ready** — apply migration to **local/staging** Supabase only |
| Entity KPI template expansion | In migration 0044 |
| SF Manager / Location / Region fields | **Setup clicks** in SF sandbox |
| SF reports / folders | Spec below — create manually |
| Production TalentDesk / portal deploy | **Do not** until Josh says |
| Fact sync TalentDesk → portal | Not built (manual facts or future job) |

## Salesforce report specs (manual)

Folder: `Recruit 619 / KPI Hierarchy`

| Report | Type | Group by | Filters |
|--------|------|----------|---------|
| Recruiter KPIs — Month | Placement + Submittal summary | Recruiter, Placement Month | Status = Confirmed |
| Manager Rollup | Same | Manager → Recruiter | — |
| Location Rollup | Same | Location → Recruiter | — |
| Region Rollup | Same | Region → Location | — |
| COO Company | Same | (none) / Region | — |
| Commissions Earned vs Paid | Placement | Placement Month vs Paid Month | — |
| Hire Type Pack | Placement | Hire Type → Recruiter | Clone per hire type; share up hierarchy |

Share reports: Recruiter (own), Manager (team), Location lead, Region lead, COO (all).

## Deploy batch later

When Josh green-lights:

1. **SF sandbox** — create Location/Region objects + User/Placement fields; build report folder
2. **TalentDesk preview** — `prisma migrate`/`db push` + deploy preview (not prod `app.recruit619.com` until confirmed)
3. **Portal staging** — apply `0044`, verify Recruit 619 KPIs tab
4. **Prod** — only after sandbox sign-off (SF fields + TalentDesk + portal together)

## Related docs

- [SETUP_RECRUIT619.md](../../SETUP_RECRUIT619.md)
- [PHASE1_INTEGRATION.md](./PHASE1_INTEGRATION.md)
- [SETUP_PORTFOLIO_ENTITIES.md](../../SETUP_PORTFOLIO_ENTITIES.md)
- TalentDesk: `docs/SALESFORCE_SCHEMA.md`, `docs/KPI_HIERARCHY.md`
