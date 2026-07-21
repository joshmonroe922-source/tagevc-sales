# DocuSign Integration — Architecture (Phase 21)

**Status:** Live JWT send + Connect webhook · hub under Shared Services · Legal.  
**Fallback:** Mock `ENV-…` envelopes when JWT env is incomplete.

## Placement

| Layer | Location |
|-------|----------|
| Product hub | `/shared-services/legal/docusign` |
| Documents send | `sendDocumentViaDocuSign` → Documents UI |
| JWT / envelopes | `tagevc-os/src/lib/docusign/{config,jwt,envelopes,send}.ts` |
| Connect parse | `lib/docusign/connect.ts` |
| Events | `lib/docusign/events-repo.ts` → `os_docusign_events` |
| Webhook | `POST /api/docusign/webhook` |
| SQL | `phase20_docusign_events.sql` + `phase21_shared_services.sql` |

## Flow

```mermaid
sequenceDiagram
  participant UI as Documents UI
  participant App as OS server
  participant DS as DocuSign API
  participant WH as Connect webhook
  participant DB as Postgres

  UI->>App: sendDocumentAction(doc_id)
  App->>App: capital gate + entity scope
  alt JWT configured
    App->>DS: JWT + Envelopes:create
    DS-->>App: envelope_id
  else mock
    App->>App: mint ENV-…
  end
  App->>DB: doc status + os_docusign_events
  WH->>App: Connect event
  App->>DB: os_docusign_events + document status
```

## Env matrix

| Variable | Purpose |
|----------|---------|
| `DOCUSIGN_INTEGRATION_KEY` | Integration key |
| `DOCUSIGN_USER_ID` | Impersonated user GUID |
| `DOCUSIGN_ACCOUNT_ID` | Account |
| `DOCUSIGN_PRIVATE_KEY` | JWT RSA private key (PEM; `\n` ok) |
| `DOCUSIGN_OAUTH_HOST` | Default `account-d.docusign.com` |
| `DOCUSIGN_BASE_PATH` | Default `https://demo.docusign.net` |
| `DOCUSIGN_WEBHOOK_SECRET` | Custom header `x-tagevc-webhook-secret` |
| `DOCUSIGN_CONNECT_HMAC_SECRET` | Optional `X-DocuSign-Signature-1` HMAC |
| `DOCUSIGN_VOID_POLICY` | `allow` / `warn_capital` / `block_capital` |

## Webhook payloads

1. **Mock / simple:** `{ "envelope_id": "…", "status": "completed" }`  
2. **Connect JSON:** `{ "event": "envelope-completed", "data": { "envelopeId": "…", "envelopeSummary": { "status": "completed" } } }`

Unknown envelopes are acknowledged and still logged to `os_docusign_events`.

## Permissions

| Action | Permission |
|--------|------------|
| Send non-capital | `write:documents` |
| Send capital | `action:docusign_capital` |
| View hub / events | `read:documents` |

## Phase 24–32 storage & workflows

- Hub: role-map send, **live refresh roles**, void (reason + policy + audit), CoC email, reminders.  
- Independent live/event filters plus subject, recipient, and identifier search.
- Void policy: `DOCUSIGN_VOID_POLICY=allow|warn_capital|block_capital`.  
- Live 30-day envelope status table with management filters.
- Void preflight + irreversible confirmation; replacement envelopes record source lineage.
- Advanced errors expose safe HTTP/code/trace diagnostics.
- Recipient routing status appears in the live envelope list.
- Void intent is written before the irreversible API call; replacement lineage
  is recorded in both directions with actor metadata.
- Template search shows description and cache freshness.
- Apply through `phase29_paid_media_warranty.sql`.  

## Phase 33

- Live envelopes expose typed total/start/next/previous pagination.
- Cached templates use database search and paging; API synchronization follows
  continuation pages with bounded completeness reporting.
- Hub links preserve unrelated filter state and use independent page keys.
- Replacement sends support all cached template roles with validated email,
  unique-role, and capital-permission gates.
- `os_docusign_envelope_lineage` records intent before send, rejects duplicate
  active source replacements, and preserves request, source context, actor,
  role map, failure, and replacement identifiers.

SQL: `phase33_docusign_lineage.sql`.

## Phase 34

- `os_docusign_envelopes` is an entity-scoped projection of provider envelope,
  local document, event, and replacement-lineage evidence.
- Bounded manual and 30-minute reconciliation runs use exact identifiers only.
  Ambiguous duplicate mappings and status drift are marked for review; the
  worker never sends, voids, reassigns, or changes recipients.
- The hub shows reconciliation state, issue codes, run counts, and limits
  subsidiary users to projection-mapped envelopes and entity-scoped events and
  signed files.
- Connect/application event fallback IDs are deterministic payload hashes, so
  duplicate deliveries are accepted without duplicate side effects.

SQL: `phase34_docusign_reconciliation.sql`.

## Phase 35

- Document and template sends now persist a durable request intent before the
  provider call.
- Stable DocuSign transaction IDs and hidden intent/entity fields prevent blind
  resends after timeouts.
- Envelope projection, document state, send audit, and intent finalization commit
  atomically.
- A five-minute worker reconciles unknown outcomes by exact transaction ID and
  never creates an envelope.
- The hub exposes send state, dispatch/recovery attempts, and safe errors under
  entity scope.

SQL: `phase35_docusign_transactional_send.sql`.

## Phase 36

- Finalized request replay returns the existing envelope without another send.
- Replacement sends now use durable intents, stable transaction IDs, hidden
  evidence fields, and the same recovery path as document/template sends.
- Recovery checks hidden intent/entity/operation/document fields before
  finalization; ambiguity enters manual review and is never resent.
- Stale prepared and exhausted recovery states are materialized by a sweep.
- Broad reconciliation gives intent evidence precedence and records truncation
  and mapping conflicts.
- The hub exposes recovery disposition, candidate envelope, and manual-review
  reason.

SQL: `phase36_docusign_send_hardening.sql`.

## Phase 37

- Manual-review intents can be proposed for one evidence-matched candidate or
  local closure without resend authorization.
- A different authorized actor must re-fetch matching provider evidence and
  approve within 30 minutes.
- Candidate binding, projection/document updates, replacement lineage, intent
  finalization, and lifecycle events commit atomically.
- Dispatched ambiguous sends remain permanent resend tombstones.
- New template envelopes carry transaction and document evidence fields.

SQL: `phase37_docusign_manual_review.sql`.

## Still deferred

- Dedicated recipient detail drawer
- Transactional leased reconciliation page commits
- Idempotent signed-archive metadata with content hashes
- Retire simulate button in production  

