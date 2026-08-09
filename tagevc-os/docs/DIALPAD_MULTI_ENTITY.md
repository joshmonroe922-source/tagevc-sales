# Dialpad multi-entity model (one company · many offices)

**Status (2026-08-08):** Company API key **configured** (name `Tage OS spine (Engage)`, expiry **Never**, last4 `nuFF`). Stored in local `.env.local` + Vercel **Production/Preview** as `DIALPAD_API_KEY`. `DIALPAD_WEBHOOK_SECRET` set same targets. Office bindings upserted. Event subscriptions registered → spine webhook. Smoke green → **`DIALPAD_LIVE=1`** (Prod + Preview + local); Engage badge shows **Dialpad LIVE**.

**Related:** `docs/PARTNER_SPINE.md` · `docs/DIALPAD_ORG_HIERARCHY.md` (coaching) · Engage: `/shared-services/marketing/engage` · contrast payroll: `docs/GUSTO_MULTI_ENTITY.md`.

## Model

| Layer | Choice |
|-------|--------|
| Company | **One** Dialpad company: Tage Venture Capital |
| Entities | Subsidiaries = **offices** under that company (not separate Dialpad companies) |
| Secrets | `DIALPAD_API_KEY`, `DIALPAD_WEBHOOK_SECRET`, `DIALPAD_LIVE` in env / Vercel only — never in `os_partner_entity_bindings.config` |
| Bindings | Non-secret `office_id` (+ main DID) per `entity_id` in partner bindings |
| Live gate | Fail-closed until smoke; Engage metrics empty while `DIALPAD_LIVE≠1` |

## Live inventory (API health 2026-08-08)

| Field | Value |
|-------|--------|
| `company_id` | `5390437239431168` |
| Company name | Tage Venture Capital |
| Health | `GET /api/v2/company` → **200** with company API key |
| API key | Configured — last4 **`nuFF`** (full secret never in docs/git/chat) |
| Key scopes | Default + `recordings_export`, `message_content_export:all`, `screen_pop`, `change_log`, `calls:list`, `ai_recap`, `digital_sessions`, `scripted_ivrs:read` |
| `DIALPAD_LIVE` | **1** (Production + Preview + local) |

### Offices → OS entities

| OS entity | Dialpad office | `office_id` | Main line (E.164) |
|-----------|----------------|-------------|-------------------|
| ENT-FIRM | Tage Venture Capital | `5312888585003008` | `+16193590371` |
| ENT-R619 | Recruit 619 | `5109894981558272` | `+12094545611` |
| ENT-SIGNENT | Signent HR | `4968987070242816` | `+12095090641` |
| ENT-INDA | Instant NDA | `5633477826781184` | `+12073475325` |

Known user desk (not an office main): Josh DID `+16193789360` / `dp_user_id=4721934169743360` (optional env: `DIALPAD_USER_ID`).

SQL (idempotent): `scripts/dialpad-bind-offices.sql` → `os_partner_entity_bindings` (`partner_key='dialpad'`, `external_account_id` = `office_id`, config holds `main_line` / `company_id`).

## Env / Vercel

| Var | Purpose | Status |
|-----|---------|--------|
| `DIALPAD_API_KEY` | Company admin Bearer | Configured (Prod + Preview + `.env.local`) |
| `DIALPAD_WEBHOOK_SECRET` | Shared-secret / HMAC / Dialpad JWT gate on spine webhook | Configured (generated) |
| `DIALPAD_LIVE` | Fail-closed gate for adapters + Engage | **1** (Prod + Preview + `.env.local`) |
| `DIALPAD_USER_ID` / `DIALPAD_DEFAULT_USER_ID` | Optional desk prove | Optional |

Project: Vercel `instant-nda/tagevc-os` → `https://app.tagevc.com`.

## Webhook

- Spine intake: `POST https://app.tagevc.com/api/partners/dialpad/webhook`
- Verifies `x-tagevc-webhook-secret` or `x-partner-signature`, **or** Dialpad HS256 JWT body, against `DIALPAD_WEBHOOK_SECRET`
- Records `os_partner_events` (scaffold)

### Registered subscriptions (2026-08-08)

| Resource | ID | Detail |
|----------|-----|--------|
| Webhook | `5499733003935744` | hook_url → spine webhook; JWT HS256 |
| Call subscription | `5063016097193984` | states: hangup, missed, connected, ringing, voicemail, recording |
| SMS subscription | `5979906252414976` | direction: all |

## Connect checklist

1. [x] Company API key created (Admin → Authentication → API Keys)
2. [x] Key + webhook secret in Vercel Production & Preview; `DIALPAD_LIVE=0` initially
3. [x] API health (`/api/v2/company` + `/api/v2/offices`)
4. [x] Upsert `os_partner_entity_bindings` for `dialpad` with `office_id` per entity (`scripts/dialpad-bind-offices.sql`)
5. [x] Register Dialpad event subscription → spine webhook URL (call + SMS)
6. [x] Smoke (company/offices, bindings, webhook header + JWT ping) → `DIALPAD_LIVE=1` + redeploy; Engage shows Dialpad LIVE

## Recommendation

Dialpad is **LIVE**. Office bindings + call/SMS subscriptions feed the spine webhook (JWT HS256). Provision/revoke user adapters remain scaffold stubs (`live_ok` not implemented) — Engage connectivity gate is open.
