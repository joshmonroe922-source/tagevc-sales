# What Josh needs to paste — DocuSign → Tage OS live

Org already has **four DocuSign accounts** (Tage / Recruit 619 / Signent / Instant NDA). OS code is ready for JWT + Connect; until these env values land in Vercel, sends stay in **mock** mode (`ENV-…` envelope IDs).

**Do not commit secrets to git.** Paste into Vercel → `tagevc-sales` → Environment Variables (Production + Preview), or hand values in chat once for the agent to set via Vercel UI with you watching.

---

## Entity map (fill Account IDs)

| DocuSign account name | Tage entity code | Env var to paste |
|----------------------|------------------|------------------|
| Tage Venture Capital | `ENT-FIRM` | `DOCUSIGN_ACCOUNT_ID_FIRM` **and** `DOCUSIGN_ACCOUNT_ID` (same GUID; default/fallback) |
| Recruit 619 | `ENT-R619` | `DOCUSIGN_ACCOUNT_ID_R619` = `da7e0ea3-5dea-43a4-987f-e955731d7612` (Vercel). Org `253497871` (NA4). Membership **Active**; Connect `21766635`. |
| Signent HR | `ENT-SIGNENT` | `DOCUSIGN_ACCOUNT_ID_SIGNENT` |
| Instant NDA | `ENT-INDA` | `DOCUSIGN_ACCOUNT_ID_INDA` |

Where to find Account ID: DocuSign Admin → **Settings → Apps and Keys** (or account switcher) → each account’s **API Account ID** (GUID).

Unlimited future entities: add another `DOCUSIGN_ACCOUNT_ID_<SLUG>` + OS entity row when you create the DocuSign account; same Integration Key / JWT user can impersonate across org accounts once consented.

---

## Shared JWT app (once for the org)

| # | What | Where in DocuSign | Env var | Notes |
|---|------|-------------------|---------|-------|
| 1 | **Integration Key** | Apps and Keys → your app | `DOCUSIGN_INTEGRATION_KEY` | Also called Client ID |
| 2 | **User ID** (API username GUID) | Apps and Keys → **API Username** of the user who will send (usually Josh) | `DOCUSIGN_USER_ID` | Must have access to all four accounts |
| 3 | **RSA private key** | Apps and Keys → Generate RSA → download private key | `DOCUSIGN_PRIVATE_KEY` | PEM; in Vercel you can use `\n` for newlines. **Never commit.** Keep the public key uploaded on the Integration Key |
| 4 | **Demo vs prod** | Confirm which environment the org uses | `DOCUSIGN_OAUTH_HOST` + `DOCUSIGN_BASE_PATH` | **Demo:** `account-d.docusign.com` + `https://demo.docusign.net`. **Prod:** `account.docusign.com` + your site base (often `https://na3.docusign.net` / `na4` — copy exact **Account Base URI** from Apps and Keys) |
| 5 | **JWT consent** (one-time click) | Open consent URL as the User ID above | — | See URL below. Until this is done, JWT token fails with consent_required |
| 6 | **Redirect URI** on Integration Key | Apps and Keys → Integration Key → Additional settings → Redirect URIs | — | Add `https://app.tagevc.com` (and `http://localhost:3000` if you test locally). JWT consent uses this |

### JWT consent URL (Josh clicks once while signed into DocuSign)

Replace `INTEGRATION_KEY` and use the matching host (demo vs prod):

```
https://account.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=INTEGRATION_KEY&redirect_uri=https://app.tagevc.com
```

Demo: use `https://account-d.docusign.com/oauth/auth?...` instead.

---

## Connect webhook (status → OS)

| # | What | Value | Env var |
|---|------|-------|---------|
| 7 | **Connect URL** | `https://app.tagevc.com/api/docusign/webhook` | (configure in DocuSign Connect) |
| 8 | **HMAC secret** | DocuSign Connect → Include HMAC Signature → copy secret | `DOCUSIGN_CONNECT_HMAC_SECRET` |
| 9 | **Optional custom header secret** | Any long random string you invent | `DOCUSIGN_WEBHOOK_SECRET` (header `x-tagevc-webhook-secret`) |

Connect config tips:

- JSON REST format (not XML)
- Events: envelope sent / delivered / completed / declined / voided (at minimum **completed**)
- Prefer one Connect configuration that can see all four accounts, or one per account — both work if they hit the same URL
- **Live route is `/api/docusign/webhook`** (not `/connect`)

---

## Minimum paste pack (copy/paste template for Josh)

```
DOCUSIGN_INTEGRATION_KEY=
DOCUSIGN_USER_ID=
DOCUSIGN_PRIVATE_KEY=   # paste PEM privately; Vercel only
DOCUSIGN_OAUTH_HOST=account.docusign.com          # or account-d.docusign.com
DOCUSIGN_BASE_PATH=https://naX.docusign.net       # copy from Apps and Keys
DOCUSIGN_ACCOUNT_ID=                              # Tage / ENT-FIRM
DOCUSIGN_ACCOUNT_ID_FIRM=                         # same as above
DOCUSIGN_ACCOUNT_ID_R619=
DOCUSIGN_ACCOUNT_ID_SIGNENT=
DOCUSIGN_ACCOUNT_ID_INDA=
DOCUSIGN_CONNECT_HMAC_SECRET=
DOCUSIGN_WEBHOOK_SECRET=                          # optional but recommended
```

---

## Recruit 619 join (for `DOCUSIGN_ACCOUNT_ID_R619`)

**Complete:** API Account ID `da7e0ea3-5dea-43a4-987f-e955731d7612` on Vercel; membership **Active**; JWT `userinfo` lists all four accounts; hub mapping **4/4**; Connect **Tage OS** ID `21766635` → `https://app.tagevc.com/api/docusign/webhook` (completed/declined/voided, integrator-managed HMAC). Other Connect IDs: Tage `21766631`, Instant NDA `21766632`, Signent `21766633`.

---

## After paste — smoke test

1. Redeploy / wait for Vercel env pickup.
2. Open OS → Shared Services → Legal → **DocuSign** — mode should show **live** (not mock).
3. Send a non-capital test envelope from Tage (ENT-FIRM) to yourself.
4. Confirm Connect fires → status updates on hub; completed → signed PDF archive attempt.
5. Repeat one send from Recruit 619 entity scope to prove `DOCUSIGN_ACCOUNT_ID_R619` routing.

---

## What we build next (after live connect)

| Phase | Deliverable |
|-------|-------------|
| A | Templates library synced from each entity account + OS Document Library mirror |
| B | Autofill merge fields from employee / vendor / deal / client_org records |
| C | Send-for-signature from actions (HRIS onboarding, AP vendor, Legal matters) |
| D | Webhook → pull signed PDF → library + attach `document_id` on source record |

Already scaffolded: `src/lib/docusign/automation-spine.ts`, send intents, signed-docs pull-back, entity account resolver.
