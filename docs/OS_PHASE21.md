# Tage VC Operating System — Phase 21

**Real DocuSign (JWT + Connect) · IT assets CRUD · Stage 4c/4e tooling (no DROP).**

## What shipped

### DocuSign Integration (primary)
| Area | Status |
|------|--------|
| JWT auth (`lib/docusign/jwt.ts`) | Done — RS256 via Node crypto |
| Envelope create (`lib/docusign/envelopes.ts`) | Done |
| Send path uses live API when env set | Done — else mock `ENV-…` |
| Connect webhook parser + HMAC option | Done — `/api/docusign/webhook` |
| `os_docusign_events` insert on send + Connect | Done |
| Entity / deal / ticket linking on events | Done — from document refs |
| Hub UI (status + recent events) | Done — `/shared-services/legal/docusign` |
| Capital gate preserved | Done — `action:docusign_capital` |

**Env (live mode):** `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_PRIVATE_KEY`, optional `DOCUSIGN_OAUTH_HOST`, `DOCUSIGN_BASE_PATH`, `DOCUSIGN_WEBHOOK_SECRET` and/or `DOCUSIGN_CONNECT_HMAC_SECRET`.

### Snapshot retirement
| Area | Status |
|------|--------|
| Stage 4c — `loadStoreSnapshot` skips table when SQL-only | Done |
| Empty-snapshot drill adds `sql_only_hydrate` check | Done |
| Archive export retention metadata + process record | Done |
| `ARCHIVE_EXPORT_CONFIRMED_AT` for Stage 4e checklist | Done |
| Stage 4e DROP | **Not done** (deferred; checklist never auto-ready) |

### IT Assets / Licensing
| Area | Status |
|------|--------|
| Hardware CRUD + assign/return | Done |
| Software licenses + seat grant/revoke | Done |
| Assignment event history | Done |
| Permissions `read:it_assets` / `write:it_assets` | Done |
| Hub UI | Done — `/shared-services/it/assets` |
| Onboarding/offboarding automation | Out of scope |

### SQL
Apply **`tagevc-os/supabase/phase21_shared_services.sql`** (includes DocuSign extensions + ensures IT tables). Safe if Phase 20 already applied.

## Ops checklist after deploy

1. Apply Phase 21 SQL in Supabase.  
2. (Optional) Set DocuSign JWT env on Vercel; configure Connect → `https://app.tagevc.com/api/docusign/webhook`.  
3. Shared Services → DocuSign: confirm mode Mock vs Live; send a test doc.  
4. Shared Services → IT Assets: create a laptop + license; assign / grant seat.  
5. Admin → Normalization: run drills; export archive; after offsite store set `ARCHIVE_EXPORT_CONFIRMED_AT`.

## Out of scope (unchanged)

- Full IT onboarding/offboarding automation  
- Advanced DocuSign workflows (templates library sync, reminders UI)  
- Dropping `os_store_snapshots`  
- Push notifications · user admin UI  

## Phase 22+ recommendations

1. **DocuSign:** Pull signed PDFs into entity `07_Signed`; template IDs; void/remind; retire simulate button in production when Connect is stable.  
2. **IT assets:** Offboarding checklist from tickets/HR; renewal digests; entity-scoped list filters parity with pipeline hide mode.  
3. **Stage 4e:** After ≥90-day archive retention + confirmed soak, explicit DROP of `os_store_snapshots` (manual SQL + feature flag).  
4. **Stability:** Push notifications; richer user admin; null-entity RLS parity.  
