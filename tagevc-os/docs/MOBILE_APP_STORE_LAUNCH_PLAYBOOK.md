# Mobile App Store Launch Playbook

**Operational playbook** for shipping an Expo (EAS) mobile app to the **Apple App Store** and **Google Play**, with **Supabase Auth**, **Resend** email, and **Stripe** billing.

**First production run:** Instant NDA (Jul–Aug 2026)  
**Canonical OS home:** Shared Services → Technology → **Mobile launch** (`/shared-services/it/mobile-launch`)  
**Product copy:** Instant NDA repo `docs/MOBILE_APP_STORE_LAUNCH_PLAYBOOK.md` (keep in sync)

Use this for every future Tage portfolio mobile app. Product-specific IDs below are Instant NDA examples — replace with the new app’s values.

---

## How to use

1. Copy this checklist into the launch ticket / OS process page.
2. Work **top to bottom**. Do not start production store builds until Preflight + EAS link + secrets are green.
3. Keep **secrets out of git and chat**. Roll any key that was pasted in plaintext.
4. After the first app, update the **Common errors** section with new gotchas.

**Shell PATH (Josh Mac):**

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
```

---

## 0) Preflight — accounts, legal, identity

### Legal entity & store accounts

- [ ] Legal entity name, address, phone match filings (D&B / tax / bank)
- [ ] **Apple Developer Program — Organization** ($99/yr), not Individual (for company products)
- [ ] **D-U-N-S** obtained via Apple enrollment if needed (can take 1–5+ business days)
- [ ] Apple membership shows **Active**; note **Team ID**
- [ ] Apple ID for the org (e.g. `founder@company.com`) can sign into [App Store Connect](https://appstoreconnect.apple.com)
- [ ] **Google Play Console** account created ($25 one-time)
- [ ] Play **organization / identity verification** submitted (authorized representative complete)
- [ ] Expo account ready; `eas login` works on the build Mac
- [ ] Stripe account: business verification + bank for **Live** payouts (can finish before or after store review; required before real charges)
- [ ] Supabase project live; marketing site + privacy URL public (incognito check)
- [ ] Support email monitored (store review replies within ~24h)

### Product / compliance decisions (lock before submit)

- [ ] Bundle / package ID chosen and reserved (e.g. `com.example.app`) — **immutable** after first Play AAB
- [ ] Billing model for v1 documented:
  - **iOS:** native IAP **or** “Manage Billing on the Web” (Safari) handoff
  - **Android / web:** Stripe Checkout + Customer Portal (or Play Billing if you choose IAP)
- [ ] Privacy policy hosted at a stable HTTPS URL
- [ ] In-app disclaimers (not legal advice / drafts) if applicable
- [ ] Attorney review of templates **or** explicit founder risk acceptance
- [ ] Age rating / content rating expected answers drafted
- [ ] App Review **demo account** plan (email + password + how-to notes)

### Instant NDA reference (example)

| Item | Value |
|------|--------|
| Legal | Instant NDA, LLC · DUNS `149878673` · Carmel IN |
| Apple Team ID | `SSBQ54JB58` |
| ASC App ID | `6796389266` |
| Bundle / package | `com.instantnda.app` |
| Play account | `7330188155728080629` |
| EAS project | `@joshmonroe922/instant-nda` |
| Supabase | `snhyqfxznhvygjhlhskw` |
| App / privacy | `https://app.instantnda.us` · `https://instantnda.us/privacy` |

---

## 1) Expo / EAS project link

```bash
cd /path/to/app-repo
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npx eas-cli@latest login
npx eas-cli@latest init          # creates/links project; sets extra.eas.projectId
npx eas-cli@latest whoami
```

- [ ] `app.config.ts` / `app.json` has `extra.eas.projectId`
- [ ] Project visible on https://expo.dev/
- [ ] `eas.json` profiles: `development`, `preview`, `production`
- [ ] Production uses `autoIncrement` for iOS buildNumber / Android versionCode
- [ ] iOS submit block ready: `appleId`, `appleTeamId`, `ascAppId` (after ASC app exists)
- [ ] Optional: ASC API key (`.p8`) for non-interactive submit — **never commit** the private key; Key ID only in docs is OK
- [ ] First iOS credentials: `npx eas credentials -p ios` → let Expo create Dist Cert + provisioning (interactive Apple login)
- [ ] First Android: let EAS manage the upload keystore

