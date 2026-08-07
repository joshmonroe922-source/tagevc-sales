# Digital Business Cards (Tage OS spine)

**Status:** DC1–DC9 complete (phase98). Canonical host `card.tagevc.com` (`DIGITAL_CARD_HOST_READY=1`). App-host `/card/p/{public_id}` remains as fallback. QR images are self-hosted at `/api/card/qr/{public_id}`.

Replaces reprinting paper cards. Live profile URL behind a stable QR/NFC URL. Recipients need **no app**.

## Ownership

| Owner | Responsibility |
| --- | --- |
| **IT (Technology)** | Public pages, QR, exchange API, templates tech, domain, rate limits |
| **HR (HRIS)** | Activate on hire, revoke on term, seed title/work email/entity |
| **Employee** | My Card: phones, socials, photo, bio, default persona, tagged QR downloads |
| **Entity leadership** | Brand locks, default CTAs, optional insights |
| **Marketing (optional)** | CTA copy / campaign `src` values |

SSC UI stays Tage-only. Do **not** drop `os_store_snapshots`.

## URLs

| Purpose | Path |
| --- | --- |
| Canonical (preferred) | `https://card.tagevc.com/p/{public_id}` |
| App host (shipped) | `https://app.tagevc.com/card/p/{public_id}` |
| Short alias | `/p/{public_id}` → redirects to `/card/p/...` |
| Source tag | `?src=linkedin` (also `/l/linkedin`) |
| My Card | `/my-card` |
| Admin | `/admin/digital-cards` |
| Exchange API | `POST /api/card/exchange` |
| vCard | `GET /api/card/vcard/{public_id}?src=…` |

Portal deep-link (Recruit / Instant NDA): point at `https://app.tagevc.com/my-card`.

## Data model (phase98)

- `os_digital_card_personas` — stable `public_id`, shareable fields, revoke
- `os_network_contacts` — employee-owned inbound exchanges, source-tracked
- `os_digital_card_events` — view / save_vcard / exchange_submit / share_click / revoke_hit
- `os_digital_card_entity_templates` — locked theme, default CTA, routing defaults
- `os_digital_card_rate_limits` — service-role public intake buckets
- `os_recruit_card_lead_links` / `os_recruit_card_candidate_links` — human-confirmed Recruit stubs

## Security

- Public payload = shareable fields only (no secrets / comp / personal credit)
- Anon has **no** direct table access; service role for public read + intake
- Honeypot + rate limit + spam heuristics on exchange
- Offboard revoke is a public kill switch; contacts retained
- Live Look / RLS: no cross-entity contact leakage for non-managers

## HRIS

| Step | Hook |
| --- | --- |
| Activate digital business card | `digital_card_activate` / `sd.digital_card_activate` |
| Revoke digital business card | `digital_card_revoke` / `ex.digital_card_revoke` |

## Seed CTAs

| Entity | CTA |
| --- | --- |
| Tage VC | Explore our companies |
| Recruit 619 | Request talent / Find work |
| Signent HR | Talk to HR |
| Instant NDA | Send an NDA |

## Apply SQL

```bash
cd tagevc-os
set -a && source .env.local && set +a
node scripts/apply-phase98-digital-cards.mjs
```

## Click-test script

See **Click-test** section at the bottom of this file (also runnable manually).

## Out of scope

- Manufacturing NFC cards (blank NTAG URL = tagged public link; copy from My Card)
- Full Salesforce CRM replacement
- LinkedIn RSC / Recruiter sync
- Recipient must install an app
- Dot.cards / HiHello dependency

---

## Click-test

1. **Title edit / stable QR** — My Card → Edit title → Save → open public URL / scan QR → new title, same `public_id`.
2. **Scan + tap** — QR image is an `<a href={tagged profile}>`; tap on phone opens same profile as a scan.
3. **`?src=linkedin`** — open `/card/p/{id}?src=linkedin`, submit exchange → `os_digital_card_events` + contact `source_channel=linkedin`.
4. **Exchange → inbox** — submit Share my info → owner notification + contact under My Card → Network inbox.
5. **Revoke** — HRIS revoke or Admin force revoke → public page shows calm “No longer with {Company}” only.
6. **Recruit routing** — ENT-R619 contact with hiring/jobseek → Create Client Lead / Add General Interest (confirm dialog).
7. **Non-owner edit** — second user cannot update another’s persona (RLS / action guard).
8. **Spam controls** — fill honeypot `website` or hammer exchange → 400 / 429.
9. **Pipelines intact** — website intake, careers Path A, general résumé unchanged.
10. **Display names** — no primary `ENT-*` labels on public card or My Card.
