# Tage VC — RingCentral Embeddable (softphone + SMS)

Phase 1 ships the **RingCentral Embeddable** widget in the portal (floating softphone + SMS) and **Call / SMS** buttons on Contact detail and deal detail when a phone is present.

Live calls/texts need Josh to create a RingCentral Developer app and set `VITE_RINGCENTRAL_CLIENT_ID` on Vercel. Until then the UI shows a soft **RingCentral not configured** hint and disables Call/SMS.

---

## What is already in the portal

| Piece | Behavior |
|-------|----------|
| Widget | Loaded from SalesLayout via `adapter.js` when `VITE_RINGCENTRAL_CLIENT_ID` is set |
| Auth | **Per-user** login inside the widget (Authorization Code + **PKCE**). No shared JWT |
| Typography | Softphone uses **Open Sans** via Embeddable `stylesUri` → `/rc-embeddable-styles.css` (absolute URL from the portal origin). Host badge / Call·SMS chrome also uses portal `--sans` (Open Sans) |
| Call / SMS | Contact detail header + deal detail header → `RCAdapter.clickToCall` / `clickToSMS` (E.164) |
| Activity | Best-effort: after click-to-call, `rc-call-end-notify` can log `call_logged` / `call_missed` on `sales_lead_activities` when `contact_id` was set. SMS message→activity mapping is stubbed for Phase 2 |
| Mic | Widget iframe requests microphone; portal is HTTPS on `portal.tagevc.com` |

**Do not** put a client secret in the Vite frontend. Embeddable uses PKCE with **client ID only**.

---

## Josh: RingCentral Developer Console

1. Open [RingCentral Developers](https://developers.ringcentral.com/) → sign in with the Tage RC org.
2. **Create app** (or open existing):
   - App type / auth: **3-legged OAuth** — **Authorization Code**
   - Application type: **Client-side web app** (SPA / Javascript) so PKCE is used
   - Enable scopes needed for softphone + SMS (Embeddable typically needs WebRTC / Call Control style scopes the console suggests for “Embeddable” / browser phone + SMS). When in doubt, follow [Registering your application](https://ringcentral.github.io/ringcentral-embeddable/docs/app-registration/).
3. **OAuth Redirect URI** — add exactly:
   ```
   https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/redirect.html
   ```
4. Copy the **Client ID** (not the secret).
5. Production API server for Embeddable query param: `https://platform.ringcentral.com`  
   (optional override: `VITE_RINGCENTRAL_APP_SERVER`)

Docs: [Custom client ID](https://ringcentral.github.io/ringcentral-embeddable/docs/config/client-id/), [Redirect URI](https://ringcentral.github.io/ringcentral-embeddable/docs/config/redirect-uri/).

---

## Env vars (Vercel + local)

Frontend only (safe to expose in the browser):

```bash
VITE_RINGCENTRAL_CLIENT_ID=your_client_id_here
# optional — defaults to production:
# VITE_RINGCENTRAL_APP_SERVER=https://platform.ringcentral.com
```

**Vercel**

1. Project → **Settings → Environment Variables**
2. Add `VITE_RINGCENTRAL_CLIENT_ID` for **Production** (and Preview if you want)
3. **Redeploy** (Vite inlines env at build time)

**Local**

```bash
# .env.local
VITE_RINGCENTRAL_CLIENT_ID=...
```

Then `npm run dev`. Prefer `https` or localhost; browsers require a secure context for mic on real hosts.

---

## How users use it

1. Sign into the Tage portal as usual.
2. Open the **RingCentral badge** (bottom-right) → **Sign in** with your own RC credentials.
3. Allow **microphone** when the browser prompts.
4. On a Contact (or deal with a phone): click **Call** or **SMS**.

Each person must log into the widget as themselves — do not share one “team” softphone login.

---

## US SMS / 10DLC

Outbound SMS to US numbers generally requires:

- An SMS-capable RingCentral phone number
- **10DLC** brand + campaign registration (A2P) for application-to-person messaging

Until 10DLC / numbers are ready, voice softphone can still work; SMS may fail or be restricted by the carrier/RC account. Coordinate with the RC admin / carrier campaign registration outside this repo.

---

## Verify

- [ ] Client ID set on Vercel; portal redeployed
- [ ] Redirect URI registered on the RC app
- [ ] User can sign into the Embeddable badge on `https://portal.tagevc.com`
- [ ] Mic permission works on a test outbound call
- [ ] Contact **Call** opens dialer / places call; **SMS** opens compose
- [ ] After a test call placed from Contact **Call**, activity may show `call_logged` (best-effort)

---

## Typography (Open Sans) & iframe limits

Embeddable’s softphone UI runs inside `#rc-widget-adapter-frame`. Cross-origin iframes **do not inherit** the portal’s `font-family`, so we pass:

```
stylesUri=<portal origin>/rc-embeddable-styles.css
```

on `adapter.js` (see `buildAdapterScriptSrc` in `src/lib/ringcentral.ts`). That CSS `@import`s Google Fonts Open Sans and sets `font-family` on Embeddable roots / common panel classes ([RC custom styles docs](https://ringcentral.github.io/ringcentral-embeddable/docs/config/styles/)).

**Limits**

- `stylesUri` CSS applies inside the iframe only when RC can fetch the file (deployed portal HTTPS URL, or localhost during `npm run dev`).
- Some Embeddable internals (SVG dial glyphs, third-party bits) may keep non–Open Sans faces even after theming.
- Portal-controlled chrome (Call/SMS buttons, “not configured” hint, dock outside the iframe) is styled in `sales.css` with `var(--sans)`.

App icon branding for the softphone is configured separately (another change / RC app asset).

---

## Out of scope (later)

- Full native WebRTC SDK softphone
- Call lists / power dialer
- Reliable SMS sent/received activity + phone→contact matching
- Server-side RingCentral webhooks / JWT auth proxy
