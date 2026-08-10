# Dialpad multi-entity model (one company · many offices)

**Status (2026-08-10):** Company API key **configured** · `DIALPAD_LIVE=1` · office bindings + call/SMS subscriptions → spine webhook · Josh (Tage) and Dennis (Recruit 619) both live on Sell Premium seats. **Hybrid CRM** for Recruit 619: spine fans out R619 call events to portal ingest (match → screen pop → post-call recap). Live AI (transcript / Live Coach / Playbooks / Recaps UI) stays in Dialpad — do **not** rebuild RTA inside the portal.

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

### Seats (2026-08-10)

| Person | Office | Dialpad user id | DID | License | `profiles.dialpad_user_id` |
|--------|--------|-----------------|-----|---------|----------------------------|
| Josh Monroe | ENT-FIRM (Tage Venture Capital) | `4721934169743360` | `+16193789360` | Dialpad Sell Premium (`agents`) | set on `516e364d-e27b-4c67-bcf4-ccd167d645a4` |
| Dennis McCall | ENT-R619 (Recruit 619) | `5690823254417408` | `+16194784390` | Dialpad Sell Premium (`agents`) | set on `f8b5d2a2-cc29-4ec0-adc2-74e714cf0a1b` |

Both Sell Premium seats are now consumed; the Connect Enterprise trial seat Josh
started on is released. One Sell Premium license was moved Tage → Recruit 619
(Admin → Licenses → **Transfer**) because a Dialpad user can only be created in
an office that already holds the license — without it the API returns
`Billing issue: "transaction failed"`.

#### Dialpad only accepts `tagevc.com` logins

Dialpad treats `tagevc.com` as the sole verified company domain, so
`dennismccall@recruit619.com` is rejected on user create (`User domain does not
match` / "blacklisted domains") and there is no self-serve way to add another
domain. Workaround in place: `dennismccall@tagevc.com` is an M365 **alias** on
his real Recruit 619 mailbox (primary SMTP stays `@recruit619.com`), and that
alias is his Dialpad login. Office, DID, and caller ID are all Recruit 619, and
the CRM keys off `@recruit619.com`.

Follow-up: **ticket filed 2026-08-10** asking Support to allowlist
`recruit619.com` (plus `signenthr.com` / `instantnda.us`, which will hit the
same wall). Once it lands, switch the Dialpad email over. Dialpad's own request
form has a dedicated *Account changes → Adding a secondary domain* issue type,
which confirms this is Support-only by design and not a missing admin toggle.

#### Why "Sign in with Microsoft" fails for a subsidiary agent

Both SSO attempts fail, for two *different* reasons, and neither is fixable by API:

| Attempt | Fails at | Why |
|---------|----------|-----|
| Microsoft SSO as `dennismccall@recruit619.com` | Dialpad | Microsoft authenticates fine, but no Dialpad user carries that address |
| Microsoft SSO as `dennismccall@tagevc.com` | Microsoft | Not a sign-in identity — it is only a `proxyAddresses` entry. A mail alias routes mail; it is **not** a login UPN |

Entra confirms it: `identities` holds exactly one entry, `signInType=userPrincipalName`,
`issuerAssignedId=dennismccall@recruit619.com`, and `otherMails` is empty.

Also hard-blocked (verified 2026-08-10):

- `PATCH /users/{id}` with `emails: ["…@recruit619.com"]` →
  `Cannot set primary_email … if it does not match the user's domain (tagevc.com)`
- `PATCH /users/{id}` with `remote_service: ""` returns 200 but is a no-op; the
  Microsoft link cannot be cleared via API

So until Support allowlists the domain, subsidiary agents sign in with
**Dialpad email + password** (`…@tagevc.com` alias + "Forgot password"), not the
Microsoft button. `GET /company` shows `domain: tagevc.com` and no enforced SAML,
so the password path is available.

