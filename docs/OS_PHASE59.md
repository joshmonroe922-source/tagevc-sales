# Phase 59 — Practical Production Notifications

Phase 59 ships practical production notifications: in-app inbox completeness,
optional email digests for **critical events only**, owner/assignee routing,
and a basic preference center at `/settings/notifications`. Reliability over
channel expansion. **Not** a full push notification product (`full_push=false`).

## Surface

- Preference center → `/settings/notifications` (extended; Phase 59 panel)
- Activity inbox → `/activity` (critical + owner/assignee groups first)
- Digest API → `POST /api/notifications/digest` (critical email when prefs on)
- Owner/assignee routing via `route_notification_phase59`
- Entity-aware (`ENT-R619` first; `ENT-INDA` when evidence exists)

## Data

Apply `tagevc-os/supabase/phase59_practical_notifications.sql` after Phase 58.

- Extends `os_notification_prefs` with `email_critical_digests`,
  `notify_critical_events`, `notify_owner_assignments`
- `os_notification_delivery_phase59_evidence` — append-only delivery evidence
  (`in_app` / `email_critical` only; `full_push` always false)
- `os_notification_routing_phase59_events` — owner/assignee routing evidence
- `os_notification_inbox_phase59_snapshots` — inbox completeness board
- `os_notification_phase59_ops_alerts` — ops visibility alerts
- `upsert_notification_prefs_phase59` — preference center writes
- `route_notification_phase59` — route + in-app insert + delivery evidence
- `record_notification_delivery_phase59` / `mark_critical_email_delivery_phase59`
- `refresh_notification_inbox_phase59` / `get_practical_notifications_phase59_report`

Safe metadata denylist via `phase59_notifications_safe_detail`.
`os_sha256_hex` uses `search_path = public, extensions`.
Contract: `phase59-v1`.

## App

- `src/lib/notifications/practical-notifications-phase59.ts` — contracts + stubs
- `src/lib/notifications/practical-notifications-phase59-server.ts` — RPC helpers
- Settings prefs form + Phase 59 board client
- Activity inbox groups: critical → owner → mentions → chat → other
- Digest route records critical email delivery evidence (Resend best-effort)

## Verify

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 60 note

**Phase 60 = portfolio operating cadence**. Do not start Phase 60 from this
phase’s notifications workstream without an explicit go-ahead.

## Phase 60+ recommendations

1. Wire live critical events from Shared Services SLA / Marketing overdue /
   Intune inbox aging into `route_notification_phase59`.
2. Attach Marketing SLA digest email for approvers (Phase 58 follow-up).
3. Continue Stage 4e soak; do not drop snapshot retirement tables.
4. Still out of scope here: full mobile push ecosystem, user admin UI,
   portfolio operating cadence (Phase 60).