**One-shot pattern (Instant NDA):** `npm run eas:go` / `scripts/eas-after-login.sh` after login + secrets.

---

## 2) Env & secrets

### Client (EAS / Expo — safe in binary)

| Secret | Notes |
|--------|--------|
| `EXPO_PUBLIC_SUPABASE_URL` | Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | **anon** only — never `service_role` |
| `EXPO_PUBLIC_APP_URL` | Production web/app URL |
| `EXPO_PUBLIC_PRIVACY_POLICY_URL` | Public privacy URL |

```bash
npx eas env:list --environment production
# or legacy:
npx eas secret:list
```

- [ ] All four present for **production** builds
- [ ] Anon key matches Supabase Dashboard → Settings → API
- [ ] Local `.env` matches production for smoke tests

### Server only (Supabase Edge Function secrets — **not** EAS)

| Secret | Notes |
|--------|--------|
| `STRIPE_SECRET_KEY` | `sk_test_…` then `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | Live `whsec_…` ≠ test |
| `STRIPE_PRICE_*` | One ID per plan / one-time product |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | PDF + auth email |
| `SEND_EMAIL_HOOK_SECRET` | Auth Send Email Hook |
| `APP_URL` | Edge redirects / links |
| Supabase `service_role` | Dashboard / server only |

- [ ] No Stripe / Resend / service_role in EAS client env
- [ ] If a live key was pasted in chat → **roll** it before traffic

---

## 3) Auth emails (Supabase hook + Resend + rate limits)

### Preferred architecture

1. Edge function `auth-send-email` (Auth **Send Email Hook**)
2. Sends via Resend using same `RESEND_*` as PDF mail
3. Branded From: `Product <notifications@domain>`
4. Site URL + redirect URLs include web app + deep link scheme (`myapp://**`)
5. `enable_confirmations = true` for production

### Checklist

- [ ] Resend domain verified (SPF/DKIM); test sender is not limited to signup address
- [ ] Hook enabled in `supabase/config.toml` → `[auth.hook.send_email]`
- [ ] `SEND_EMAIL_HOOK_SECRET` set; `supabase config push`
- [ ] Function deployed: `supabase functions deploy auth-send-email --project-ref …`
- [ ] Site URL + redirect allow-list correct
- [ ] Signup → confirmation email arrives with correct From
- [ ] Magic link / reset tested
- [ ] **Email rate limit** raised above default **2/hour** (see gotcha below)
- [ ] App Review demo user **manually confirmed** in Auth Admin (avoids mail delay during review)

### Gotcha — GoTrue rate limit + hook-only delivery

Supabase still enforces `rate_limit_email_sent` when the Send Email Hook is on (default **2/hour**).  
`supabase config push` only applies `[auth.rate_limit] email_sent` if **SMTP** is enabled in config. With **hook-only** delivery the CLI may report **“Auth config is up to date”** while production stays at 2.

**Fix:** Dashboard → Authentication → Rate Limits → raise email sent (e.g. **300/hr**), or Management API:

```bash
export SUPABASE_ACCESS_TOKEN="…"   # Dashboard → Account → Access Tokens
curl -X PATCH "https://api.supabase.com/v1/projects/<PROJECT_REF>/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rate_limit_email_sent":300}'
```

### App UX requirements

- [ ] Sign-in detects **Email not confirmed** → offer **Resend confirmation**
- [ ] Resend / signup surfaces **email rate limit** with a clear wait message (`over_email_send_rate_limit`)
- [ ] Auth screens use `KeyboardAvoidingView` + scroll so fields stay reachable on iPhone
- [ ] Generic Auth **500** (hook/Resend failure) shows actionable copy, not a blank fail

---

## 4) Stripe — test → live cutover

App code should be **mode-agnostic**: Checkout, Portal, and webhooks read only Edge secrets. Prefer **no** publishable key in the mobile client if all Stripe traffic is server-side.

### Test mode first

- [ ] Products + prices created in **Test**
- [ ] Test webhook → `…/functions/v1/stripe-webhook` with events:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- [ ] Customer Portal enabled (payment method, cancel, plan switches)
- [ ] Smoke: Upgrade → `4242…` → org plan updates; Portal opens

