# Multi-portal ticketing

**Yes — this architecture makes sense.**

Subsidiary sales platforms (My Recruiting Desk, Instant NDA sales, Signent, etc.) **create tickets**. Tage Portal is the **execution hub** where ops/admin work the queue. Status and public comments sync back (or are at least readable from Tage via `external_url` / sync events). Internal notes stay Tage-only.

```text
┌─────────────────────┐     POST intake      ┌──────────────────────────┐
│ Recruiting Desk /   │ ──────────────────►  │ Tage portal_tickets      │
│ Instant NDA /       │                      │ (queues + assignees)     │
│ Signent / …         │ ◄── sync events ───  │ Technology/Legal/…       │
└─────────────────────┘   (poll/webhook)     └──────────────────────────┘
```

## What’s already in Tage

| Piece | Status |
|-------|--------|
| In-app create + queues + comments | Live (migration `0037`) |
| Storage bucket `ticket-attachments` | Live (`0037`) |
| Page snapshot on create | Live |
| **Manual uploads + paste screenshots** on create & reply | Local (this work) |
| `source_portal` / `entity_id` / sync hooks | Migration `0045` |
| Intake API `portal-ticket-intake` | Scaffolded (deploy when ready) |

## Apply migration

On Supabase `hqmobgtnedmhzipusert` (SQL Editor), after `0044`:

1. `supabase/migrations/0045_portal_tickets_multi_portal.sql`

Adds to `portal_tickets`:

| Column | Purpose |
|--------|---------|
| `source_portal` | `tage` \| `recruit619-desk` \| `instant-nda` \| `signent` \| `other` |
| `entity_id` | FK → `ops_entities` (optional) |
| `created_via` | `portal_ui` \| `subsidiary_api` \| `system` |
| `external_id` / `external_url` | Subsidiary ticket id + deep link |
| `sync_status` | `local_only` \| `pending` \| `synced` \| `error` |
| `last_synced_at` / `sync_error` / `sync_meta` | Sync bookkeeping |

Plus `portal_ticket_sync_events` for outbound status/comment deltas (subsidiaries poll or later webhook).

## Subsidiary sync contract

### Create / upsert ticket → Tage

```http
POST /functions/v1/portal-ticket-intake
Content-Type: application/json
x-ticket-intake-secret: <TICKET_INTAKE_SECRET>
apikey: <anon or service key>
```

```json
{
  "source_portal": "recruit619-desk",
  "external_id": "desk_tkt_abc123",
  "external_url": "https://app.recruit619.com/support/desk_tkt_abc123",
  "entity_slug": "recruit-619",
  "title": "SF AI Match empty for RN job",
  "description": "…",
  "category": "technology",
  "priority": "high",
  "requester_email": "recruiter@recruit619.com",
  "diagnostic_context": {
    "app": "recruit619-desk",
    "path": "/jobs/xyz/ai-match"
  }
}
```

**Response (201 create / 200 update):**

```json
{
  "ok": true,
  "created": true,
  "ticket_id": "uuid",
  "ticket_number": 1042,
  "status": "open",
  "portal_path": "/sales/tickets/<uuid>"
}
```

Idempotent on `(source_portal, external_id)`.

### Status / comments back to subsidiary

1. **Minimum (v1):** store `external_url`; staff open source app from Tage detail; requester sees status in Tage “My tickets” if they have a portal login.
2. **Pull:** subsidiary polls `portal_ticket_sync_events` where `delivery_status = pending` for their tickets (service role or a future signed poll endpoint).
3. **Push (later):** webhook URL per `source_portal` in secrets; deliver events and mark `delivered`.

Public comments (`is_internal = false`) emit sync events. Internal notes do **not**.

### Attachments from subsidiaries

v1 intake is JSON metadata only. Subsidiaries can:

- Put screenshot URLs in `description` / `diagnostic_context`, or
- Follow-up: multipart upload endpoint (reuse `ticket-attachments` bucket via service role).

Tage UI already uploads to the same bucket on create + reply (paste-friendly).

## Wire stubs (subsidiary apps)

### My Recruiting Desk (`app.recruit619.com`)

Suggested later (not built in Desk yet):

1. **Help / Report issue** → POST intake with `source_portal: recruit619-desk`.
2. Env: `TAGE_TICKET_INTAKE_URL`, `TAGE_TICKET_INTAKE_SECRET`.
3. Show returned `#ticket_number` + link to `https://portal.tagevc.com{portal_path}` when user has SSO.

### Instant NDA sales

Same pattern with `source_portal: instant-nda`, `entity_slug: instant-nda`.

### Signent

`source_portal: signent`, `entity_slug` matching `ops_entities`.

## Deploy checklist (when Josh batches)

1. Apply `0045` in Supabase SQL Editor.
2. Set secret: `TICKET_INTAKE_SECRET` (and optional `TICKET_SYSTEM_USER_EMAIL`).
3. `supabase functions deploy portal-ticket-intake --project-ref hqmobgtnedmhzipusert`
4. Frontend: include in next Tage batch (`npm run deploy`) after local verify — **not auto-deployed with this change**.

## Local dogfood (Tage)

```bash
export PATH="/Users/joshmonroe/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/joshmonroe/Projects/tagevc-sales
npm run dev
```

1. Create ticket → paste screenshot into description → choose files → submit.
2. On ticket detail → reply with paste/upload.
3. Confirm attachments open via signed URL.

Until `0045` is applied, new multi-portal columns are ignored by older DBs; create may error if the client sends `source_portal` before migration — apply `0045` before dogfooding this branch against prod Supabase.

## Related

- `SETUP_TICKETS.md` — in-portal helpdesk UX
- `SETUP_PORTFOLIO_ENTITIES.md` — `ops_entities` / entity shells
- `SETUP_RECRUIT619.md` — Desk SSO into portal
