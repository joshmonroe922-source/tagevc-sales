# AP invoice inbox + W-9 campaign (D05)

**Decision:** Auto-create AP vendor when VM vendor becomes **Active**. Entity-specific invoice emails feed the AP portal. W-9 request from vendor profile + annual campaign with AI year check.

## Auto-create AP vendor

When `vm_vendors.status = Active`, bridge creates / upserts an AP vendor (`src/lib/af/ap/vm-bridge.ts` → `ensureApVendorFromVm`). Tax status starts `w9_missing` until a W-9 is filed for the tax year.

## Entity invoice inboxes (Josh creates DNS / mail)

We **do not invent mailbox credentials**. Prefer inbound parse (Resend Inbound, Postmark Inbound, or Google Group → webhook).

Suggested addresses (pick one scheme and stick to it):

| Entity | Suggested inbox |
|--------|-----------------|
| Tage VC (`TVC` / `ENT-FIRM`) | `ap+tvc@tagevc.com` or `invoices@tagevc.com` |
| Recruit 619 | `ap+r619@tagevc.com` or `invoices@recruit619.com` |
| Signent HR | `ap+signent@tagevc.com` or `invoices@signenthr.com` |
| Instant NDA | `ap+inda@tagevc.com` or `invoices@instantnda.us` |

Inbound webhook seam: `/api/af/ap/inbound-invoice` (parses entity from `+tag` or domain → creates one-time / recurring bill draft in AP portal for approval/pay).

Env placeholders: `AP_INBOUND_WEBHOOK_SECRET`, `AP_INVOICE_FROM_DOMAIN`, optional per-entity overrides in `.env.example`.

## W-9 request

1. Vendor profile button → preformatted email asking for current tax-year W-9.
2. Reply / upload → file library on vendor record → mark `w9_year` complete.
3. AI review seam checks tax year on PDF; exceptions queue for AP.

Annual campaign:

- Master outstanding W-9 list (AP)
- Bulk send from list
- Weekly reminders until complete
- Tasks created per vendor/year

Code: `src/lib/af/ap/w9-campaign.ts`, `invoice-inbox.ts` · SQL: `supabase/phase92_ap_w9_invoice_spine.sql`.

## Forecasting shells

Expense timeline / expense forecasting / cash-flow views under A&F Finance — extend existing forecast page with AP-driven expense series (`src/lib/af/ap/expense-forecast.ts`).

## Honest limits this pass

- Mailboxes and DNS are **Josh-owned**.
- Inbound parse needs a real provider webhook secret.
- AI W-9 year check is a seam (prompt + exception status) until document AI is wired live.
