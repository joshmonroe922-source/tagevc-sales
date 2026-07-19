# Portal ticketing (in-app helpdesk)

In-portal ticketing for shared services — **not** Zendesk. Patterned after Linear/Jira workflows, implemented inside the Tage VC portal.

## Linear / Jira concept map

| Concept | Linear / Jira | Tage portal tickets |
|---------|---------------|---------------------|
| Issue / ticket | Issue, ticket | `portal_tickets` (`#1001`…) |
| Team / project | Team, project board | **Queue category** (`technology`, `legal`, `accounting-finance`, `marketing`, `human-resources`, `admin`) |
| Workflow | Status / workflow | `open` → `in_progress` → `waiting` → `resolved` → `closed` |
| Priority | Priority | `low` / `normal` / `high` / `urgent` |
| Assignee | Assignee | `assignee_id` → `sales_users` |
| Comments | Comments | `portal_ticket_comments` (+ optional internal notes) |
| Attachments | Attachments | `portal_ticket_attachments` + `ticket-attachments` storage |
| Diagnostics | Labels / custom fields | `diagnostic_context` JSON + silent **page snapshot** |
| Inbox | Team inbox / board | Area queues under each portal + `/sales/admin/tickets` |
| My issues | My issues | `/sales/tickets` |
| Notifications | Slack / email / in-app | Unread badges + optional Resend email (`portal-ticket-notify`) |

Stub for later: external Zendesk/Jira sync is **not** built — keep IDs/`diagnostic_context` self-contained so an integration can attach later.

## Product goal

Anyone in the portal can **create a ticket** with enough context to diagnose (route, user, viewport, page snapshot). Shared-services owners **manage their queue** (list, assign, priority, status, comments). Josh/admins see a central inbox.

## Architecture

| Surface | Path | Who |
|---------|------|-----|
| **Create ticket** | Header → Create ticket (any page) | All portal users |
| **My tickets** | `/sales/tickets` | Creator or assignee |
| **Ticket detail** | `/sales/tickets/:id` | Same RLS as ticket |
| **Technology queue** | `/sales/technology/tickets` | Technology portal (+ creator of own) |
| **Legal queue** | `/sales/legal/tickets` | Legal portal |
| **Finance queue** | `/sales/finance/tickets` | Accounting-Finance portal |
| **Marketing queue** | `/sales/marketing/tickets` | Marketing portal |
| **HR queue** | `/sales/hr/tickets` | Human Resources portal |
| **Admin / general** | `/sales/admin/tickets` | Admins (central + `admin` category) |

Does **not** touch Recruiting Tools / TalentDesk entity embed routes.

## Apply database migration

Run on Supabase project `hqmobgtnedmhzipusert` (SQL Editor or `supabase db push`):

1. `supabase/migrations/0037_portal_tickets.sql`

Creates:

| Object | Purpose |
|--------|---------|
| `portal_tickets` | Tickets + workflow + diagnostic JSON + unread flags |
| `portal_ticket_comments` | Thread (+ `is_internal` for queue-only notes) |
| `portal_ticket_attachments` | Metadata for screenshots/uploads |
| `ticket-attachments` bucket | Private storage (50MB) |
| `mark_portal_ticket_read` | Clears unread for viewer |
| `user_can_manage_ticket_category` / `user_can_view_ticket` | RLS helpers |

**RLS:** creators see own; assignees see assigned; portal assignees (or admins) manage their category queue; `admin` category is admin-managed; Josh (`role = admin`) sees all.

## Deploy edge function (email soft alerts)

```bash
supabase functions deploy portal-ticket-notify --project-ref hqmobgtnedmhzipusert
```

Requires existing secrets: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`. Optional: `PUBLIC_APP_URL` (ticket deep links in email).

Email is best-effort — if Resend is unset, in-app unread badges still work.

## How to create a ticket

1. From any portal page, click **Create ticket** in the header (or a queue page’s Create button).
2. Enter title + description; choose **Queue** and **Priority**.
3. Submit — the app **silently** captures:
   - URL / route, page title, portal slug
   - User id + email, timestamp
   - User agent + viewport size
   - A **screenshot of the current portal browser tab** (`html2canvas` of `.sales-shell`) attached as `page_snapshot`
4. You land on `/sales/tickets/:id`. Track status under **My tickets**; area owners work the queue under their portal **Tickets** nav.

No “we are recording you” modal. Capture is tab-only — not OS desktop / other apps.

## What gets auto-attached

| Attached | Source |
|----------|--------|
| Diagnostic JSON (`diagnostic_context`) | Always on create |
| Page snapshot PNG | Best-effort `html2canvas` of the portal shell; skipped if capture fails |
| Manual uploads | Optional from ticket detail |

Admins and queue managers open snapshots like any attachment (signed URL).

### Manual uploads & paste (create + reply)

- Create ticket modal: dropzone, file picker, and **clipboard paste** (screenshots) on the description field / dropzone.
- Ticket detail: same on reply; plus classic “Attach file” for the ticket itself.
- Stored in `ticket-attachments` via `uploadTicketAttachment` (same as page snapshots).

## Alerting (keep soft)

- **Unread badges** on My tickets / header when assignee or creator has unread activity
- **Open counts** via queue list filters (Open / active)
- **Email** via `portal-ticket-notify` on create / assign / comment (Resend)
- Optional later: push assignee item into Microsoft To Do — not required for v1

## Assign portal access

Admin → **Assignments** (`/sales/admin/portals`) → grant Technology / Legal / Accounting and Finance / Marketing / Human Resources so those users manage the matching queues.

## Related docs

- **Multi-portal / subsidiary sync:** [`docs/TICKETING_MULTI_PORTAL.md`](./docs/TICKETING_MULTI_PORTAL.md)
- Shared-services portals: `SETUP_TECHNOLOGY.md`, `SETUP_LEGAL.md`, `SETUP_FINANCE.md`, `SETUP_MARKETING.md`, `SETUP_HR.md`
- Email: `SETUP_EMAIL.md`
