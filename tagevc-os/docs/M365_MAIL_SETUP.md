# M365 mail setup — Tage OS (bootstrap aliases)

## Does Josh’s alias plan work?

**Yes for bootstrap.** Aliases on `joshmonroe@tagevc.com` with send-from-aliases enabled work if:

1. Graph sends with the correct **From** alias (and send-as rights).
2. Inbound routing uses **To:** (or headers) to send W-9 vs AP vs AR into the right OS queues.

**Caveat:** all three land in Josh’s inbox — fine now; later prefer shared mailboxes / per-entity aliases when volume grows.

## Live bootstrap addresses (tagevc.com)

| Workflow | SMTP address | Env var |
|----------|--------------|---------|
| AP (vendor invoices) | `accountspayable@tagevc.com` | `M365_ALIAS_AP` |
| AR (customer invoices) | `accountsreceivable@tagevc.com` | `M365_ALIAS_AR` |
| W-9 | `w-9@tagevc.com` | `M365_ALIAS_W9` |
| Host mailbox | `joshmonroe@tagevc.com` | `M365_HOST_MAILBOX` |

Confirm exact W-9 spelling in M365 admin if send fails (`w-9@` vs `w9@`). Code accepts both local-parts on inbound.

## App registration (reuse)

| Field | Value |
|-------|-------|
| App name | **Tage VC OS** |
| Application (client) ID | `905649ff-1aee-4683-87e0-5d6d2005aea5` |
| Directory (tenant) ID | `aecc0efa-a429-4b4f-8c77-c2957b8263ab` (Tage Venture Capital / `tagevc.com`) |
| Object ID | `3423e515-ef79-48eb-a6cb-18aa2e83fcb9` |
| Graph mail scopes | **Delegated** `Mail.Send` + `Mail.ReadWrite` (2026-08-02) **and Application** `Mail.Send` + `Mail.ReadWrite` (2026-08-10) — admin consent granted for Tage Venture Capital on both |
| Existing secrets | `Tage OS Graph`, `Tage VC OS Supabase`, `supabase` (hints only; never commit secret values) |

### Permission model (what we have)

| Permission | Type | Why |
|------------|------|-----|
| `Mail.Send` | Delegated | Send as signed-in user / From=alias |
| `Mail.ReadWrite` | Delegated | Ingest AP/AR/W-9 replies from host mailbox |
| `Mail.Send` | **Application** | Unattended system sends (joiner invites, AP/AR/W-9, notifications) from a mailbox nobody is signed into |
| `Mail.ReadWrite` | **Application** | Unattended mailbox read/write, incl. writing straight into a tenant Inbox |
| Existing | `openid` `profile` `email` `offline_access` `User.Read` | Sign-in |

Application `Mail.Send` + `Mail.ReadWrite` were admin-consented **2026-08-10** and are in
use — `sendPlatformEmail({ channel: 'system' })` sends app-only through Graph. They reach
*any* mailbox in the tenant, so scope them with an [Exchange application access
policy](https://learn.microsoft.com/en-us/graph/auth-limit-mailbox-access) when the
mailbox set grows. Delegated scopes remain for user-attributed sends.

Full inventory and live verification: **`docs/ENTRA_GRAPH_PERMISSIONS.md`**.

### Env vars (Vercel / `.env.local` — no secrets in git)

```bash
AZURE_TENANT_ID=          # or MS_GRAPH_TENANT_ID
AZURE_CLIENT_ID=905649ff-1aee-4683-87e0-5d6d2005aea5
AZURE_CLIENT_SECRET=      # paste from Certificates & secrets — never commit
MS_GRAPH_CLIENT_ID=905649ff-1aee-4683-87e0-5d6d2005aea5
MS_GRAPH_CLIENT_SECRET=   # same secret if used by worker
MS_GRAPH_SCOPES=openid offline_access User.Read Mail.ReadWrite Mail.Send

M365_HOST_MAILBOX=joshmonroe@tagevc.com
M365_ALIAS_AP=accountspayable@tagevc.com
M365_ALIAS_AR=accountsreceivable@tagevc.com
M365_ALIAS_W9=w-9@tagevc.com
```

## Josh clicks (checklist)

1. ~~**API permissions** — ensure Mail.Send + Mail.ReadWrite listed.~~ Done — Delegated and Application both present.
2. ~~**Grant admin consent for Tage Venture Capital**.~~ Done 2026-08-10.
3. **Certificates & secrets** — if `Tage OS Graph` secret is lost, create a new client secret and paste into Vercel only (agent cannot read secret values).
4. Confirm aliases exist: AP / AR / W-9 on `joshmonroe@tagevc.com`, send-as enabled.
5. **Test send:** OS system send From=`accountspayable@tagevc.com` to Josh; confirm lands in Sent + inbox filters.

## Code map

- Alias routing: `src/lib/platform-email/m365-aliases.ts`
- Policy: `src/lib/platform-email/policy.ts`
- Send orchestrator: `src/lib/platform-email/send.ts`
- AP inbox parse: `src/lib/af/ap/invoice-inbox.ts`
