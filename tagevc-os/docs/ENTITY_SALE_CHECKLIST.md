# Entity sale checklist

Hand the buyer a box, not a slice of a monorepo. Shared Tage Supabase is an operator shortcut **until a sale is real**. Do not rewrite the UDL “just in case.”

Use with [ENTITY_REPO_ARCHITECTURE.md](./ENTITY_REPO_ARCHITECTURE.md).

## In the box

- That company’s GitHub repo(s): website + portal (+ Instant NDA consumer app if selling Instant)
- That company’s Vercel project(s) and DNS (apex + `portal.` + Instant `app.`)
- That company’s vendor accounts and env: Stripe, Resend, Dialpad, Gusto, DocuSign, App Store / Play if any
- An export of **only** that `entity_id` (`ENT-R619` / `ENT-SIGNENT` / `ENT-INDA`) — or a dedicated Supabase the portal already used
- Azure / Entra app registration (or a new one) whose redirect URLs are only that company’s domains

## Not in the box

- `tagevc-sales` / `tagevc-os` source
- Sister-brand marketing copy and email-signature catalogs
- Other entities’ rows, Storage objects, or API keys
- Firm-wide service-role URL for the shared Tage project

## Cutover (when a sale is signed)

1. **Freeze** writes for that `entity_id` (maintenance window; disable website intake and portal mutations).
2. **Export** Postgres rows, Storage objects, and Auth users scoped to that entity / org slug (`recruit619`, `signent`, `inda` / Instant orgs).
3. **Stand up** the buyer’s Supabase (or transfer a pre-split project). Restore the export. Point the portal `.env` at the new URL/keys.
4. **Rewire** Vercel env, Resend domain, Stripe webhook, DocuSign Connect, Dialpad, Gusto company UUID.
5. **Auth:** new Azure redirect allowlist; remove `https://app.tagevc.com` as Site URL for that product.
6. **Revoke** Tage service-role, old anon keys, and that entity’s rows in Tage-only vendor bindings (`os_ies_company_map`, Gusto, Dialpad) if the buyer will not stay on Tage shared services.
7. **Strip** `app.tagevc.com` deep links (finance, documents, messaging, screening) or replace them with the buyer’s tools.
8. **DNS** transfer. Confirm the old Vercel git connection is this entity’s repo only (root `.`, not a sibling brand folder).

## If Tage still provides shared services after close

That is a **vendor contract**: API keys, a bill, and no git access to `tagevc-sales`. Bindings stay `entity_id`-scoped. Do not leave a service-role key in the buyer’s Vercel.

## Export query sketch (operator)

Run from Tage with the selling `entity_id` bound. Prefer a dedicated export script when one exists; until then, dump by `entity_id` / `org_id` / `portal_key`:

```sql
-- Inventory only — do not paste a full dump into git.
-- Replace :eid with ENT-R619 | ENT-SIGNENT | ENT-INDA
select table_schema, table_name
from information_schema.columns
where column_name in ('entity_id', 'entity_os')
  and table_schema not in ('pg_catalog', 'information_schema')
group by 1, 2
order by 1, 2;
```

Then `COPY` / `pg_dump --data-only` those tables with `WHERE entity_id = :eid` (and org-scoped CRM tables via `organizations.slug`). Storage: list buckets used by that portal (`os-think-tank`, docs) and copy prefixes for that entity / `portal_key`.

## After close (Tage copy)

Keep firm reporting history only if the purchase agreement allows. Otherwise delete or anonymize that `entity_id` in the holding UDL after the buyer confirms restore.
