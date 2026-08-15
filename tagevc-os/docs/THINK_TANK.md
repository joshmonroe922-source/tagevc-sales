# Think Tank — Instant NDA / Recruit 619 / Signent HR / Tage VC

## Research (original)
- **Tage Vite CRM** (`tagevc-sales`): Edge `think-tank-chat` + `think_tank_conversations` / messages; personal + entity scopes; `XAI_API_KEY` → `api.x.ai/v1/chat/completions`; owner oversight email (hidden from UI).
- **My Recruiting Desk** (`Recruiting Tools`): Next.js + Prisma `ThinkTankConversation`; role bands recruiter/manager/leadership; prefer xAI via `llm.ts`.

## Ported vs redesigned
| Kept | Redesigned |
|------|------------|
| Grok via xAI chat completions | Next.js server actions (no Edge required for OS portals) |
| Persistent personal thread | **Many named threads** per user + portal + entity OS |
| Role-aware system prompts | Live portal context collectors per subsidiary OS |
| Fail soft without key | Real-user thread under Visionary view-as |
| — | PDF/Word/Excel/CSV/TXT upload as **thread-only** AI context |

## Data model (Tage UDL)
- `os_think_tank_conversations` — `(portal_key, profile_id, entity_os)` scoped; **no** unique one-thread constraint
- `os_think_tank_messages` — user/assistant (+ optional system)
- `os_think_tank_attachments` — private `os-think-tank` bucket; extracted text for that conversation only

portal_key slugs: `tage` | `r619` | `inda` | `signent` | future clones

`entity_os`: Tage Entity OS switcher lock (`ENT-FIRM` when unlocked). Subsidiary portals pin to their `ENT-*`. **Do not leak** R619 portal threads into Tage or vice versa.

## Portable twin (future clones)

Copy `src/lib/platform/think-tank/` into the new OS. See that folder’s `README.md` and `docs/SUBSIDIARY_OS_SHELL.md` § Think Tank.

SQL once on shared UDL: `supabase/phase107_think_tank_threads.sql`. Word/Excel bucket MIME: `supabase/phase108_think_tank_office_mimes.sql`.

## API surface (each portal)
- `loadThinkTankDeskAction(conversationId?)` — thread list + active messages/attachments
- `sendThinkTankChat(conversationId, message)` — resume or create
- `createThinkTankThreadAction` / `renameThinkTankThreadAction`
- `uploadThinkTankAttachmentAction` / `removeThinkTankAttachmentAction`
- Auth: session required; thread owned by real profile id
- Rate limit: 12 user msgs / minute / conversation
- Advise only — no privileged side effects
- **Home TTFB:** do not `await` Think Tank on the server page; the desk hydrates client-side

## UI
| Portal | Route | Entry |
|--------|-------|-------|
| Instant NDA | `/think-tank` → `/home` | Home |
| Recruit 619 | `/think-tank` → desk home | My Recruiting Desk |
| Signent HR | `/think-tank` → `/home` | Home |
| Tage VC | `/think-tank` → `/home` | Home |

Thread list (left): switch, **New thread** (does not wipe history), rename. Attach PDF, Word (`.doc`/`.docx`), Excel (`.xls`/`.xlsx`), or CSV to the active thread only. PDFs are parsed with `unpdf` (serverless PDF.js) — first 20 pages / 40k chars — so FlateDecode and object-stream files yield a real text layer. Scanned/image-only PDFs get a no-text-layer note rather than empty context. Spreadsheets are turned into a capped sheet-name + cell dump for the model.

## Env
`XAI_API_KEY` (or `GROK_API_KEY`), optional `XAI_MODEL` (default `grok-3-mini`), `XAI_BASE_URL`

## Deploy checklist
1. Apply SQL once on the shared UDL DB: `tagevc-os/supabase/phase107_think_tank_threads.sql`. Word/Excel MIME allowlist: `phase108_think_tank_office_mimes.sql`.
2. Set `XAI_API_KEY` in each portal Vercel env (Preview + Production). Optional: `XAI_MODEL`, `XAI_BASE_URL`.
3. Smoke: open Home Think Tank, send a chip prompt, **New thread**, switch back, refresh — history remains. Upload a PDF, `.docx`, and `.xlsx` and ask about each file.
4. Visionary Entity OS: threads in Recruit 619 OS stay out of Tage VC OS.
5. Visionary view-as: thread stays on the real Visionary profile (advise-only; no privileged actions).
