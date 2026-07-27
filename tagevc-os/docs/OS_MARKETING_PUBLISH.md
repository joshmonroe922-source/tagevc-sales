# Marketing publish desk — hook up social + blog

Operator surface: **Shared Services → Marketing** (Publish desk at top).

## Hookup steps

1. **Vault** — set `MARKETING_TOKEN_SECRET` (16+ chars) in Vercel production.
2. **App credentials** (per channel you want LIVE) in Vercel, then redeploy:

| Channel | Env | Publish LIVE when connected? |
|---------|-----|------------------------------|
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Yes |
| X | `X_CLIENT_ID`, `X_CLIENT_SECRET` | Yes |
| Facebook | `META_APP_ID`, `META_APP_SECRET` | Yes (user feed; Page token preferred) |
| Instagram | Meta app same as Facebook | **Scaffold** — OAuth UI only; Graph publish not LIVE |
| YouTube | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | **Scaffold** — OAuth only; upload stub |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | LIVE when `TIKTOK_PUBLISH_DIRECT=1` (+ video URL or resumable upload) |
| Blog / CMS | `BLOG_PUBLISH_WEBHOOK_URL` (+ optional `BLOG_PUBLISH_WEBHOOK_SECRET`) | LIVE when webhook set |

3. **OAuth redirect URIs** in each developer console:

```
https://app.tagevc.com/api/marketing/oauth/{platform}/callback
```

Platforms: `linkedin` · `x` · `facebook` · `instagram` · `youtube` · `tiktok`.

4. **In the OS** — Publish desk → pick brand (Tage VC, Recruit 619, Signent HR, Instant NDA) → register handle → **Connect** (OAuth) or **Mark blog ready**.
5. **Compose** — one body, multi-channel checkboxes → Publish now or Schedule. Unconnected channels save as approved drafts (not queued).

## Honest status

- Channel cards show **LIVE** / **Scaffold** / **Needs keys** from server env — not marketing fluff.
- Stub connect requires `MARKETING_ALLOW_STUB_OAUTH=1` (dev only).
- Stub publish without a connected account requires `MARKETING_ALLOW_STUB_PUBLISH=1`.

## Blog webhook payload

`POST` JSON to `BLOG_PUBLISH_WEBHOOK_URL`:

```json
{
  "source": "tagevc-os-marketing",
  "handle": "site-slug",
  "title": "…",
  "body": "…",
  "media_url": null,
  "account_id": "MSA-…",
  "published_at": "ISO-8601"
}
```

Optional auth: `Authorization: Bearer <BLOG_PUBLISH_WEBHOOK_SECRET>` and `X-Tage-Signature` (HMAC-SHA256 hex of body).
