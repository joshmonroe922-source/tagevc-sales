# Website → lead gen spine

**SSOT:** Database Refresh.xlsx · `agent.routing` · deal-flow website intake

## Flow (shipped)

1. Public / partner site posts to `POST /api/deal-flow/website-intake`
2. Creates deal-flow **lead** + idempotent receipt (`phase69`)
3. Best-effort **graph bootstrap** (`bootstrapGraphFromWebsiteLead`):
   - upsert `accounts` by `canonical_domain`
   - upsert `contacts` by email
   - `account_org_links` / `contact_org_links` → org `tage`
   - employment link + `enrichment_jobs` type `agent.routing`
4. Account org-link trigger enqueues `account.bootstrap` for the enrichment worker

## Architecture

```
Website form → OS intake API → deal-flow lead
                           ↘ graph accounts/contacts (spine)
                           ↘ enrichment_jobs (agent.routing + account.bootstrap)
                           ↘ worker mock/live waterfall
```

## Product defaults (approved)

- Default `deal_path` = `launch` when omitted
- Org slug for VC website leads = `tage` (parent)
- Graph failures never fail HTTP intake (soft)
- No Apollo spend until `APOLLO_LIVE=1` + key + budget gate

## Next

- Subsidiary website forms (Signent / INDA / R619) → org slug mapping
- Qualification agent drafts on lead
- CRM UI pages under Shared Services / BD for graph accounts
- Cmd-K search over `search_vector` (C9) — code ready; apply phase109 SQL after review (see `docs/CRM_FULL_TEXT_SEARCH.md`)