### Live cutover

- [ ] Stripe Dashboard → **Test mode OFF**
- [ ] Business verification + payout bank complete
- [ ] Recreate **all** products/prices in Live (IDs differ from test)
- [ ] Include one-time SKUs if marketed (e.g. Single Use, Pro overage credits)
- [ ] Live Customer Portal: enable + attach **all** live prices for plan switches
- [ ] Live webhook endpoint (same URL path, **Live** mode) → copy new `whsec_…`
- [ ] Set Edge secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, every `STRIPE_PRICE_*`
- [ ] Leave test webhook alone (separate signing secret)
- [ ] Roll `sk_live_…` if it ever appeared in chat/logs
- [ ] Smoke with a real card (refund in Dashboard afterward)

### Instant NDA catalog pattern (example)

| Offer | Type | Secret |
|-------|------|--------|
| Pro / Unlimited / Team / … | Recurring monthly | `STRIPE_PRICE_*_MONTHLY` |
| Pro Extra NDA | One-time overage credit | `STRIPE_PRICE_PRO_OVERAGE` |
| Single Use | One-time entitlement | `STRIPE_PRICE_SINGLE_USE` |

**Platform billing paths (v1 Instant NDA):**

| Platform | Path |
|----------|------|
| iOS | Manage Billing on the Web → Safari Checkout/Portal → return deep link |
| Android / web | In-app Upgrade / Manage Billing → Stripe HTTPS |

No store resubmit required for Stripe secret rotation when billing is web-based.

---

## 5) iOS — certificates, metadata, screenshots, review, release

### App ID + ASC app

- [ ] Developer → Identifiers → App ID **Explicit** bundle ID
- [ ] Do **not** enable unused capabilities (Push / Sign in with Apple / Associated Domains) unless configured in the app
- [ ] ASC → New App → iOS → name / language / bundle / SKU
- [ ] Copy numeric **Apple ID** into `eas.json` → `ascAppId`
- [ ] If the short name is taken, use a longer App Store name (e.g. `Instant NDA - Sign Fast`)

### Certificates & build

```bash
npx eas credentials -p ios          # interactive first time
npx eas build --platform ios --profile production
npx eas submit --platform ios --profile production
```

- [ ] Production IPA succeeded on expo.dev
- [ ] Submitted to ASC; appears under TestFlight after processing
- [ ] Export compliance: standard HTTPS only → exempt / no non-exempt encryption (`ITSAppUsesNonExemptEncryption: false` when true for your app)

### Metadata

Prefer `eas metadata:push` + `store.config.json` when available; screenshots still need ASC UI.

- [ ] Name, subtitle, description, keywords, promotional text
- [ ] Support / Marketing / Privacy URLs
- [ ] Copyright, What’s New
- [ ] Primary / secondary categories
- [ ] Age rating questionnaire (often **4+** for productivity)
- [ ] Pricing = **Free** if no IAP in v1

### Screenshots (critical sizes)

| Device | Accepted size notes |
|--------|---------------------|
| iPhone 6.7" | ASC often wants **1284×2778**. **1290×2796 can be rejected** even if generated as “6.7"”. |
| iPad | e.g. **2048×2732** (or other ASC-listed sizes) |

- [ ] Use the ASC-accepted pixel dimensions (verify before upload)
- [ ] 5–6 screens, light mode, real flow order (sign-in → home → session → sign → done → history)
- [ ] Do not upload from a folder of the wrong pixel size
- [ ] EAS Metadata does **not** upload screenshots

### App Privacy (nutrition labels)

Attest in ASC UI. Typical for auth + documents apps:

| Data | Collected | Linked | Tracking | Purpose |
|------|-----------|--------|----------|---------|
| Email | Yes | Yes | No | App Functionality |
| Name | Yes | Yes | No | App Functionality |
| Other User Content | Yes | Yes | No | App Functionality |

### App Review Information

- [ ] Contact name / phone / email
- [ ] Sign-in required = Yes (if applicable)
- [ ] Demo user + password (create on production first)
- [ ] Notes: how to start core flow; “not legal advice” if relevant; billing handoff explanation for iOS web billing

### TestFlight → Submit

