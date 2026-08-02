# Signent HR OS — sales → client → LTV vision

**Entity:** `ENT-SIGNENT` · wholly owned subsidiary of Tage Global  
**Portals:** Operations / firm desk → `https://portal.signenthr.com` · Marketing → `https://www.signenthr.com`  
**Employment:** Hired through Tage OS HR Shared Services; employed by Signent HR (same pattern as Recruit 619 / Instant NDA).  
**Tenancy:** Same Tage HRIS spine; client workforces = `ENT-SIGNENT` + `client_org_id` (empty structure now — no fake clients).

## Two portals inside Signent

| Portal | Who | Job |
|--------|-----|-----|
| **Sales** | Signent sales | Feature menu → quote → submit purchase → invoice → convert lead → client company |
| **Operations** | Signent HR ops | Deliver purchased products, run electronic audits, share findings, propose upsells |

## End-to-end flow (target)

```
Lead (sales)
  → select features / products
  → submit purchase
  → invoice from purchase
  → lead becomes client_org (real UUID)
  → sync PO + products onto client record
  → autofill forms (handbook w/ logo, policies, audit packet)
  → Signent ops completes HR audit electronically
  → results write back to client profile
  → AI draft findings (ops final edit before client share)
  → suggested solutions + pricing proposals (upsell)
  → expand products → higher LTV
```

## How we maximize LTV with AI (plan)

1. **Onboarding completeness score** — AI flags missing handbook sections, missing policies, audit gaps before go-live; ops closes gaps → stickier clients.
2. **Audit → packaged offers** — Every finding maps to a priced Signent service SKU; AI drafts a proposal ops can edit; one-click quote from findings.
3. **Renewal risk radar** — Usage of purchased modules + open audit items + support tickets → early churn risk; sales playbooks triggered.
4. **Expansion moments** — After audit share or handbook publish, AI suggests next product (e.g. screening, manager training, compliance calendar) with ROI copy.
5. **Client health brief** — Weekly ops digest: what’s incomplete, what’s billable, what’s at risk — human-approved before client email.
6. **No fake automation** — Dry-run / stub partners never count as “delivered”; automation health alerts go to Visionary + HR (D07).

## Empty structure now (D02=A)

- SQL: `os_signent_client_orgs` + `client_org_id` on HRIS employees / runs (RLS seams)
- Code: `src/lib/hris/tenancy.ts`, `src/lib/signent/*`
- Do **not** seed demo clients

## Build order (suggested)

1. Client org record + RLS (this pass — empty)
2. Sales feature catalog + purchase → invoice seam
3. Handbook / form autofill from client profile + logo
4. Electronic audit + AI findings draft + ops gate
5. Solution catalog + pricing proposals + LTV dashboard
