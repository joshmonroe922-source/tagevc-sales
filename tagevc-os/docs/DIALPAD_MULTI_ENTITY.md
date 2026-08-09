# Dialpad multi-entity model (one company · many offices)

**Status (2026-08-09):** Company API key **configured** · `DIALPAD_LIVE=1` · office bindings + call/SMS subscriptions → spine webhook. **Hybrid CRM** for Recruit 619: spine fans out R619 call events to portal ingest (match → screen pop → post-call recap). Live AI (transcript / Live Coach / Playbooks / Recaps UI) stays in Dialpad — do **not** rebuild RTA inside the portal.

**Related:** `docs/PARTNER_SPINE.md` · `docs/DIALPAD_ORG_HIERARCHY.md` (coaching) · Engage: `/shared-services/marketing/engage` · portal: `recruit619-portal` `/engage/call-log` · contrast payroll: `docs/GUSTO_MULTI_ENTITY.md`.

## Hybrid architecture (Josh choice)

| Owner | Responsibilities |
|-------|------------------|
| **Dialpad** | Softphone, real-time AI (transcript, Live Coach, Playbooks, Recaps UI) |
| **Recruit 619 / Tage** | Inbound contact lookup, screen pop to CRM record, post-call logging / AI recap sync, notes & disposition on records, click-to-call |

Flow:

1. **Ringing / connected** webhook → normalize E.164 → match `r619_contacts` / `r619_candidates` → attach `contact_id`
2. **Screen pop** → `POST /api/v2/users/{id}/screenpop` with portal URL (`/people/…`, `/candidates/…`, `/accounts/…`) — requires Dialpad agent `target.id` (user) mapping
3. **Mid-call** → agent works AI in Dialpad; CRM shows the popped record (no live RTA rebuild)
4. **Hangup** → parse webhook recap and/or `GET /api/v2/call/{id}/ai_recap` → store on `r619_comm_sessions` → session drawer + `/engage/call-log`

Portal ingest: `POST https://portal.recruit619.com/api/integrations/dialpad/webhook`  
Spine intake (still registered): `POST https://app.tagevc.com/api/partners/dialpad/webhook` → records `os_partner_events` + **fan-out** to portal when `DIALPAD_LIVE=1` and office is R619 (or office unknown).

## Model

| Layer | Choice |
|-------|--------|
| Company | **One** Dialpad company: Tage Venture Capital |
| Entities | Subsidiaries = **offices** under that company (not separate Dialpad companies) |
| Secrets | `DIALPAD_API_KEY`, `DIALPAD_WEBHOOK_SECRET`, `DIALPAD_LIVE` in env / Vercel only — never in `os_partner_entity_bindings.config` |
| Bindings | Non-secret `office_id` (+ main DID) per `entity_id` in partner bindings |
| Live gate | Fail-closed until smoke; Engage metrics empty while `DIALPAD_LIVE≠1` |
| CRM path | Hybrid — no Salesforce Dialpad connector cutover required |

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
| `DIALPAD_WEBHOOK_SECRET` | Shared-secret / HMAC / Dialpad JWT gate on spine + portal webhook | Configured (generated) |
| `DIALPAD_LIVE` | Fail-closed gate for adapters + Engage + fan-out | **1** (Prod + Preview + `.env.local`) |
| `DIALPAD_USER_ID` / `DIALPAD_DEFAULT_USER_ID` | Optional desk prove / screen-pop fallback | Optional |
| `DIALPAD_USER_MAP` | JSON map Dialpad user id → portal `profiles.id` (portal) | NEED_HUMAN map agents |
| `DIALPAD_R619_OFFICE_ID` | Override R619 office filter (default `5109894981558272`) | Optional |
| `RECRUIT619_DIALPAD_WEBHOOK_URL` | Explicit fan-out target (else `{portal}/api/integrations/dialpad/webhook`) | Optional |
| `DIALPAD_FANOUT_R619` | Set `0` to disable spine→portal fan-out | Default on when LIVE |

Projects:

- Vercel `instant-nda/tagevc-os` → `https://app.tagevc.com`
- Recruit 619 portal → `https://portal.recruit619.com`

## Webhook