- [ ] Internal testers installed build; end-to-end NDA/session flow OK
- [ ] iOS web billing handoff OK (if used)
- [ ] Clear all red “Missing …” items
- [ ] Select build → **Add for Review** → **Submit to App Review**
- [ ] Calendar blocked for reviewer questions (~24h)

### Release

- [ ] Choose Automatic release or Manual
- [ ] After **Ready for Sale**, verify App Store listing + production binary

---

## 6) Android — Play Console, declarations, graphics, AAB, review

### Create app

- [ ] Play Console → **Create app** unlocked (verification may block)
- [ ] Name, language, App (not game), **Free**
- [ ] Declarations (policies / export) checked honestly
- [ ] Package name = first AAB’s `applicationId` (must match config)

### Store listing & graphics

| Asset | Spec |
|-------|------|
| Short description | ≤ 80 chars |
| Full description | From listing doc |
| App icon | **512×512** |
| Feature graphic | **1024×500** (required) |
| Phone screenshots | min **1080×1920** |
| Privacy policy URL | Public HTTPS |
| Support email / website | Monitored |

### Declarations / forms

- [ ] Content rating questionnaire (often Everyone)
- [ ] Target audience — **not** designed for children (if true)
- [ ] Data safety form matches privacy policy (email, name, files/docs, etc.)
- [ ] Ads declaration, government apps, etc. as applicable
- [ ] Financial features / payments disclosure if Stripe subscriptions exist

### AAB upload

```bash
npx eas build --platform android --profile production
# then either:
npx eas submit --platform android --profile production
# or manual upload from expo.dev artifact
```

**Practical tip:** If the browser cannot upload from the EAS download path cleanly, **copy the `.aab` to Desktop** and Choose File from there.

- [ ] AAB uploaded to **Internal testing** first
- [ ] Testers added; opt-in link installed on a real device
- [ ] End-to-end + Android Stripe billing smoke OK
- [ ] Promote Internal → Closed/Open testing or **Production** when ready
- [ ] Send for review / publish per track

### Play warnings (usually non-blocking)

- [ ] **Deobfuscation / mapping file** warning — upload ProGuard/R8 mapping from EAS artifacts if available; often OK to proceed for v1 and improve later
- [ ] “File too large to preview” on AAB — ignore preview; the upload can still succeed
- [ ] Confirm versionCode increases each release (`autoIncrement`)

---

## 7) Common errors & how to handle

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Auth email rate limit / `over_email_send_rate_limit` | GoTrue default 2/hr; hook does not bypass | Raise `rate_limit_email_sent` in Dashboard/API (see §3). Wait or confirm user in Admin. |
| `supabase config push` says Auth up to date but limit still 2 | Hook-only; CLI skips email_sent without SMTP | Patch via Dashboard or Management API |
| Sign-in: **Email not confirmed** | Confirmations ON; user never clicked link | Resend confirmation UI; or Admin → Confirm user (review accounts) |
| Confirmation never arrives | Resend domain / API key / hook secret / function down | Resend Logs + Edge Function logs; verify domain; redeploy hook |
| Auth **500** on signup/resend | Hook/Resend failure | Check `auth-send-email` logs; `RESEND_*` + hook secret |
| Stripe webhook **500** / `Invalid email` | Checkout metadata missing email or bad customer email | Ensure session/customer email valid; fix webhook validation; replay event |
| Webhook signature failures after cutover | Used test `whsec` with live key (or reverse) | Set matching live `STRIPE_WEBHOOK_SECRET` |
| Org plan not updating after pay | Wrong price ID secret or webhook events incomplete | Verify live price IDs; check Stripe → Webhooks deliveries |
| ASC rejects screenshots | Wrong pixel size (e.g. 1290×2796 vs 1284×2778) | Resize to ASC-accepted dimensions; re-upload |
| App name taken on ASC | Another account owns the short name | Use longer distinctive name |
| “A newer build is available” (TestFlight/device) | Older install vs newer processing build | Install latest TestFlight build; expire old builds if confusing |
| Play: file too large to preview | Console preview limit | Proceed; confirm release processed |
| Play: deobfuscation warning | Missing mapping.txt | Optional upload mapping; not always a blocker |
| Play Create app greyed out | Verification / authorized rep incomplete | Finish org verification |
| EAS iOS credentials fail non-interactively | No Apple login / API key | `eas credentials` interactive or ASC API key |
| Keyboard covers inputs | Missing KAV / scroll | `KeyboardAvoidingView` + `keyboardShouldPersistTaps` |
| “Demo mode” in production build | Missing `EXPO_PUBLIC_SUPABASE_*` at build time | Fix EAS env; rebuild (env is baked in) |
| PDF email only to founder | Resend test domain restriction | Verify production domain on Resend |
| Deep link return from Stripe broken | Missing scheme / redirect URLs | Configure `app.config` scheme + Supabase redirect allow-list |
| Git / Vercel wrong author | Commit email not on team | Use product org email for that repo’s commits |

