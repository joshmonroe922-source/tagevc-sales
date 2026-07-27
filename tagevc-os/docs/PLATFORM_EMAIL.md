# Platform email (Tage OS + subsidiaries)

Reusable outbound email + analytics for **Tage OS** and every subsidiary OS scaffold (Recruit 619, Instant NDA, Signent, future).

## Intent

| Layer | Role |
|-------|------|
| **Microsoft Graph** | Individual + mass send from each user’s connected mailbox (`Mail.Send` / `Mail.ReadWrite`); saves to Sent Items |
| **Tracking pixel + click redirects** | Open/click analytics for Graph sends (`/api/platform-email/mail-tracking`) |
| **Resend** | System mail (digests, intake alerts, auth SMTP) + optional webhook analytics |
| **`entity_id`** | Scopes message history / analytics per company (`ENT-FIRM`, `ENT-R619`, `ENT-INDA`, `ENT-SIGNENT`, …) |

## Provenance (what Josh loved)

1. **My Recruiting Desk** (`/Users/joshmonroe/Recruiting Tools`, live `app.recruit619.com`)
   - Per-user Graph OAuth (`MicrosoftConnectPanel`)
   - Compose + bulk one-to-one (`composeSend`, `bulkEmail`)
   - Pixel/click tracking (`src/lib/email/mailTracking.ts` → `/api/mail-tracking`)
   - Campaign analytics UI (`/bulk-email/[id]`)
2. **Tage VC sales portal** (`tagevc-sales`)
   - Deal tracked email via Graph + `mail-tracking` edge function
   - Resend webhooks → `sales_email_messages` / `sales_email_events`
   - Admin UI `/sales/admin/email`

This module **lifts** that pattern into OS-scoped tables and APIs so Instant NDA / Signent scaffolds get the same spine without copy-paste forks.

## Code map (tagevc-os)

| Path | Purpose |
|------|---------|
| `src/lib/platform-email/mail-tracking.ts` | Inject pixel + wrap links |
| `src/lib/platform-email/types.ts` | Entity-scoped message/event types |
| `src/lib/platform-email/config.ts` | Graph / Resend env helpers |
| `src/app/api/platform-email/mail-tracking/route.ts` | Open GIF + click redirect recorder |
| `supabase/phase_platform_email.sql` | `os_platform_email_messages` / `_events` |

Recruit 619 portal mirrors the same module under `recruit619-portal/src/lib/platform-email/` and `supabase/phase_platform_email.sql`.

## Subsidiary scaffold pattern

When spinning Instant NDA / Signent OS:

1. Copy `src/lib/platform-email/**` + mail-tracking route (or share via package later).
2. Apply `phase_platform_email.sql` on the shared Tage Supabase (entity_id isolates tenants).
3. Set Graph app registration redirect for that portal’s origin.
4. Default `entity_id` on insert (`ENT-INDA`, `ENT-SIGNENT`, …).
5. Wire compose UI to: get Graph token → `injectMailTracking` → `sendMail` → insert message row.

## Env keys

```
NEXT_PUBLIC_APP_URL=
AZURE_TENANT_ID=          # or MS_GRAPH_TENANT_ID
AZURE_CLIENT_ID=          # or MS_GRAPH_CLIENT_ID
AZURE_CLIENT_SECRET=      # or MS_GRAPH_CLIENT_SECRET
MS_GRAPH_REDIRECT_URI=    # optional override
MS_GRAPH_SCOPES=          # default includes Mail.Send Mail.ReadWrite
RESEND_API_KEY=           # system mail
RESEND_WEBHOOK_SECRET=    # optional Resend analytics
SUPABASE_SERVICE_ROLE_KEY=# tracking writes
```

## Apply SQL

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/phase_platform_email.sql
```

## Shipped this pass

- Tracking injectors + `/api/platform-email/mail-tracking` (Tage OS + R619 portal)
- `phase_platform_email.sql` on shared Supabase
- Admin analytics: Tage `/admin/email` (all entities) · R619 `/email/analytics` (ENT-R619)
- Reporting period chips on analytics pages

## Next

- Per-user Graph OAuth connect UI inside OS (Desk already has it on app.recruit619.com)
- Bulk campaign compose UI on portal.recruit619.com (Desk `/bulk-email` remains primary)
- Migrate legacy `sales_email_*` deal mail onto `os_platform_email_*` when ready