- Spine intake: `POST https://app.tagevc.com/api/partners/dialpad/webhook`
  - Verifies `x-tagevc-webhook-secret` / `x-partner-signature` **or** Dialpad HS256 JWT body
  - Records `os_partner_events`
  - Fans out decoded JSON to portal with shared-secret headers (R619 office / unknown)
- Portal hybrid ingest: `POST https://portal.recruit619.com/api/integrations/dialpad/webhook`
  - Same secret / JWT acceptance
  - Upserts `r619_comm_sessions` + phone match + screen pop + AI recap fetch

### Registered subscriptions (2026-08-08)

| Resource | ID | Detail |
|----------|-----|--------|
| Webhook | `5499733003935744` | hook_url → spine webhook; JWT HS256 |
| Call subscription | `5063016097193984` | states: hangup, missed, connected, ringing, voicemail, recording |
| SMS subscription | `5979906252414976` | direction: all |

Optional hardening: add a **second** Dialpad webhook pointing directly at the portal URL (same secret) if fan-out latency or spine downtime is a concern.

## NEED_HUMAN — Dialpad admin leftovers

API cannot flip seat AI licenses / desktop screen-pop allow. Confirmed via API 2026-08-09:

| Check | Status |
|-------|--------|
| Company Call AI (`settings.has_callai`) | **true** |
| Josh user license | `talk` only (not AI seat) — upgrade in Admin |
| Lauren Dialpad user / portal profile | **not present** (only Josh in company users) |
| Josh `profiles.dialpad_user_id` | **`4721934169743360`** |
| Portal `DIALPAD_USER_MAP` | Josh → `516e364d-e27b-4c67-bcf4-ccd167d645a4` (Vercel prod+preview) |

Still for Josh in Dialpad Admin UI:

1. [ ] **AI seats** — assign Live Coach / Playbooks / Recaps (or AI-capable license) to Josh + future R619 agents
2. [ ] **Office/user AI toggles** — confirm Recruit 619 office (`5109894981558272`) + shared/main lines use company Call AI
3. [ ] **Screen pop client** — Dialpad desktop/app allows opening screen-pop URLs (browser) for agents
4. [x] **Agent user map** — Josh mapped; add Lauren when she has a Dialpad user + portal profile
5. [x] **Portal + OS env** — Dialpad LIVE secrets / fan-out / user map re-synced 2026-08-09; portal redeployed after sync
6. [ ] **MFA** — only if Admin prompts while flipping AI / screen-pop

No Salesforce cutover for Dialpad CRM.

## Prove call (test plan)

1. Ensure a CRM contact/candidate has a phone you can call from (E.164 match).
2. Softphone as Josh (`+16193789360` / user `4721934169743360`).
3. Inbound ring to Josh desk or R619 main (`+12094545611`) → expect portal screen pop to matched record.
4. Use Dialpad live AI during call (once AI seat enabled); do **not** expect live RTA inside portal.
5. Hang up → open `/engage/call-log` + session drawer → confirm session + AI recap text when Dialpad provides it.
6. Optional: click-to-call from a people/candidate record.

## Connect checklist

1. [x] Company API key created (Admin → Authentication → API Keys)
2. [x] Key + webhook secret in Vercel Production & Preview; `DIALPAD_LIVE=0` initially
3. [x] API health (`/api/v2/company` + `/api/v2/offices`)
4. [x] Upsert `os_partner_entity_bindings` for `dialpad` with `office_id` per entity (`scripts/dialpad-bind-offices.sql`)
5. [x] Register Dialpad event subscription → spine webhook URL (call + SMS)
6. [x] Smoke (company/offices, bindings, webhook header + JWT ping) → `DIALPAD_LIVE=1` + redeploy; Engage shows Dialpad LIVE
7. [x] Hybrid code: portal phone match + screen pop + ai_recap + spine fan-out (PRs portal #73/#74, OS #36/#37)
8. [x] Josh `dialpad_user_id` + `DIALPAD_USER_MAP` / env sync
9. [ ] NEED_HUMAN: AI seat license + screen-pop client allow
10. [ ] Prove: inbound ring → CRM pop → hangup → recap on `/engage/call-log`

## Recommendation

Dialpad is **LIVE** with **hybrid CRM**. Live RTA stays in Dialpad. Portal owns match / pop / post-call. Provision/revoke user adapters remain scaffold stubs (`live_ok` not implemented) — Engage connectivity gate is open.
