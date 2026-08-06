# AI model preference (Grok default + Claude optional)

**Decision (Josh):** In-app model toggle is **Grok (default)** with **Claude optional**. Microsoft Copilot / M365 stays **external** — not an in-app provider option.

## Cascade

`user preferred` → `org default` → `platform default (grok)`

Pure resolver: `src/lib/ai/resolve.ts` (`resolveAiProviderPreference`).

## Where settings live

| Scope | UI | Storage |
|-------|----|---------|
| User | `/settings/ai` | `os_ai_user_prefs.preferred_provider` |
| Org | `/admin/ai` | `os_ai_org_settings` (`default_provider`, `claude_feature_enabled`) |
| Env fallback | — | `AI_ORG_DEFAULT_PROVIDER` / `AI_DEFAULT_PROVIDER` |

SQL: `supabase/phase_ai_model_preference.sql` (shared UDL; apply in Supabase).

Recruit 619 mirrors the same tables + also surfaces the user control on `/me/preferences`.

## Env vars

| Var | Role |
|-----|------|
| `XAI_API_KEY` / `GROK_API_KEY` | Grok (default provider) |
| `XAI_MODEL` / `XAI_BASE_URL` | Optional Grok tuning |
| `ANTHROPIC_API_KEY` | Claude key (vault / Vercel) — **no spend without this** |
| `ANTHROPIC_LIVE` or `CLAUDE_LIVE` or `AI_CLAUDE_ENABLED` | Spend gate (`1`/`true`) |
| `ANTHROPIC_MODEL` | Optional (default `claude-3-5-haiku-latest`) |
| `AI_CLAUDE_FEATURE` / `CLAUDE_FEATURE` | Show Claude in settings before LIVE |
| `AI_ORG_DEFAULT_PROVIDER` | Env org default when DB row missing (`grok`\|`claude`) |

## What is gated until Anthropic key

- Claude adapter **never** calls the Anthropic API without **key + LIVE/enabled flag** (fail-closed).
- Settings UI **hides** Claude unless key present, org `claude_feature_enabled`, or `AI_CLAUDE_FEATURE`.
- Preferring Claude while gated: Think Tank **falls back to Grok** (no Anthropic spend). Hard fail-closed available via `preferredChatCompletion({ fallbackToGrok: false })`.

## Out of scope

- Copilot as an in-app model toggle
- Instant NDA / Signent product UIs without Think Tank preference wiring (shared SQL + `src/lib/ai` spine can be copied when needed)

## Code map

- `src/lib/ai/*` — types, resolve, flags, grok/claude adapters, chat router, settings
- `src/lib/think-tank/llm.ts` — re-exports for existing Think Tank call sites
- Think Tank send path uses `preferredChatCompletion` with session user/org prefs
