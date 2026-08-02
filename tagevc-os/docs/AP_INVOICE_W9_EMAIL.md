# AP invoice inbox + W-9 campaign (D05)

**Decision:** Auto-create AP vendor when VM vendor becomes **Active**. Entity-specific invoice emails feed the AP portal. W-9 request from vendor profile + annual campaign with AI year check.

## Auto-create AP vendor

When `vm_vendors.status = Active`, bridge creates / upserts an AP vendor (`src/lib/af/ap/vm-bridge.ts` → `ensureApVendorFromVm`). Tax status starts `w9_missing` until a W-9 is filed for the tax year.

## Bootstrap mailboxes (M365 aliases — live now)

Josh configured **send-from aliases** on `joshmonroe@tagevc.com` (tagevc.com). Prefer Microsoft Graph over Resend-only for AP / AR / W-9.

| Workflow | Address | Env |
|----------|---------|-----|
| AP | `accountspayable@tagevc.com` | `M365_ALIAS_AP` |
| AR | `accountsreceivable@tagevc.com` | `M365_ALIAS_AR` |
| W-9 | `w-9@tagevc.com` | `M365_ALIAS_W9` |
| Host | `joshmonroe@tagevc.com` | `M365_HOST_MAILBOX` |

**Permission model:** Delegated `Mail.Send` + `Mail.ReadWrite` on app **Tage VC OS** (`905649ff-1aee-4683-87e0-5d6d2005aea5`). Application Mail.* deferred until true shared mailboxes.

See **`docs/M365_MAIL_SETUP.md`**. Later per-entity: `ap+r619@…` / shared mailboxes when volume requires it.

Inbound webhook seam: `/api/af/ap/inbound-invoice` (routes by To: alias → AP / AR / W-9 queues).

Env: `AP_INBOUND_WEBHOOK_SECRET`, M365_* aliases above, Graph credentials in `.env.example`.

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