Admin → Recruit 619 → Users still lists Dennis as **Invite Pending**, meaning the
activation mail already went to `dennismccall@tagevc.com` and is waiting to be
clicked — it delivers to his normal Recruit 619 inbox because the tagevc.com
address is an alias on that mailbox. He should use that invite (or "Forgot
password" against the same address) rather than the Microsoft button. The admin
users grid exposes no per-user resend control; the row menu only offers phone
number actions.

SQL (idempotent): `scripts/dialpad-bind-offices.sql` → `os_partner_entity_bindings` (`partner_key='dialpad'`, `external_account_id` = `office_id`, config holds `main_line` / `company_id`).

## Env / Vercel

| Var | Purpose | Status |
|-----|---------|--------|
| `DIALPAD_API_KEY` | Company admin Bearer | Configured (Prod + Preview + `.env.local`) |
| `DIALPAD_WEBHOOK_SECRET` | Shared-secret / HMAC / Dialpad JWT gate on spine + portal webhook | Configured (generated) |
| `DIALPAD_LIVE` | Fail-closed gate for adapters + Engage + fan-out | **1** (Prod + Preview + `.env.local`) |
| `DIALPAD_USER_ID` / `DIALPAD_DEFAULT_USER_ID` | Optional desk prove / screen-pop fallback | Optional |
| `DIALPAD_USER_MAP` | ~~JSON map Dialpad user id → portal `profiles.id`~~ | **Not used.** No code reads it — verified 2026-08-10. Fan-out routes on `office_id`, and user identity resolves through `profiles.dialpad_user_id`. Do not add it. |
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

API cannot flip desktop screen-pop allow or add account credits. Confirmed via API 2026-08-09,
re-checked in the Admin UI 2026-08-10 (the AI-seat item turned out to need no action):

| Check | Status |
|-------|--------|
| Company Call AI (`settings.has_callai`) | **true** |
| Josh user license | `agents` (Sell Premium) as of 2026-08-10 |
| Dennis user license | `agents` (Sell Premium) as of 2026-08-10 |
| Lauren Dialpad user / portal profile | **not present** |
| Recruit 619 office credit balance | **$0.00** — metered SMS/MMS paused until topped up |
| Dennis first sign-in | **not yet** — `onboarding_completed: false`, `date_first_login: null` (Josh: `2026-08-06`) |

### What the API can and cannot do (probed 2026-08-10)

Re-run any time with `node scripts/dialpad-golive/09-leftovers-probe.mjs` — read-only, all GETs.

| Leftover | API verdict | Evidence |
|----------|-------------|----------|
| File a Support ticket | **No endpoint** | `/support`, `/support/tickets`, `/tickets`, `/cases`, `/help` → 404; `/company/support` → 403 *"This API is for internal use only."* |
| Read office credit balance | **Yes, read-only** | `GET /offices/{id}/plan` → `balance` (`"0.0000"` for R619) plus per-line-type counts |
| Add office credits | **Not exposed** | `/billing`, `/credits`, `/offices/{id}/billing`, `/offices/{id}/credits` → 404; `/company/billing` → 403 internal-only |
| Read/assign AI or add-on licenses | **Not exposed** | `/licenses` → 403 *"You must use a reseller API key"*; `/company/licenses`, `/company/plans` → 403 internal-only; `/offices/{id}/licenses`, `/users/{id}/licenses`, `/users/{id}/settings` → 404. The user object carries only `license: "agents"` — no Live Coach / Playbook / Recap fields |

The credit balance is the one leftover that moved from eyeball-only to
scriptable; the rest are Admin-UI-only, which is what the Admin walkthrough
below independently confirmed.

Still for Josh in Dialpad Admin UI:

1. [ ] **Recruit 619 credits** — office balance is `$0.00`; add credits (Admin → Billing) or R619 SMS/MMS stays paused. Domestic calling runs on the Sell Premium CCaaS minutes. Card entry is UI-only; no API/billing automation exists, so this one genuinely needs Josh.
2. [x] **Dialpad Support ticket** — filed 2026-08-10 via Admin → Contact us → Submit a request, category *Account changes* → issue type **Adding a secondary domain**, priority *Non-Critical business impact*. Asked for `recruit619.com` (urgent), `signenthr.com`, `instantnda.us`. Confirmation: "E-mail sent!" Reply goes to `joshmonroe@tagevc.com`. Live chat / (855) 735-2644 are the faster channels if it stalls. Full request text kept in `docs/DIALPAD_SUPPORT_TICKET.md` — reuse it verbatim for the Signent HR / Instant NDA repeat.
3. [x] **AI seats** — nothing to assign. The AI add-ons ship with the Sell Premium bundle, and the Tage → R619 license transfer carried them. Both offices now read `1 total / 1 in use` for Ai Custom Moments and RTA (Live Coach), Ai Playbooks, Ai Scorecard Sales, Ai CSAT, and Coaching Team, plus Powerdialer / Sales Local Dialing / Unlimited CCaaS / Contact Center for Sales / Voicemail Drop.
4. [ ] **AI content** — entitlement is on but no Live Coach cards exist for R619 (`/aisettings` renders the empty state, not an upgrade gate). Authoring trigger words + card copy is a business decision, not a provisioning step.
5. [ ] **Office/user AI toggles** — confirm Recruit 619 office (`5109894981558272`) + shared/main lines use company Call AI
6. [ ] **Screen pop client** — Dialpad desktop/app allows opening screen-pop URLs (browser) for agents
7. [ ] **Dennis first sign-in** — still `onboarding_completed: false` / `date_first_login: null`, matching the **Invite Pending** row in Admin. The prove call cannot run until he accepts the invite at `dennismccall@tagevc.com` (password path, not the Microsoft button).
8. [ ] **MFA** — only if Admin prompts while flipping AI / screen-pop

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
8. [x] Josh `dialpad_user_id` + env sync
9. [x] Dennis McCall seat: R619 office + `+16194784390` + Sell Premium + `profiles.dialpad_user_id`
10. [x] Vercel Production carries every var the code reads — `DIALPAD_API_KEY`, `DIALPAD_LIVE`, `DIALPAD_WEBHOOK_SECRET`, `DIALPAD_USER_ID`, `RECRUIT619_DIALPAD_WEBHOOK_URL`. `DIALPAD_R619_OFFICE_ID` is absent on purpose; the code default already matches R619. No env change was needed for Dennis.
11. [x] AI add-ons present on both seats; Support ticket filed for the domain allowlist
12. [ ] NEED_HUMAN: R619 credits (card entry), screen-pop client allow
13. [ ] Prove: inbound ring → CRM pop → hangup → recap on `/engage/call-log`

## Recommendation

Dialpad is **LIVE** with **hybrid CRM**. Live RTA stays in Dialpad. Portal owns match / pop / post-call. Provision/revoke user adapters remain scaffold stubs (`live_ok` not implemented) — Engage connectivity gate is open.