---

## 8) Post-approval go-live

- [ ] App Store status **Ready for Sale** / Play **Production** available
- [ ] Public store URLs saved in OS / CRM / marketing site
- [ ] Stripe **Live** cutover complete before paid traffic (§4)
- [ ] Support inbox + store review reply path staffed
- [ ] Feature flags / “coming soon” cleaned up if any
- [ ] Optional: Terms of Use page if only privacy + billing existed
- [ ] Phase-2 backlog filed (native IAP, tighter Play mapping upload, device-quality screenshots, etc.)
- [ ] Roll any secrets that leaked during launch week
- [ ] Update this playbook with new gotchas from this launch

---

## 9) Post-launch smoke tests

Run on **production store builds** (not only Expo Go / web).

### Auth & email

- [ ] Fresh signup → confirmation email → land on app URL
- [ ] Unconfirmed sign-in shows resend path
- [ ] Password reset works
- [ ] Review demo account still signs in

### Core product

- [ ] Profile setup complete
- [ ] Two-device / two-party flow (QR or code) succeeds
- [ ] PDF generated; both parties receive email
- [ ] History shows the agreement

### Billing

- [ ] **Android/web:** Upgrade → Live Checkout → plan/entitlement updates; webhook green
- [ ] **iOS:** Manage Billing on the Web → Safari → success deep link returns to app
- [ ] Customer Portal: update card / cancel / switch plan (as enabled)
- [ ] One-time SKUs (if any): Single Use / overage credit grants correctly

### Store hygiene

- [ ] Listing screenshots/text match current UX
- [ ] Privacy / support links resolve
- [ ] Crash-free launch on a clean install

---

## Command cheat sheet

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /path/to/app-repo

# EAS
npx eas-cli@latest login
npx eas-cli@latest init
npx eas env:list --environment production
npx eas build --platform ios --profile production
npx eas build --platform android --profile production
npx eas submit --platform ios --profile production
npx eas submit --platform android --profile production
npx eas-cli@latest metadata:push --profile production   # if store.config.json used

# Supabase
npx supabase secrets set --project-ref <REF> KEY=value
npx supabase functions deploy auth-send-email --project-ref <REF>
npx supabase functions deploy stripe-webhook --project-ref <REF>
npx supabase config push --project-ref <REF> --yes
```

---

## Related Instant NDA docs (product-specific)

Product repo: `/Users/joshmonroe/Projects/InstaNDA/docs/`

| Doc | Use |
|-----|-----|
| `JOSH_APP_STORE_WALKTHROUGH.md` | Founder click-path |
| `ASC_SUBMIT_CHECKLIST.md` | Final ASC submit |
| `ASC_METADATA.md` | Paste pack |
| `STRIPE_LIVE_CUTOVER.md` | Live prices / portal / webhook |
| `EAS_SECRETS_CHECKLIST.md` | Client env |
| `STORE_LAUNCH_STEPS.md` | Ordered launch steps |
| `PRE_SUBMISSION_CHECKLIST.md` | Go / no-go |
| `SETUP_AUTH_EMAIL.md` (repo root) | Auth hook + rate limit |
| `DEPLOYMENT.md` (repo root) | EAS profiles deep dive |

---

## Inheritance rule (Tage portfolio)

Every new mobile app under Tage / subsidiaries:

1. Opens a launch ticket linked to this playbook (OS Technology → Mobile launch).
2. Clones the checklist; fills product-specific IDs in a short appendix.
3. Does **not** invent a parallel secret-handling story — client vs Edge split stays the same.
4. Returns learnings into §7 before the ticket closes.

*Last updated: Aug 1, 2026 — distilled from Instant NDA Apple + Google + Stripe + Supabase + EAS launch.*
