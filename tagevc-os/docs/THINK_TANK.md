# Think Tank — Instant NDA / Recruit 619 / Tage VC

## Research (original)
- **Tage Vite CRM** (`tagevc-sales`): Edge `think-tank-chat` + `think_tank_conversations` / messages; personal + entity scopes; `XAI_API_KEY` → `api.x.ai/v1/chat/completions`; owner oversight email (hidden from UI).
- **My Recruiting Desk** (`Recruiting Tools`): Next.js + Prisma `ThinkTankConversation`; role bands recruiter/manager/leadership; prefer xAI via `llm.ts`.

## Ported vs redesigned
| Kept | Redesigned |
|------|------------|
| Grok via xAI chat completions | Next.js server actions (no Edge required for OS portals) |
| Persistent personal thread | Shared UDL tables `os_think_tank_*` with `portal_key` |
| Role-aware system prompts | Live portal context collectors per subsidiary OS |
| Fail soft without key | Real-user thread under Visionary view-as |

## Data model (Tage UDL)
- `os_think_tank_conversations` — unique `(portal_key, profile_id)`
- `os_think_tank_messages` — user/assistant (+ optional system)

portal_key: `tage` | `r619` | `inda`

## API surface (each portal)
- Server actions: `loadThinkTank`, `sendThinkTankChat`, `resetThinkTankThread`
- Auth: session required; thread owned by real profile id
- Rate limit: 12 user msgs / minute / conversation
- Advise only — no privileged side effects

## UI
| Portal | Route | Entry |
|--------|-------|-------|
| Instant NDA | `/think-tank` | Nav + Home |
| Recruit 619 | `/think-tank` | Nav + My Desk |
| Tage VC | `/think-tank` | Nav + Command Center |

## Env
`XAI_API_KEY` (or `GROK_API_KEY`), optional `XAI_MODEL` (default `grok-3-mini`), `XAI_BASE_URL`
