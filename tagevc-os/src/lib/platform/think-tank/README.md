# Think Tank — portable twin (copy into each new OS)

Multi-thread AI desk with document upload. Canonical implementation lives in
Tage OS (`src/lib/platform/think-tank/`). **Copy this folder** into every
subsidiary clone (Recruit 619, Instant NDA, Signent HR, future OS) under the
same path.

See also: `docs/THINK_TANK.md`, `docs/SUBSIDIARY_OS_SHELL.md`.

## What clones get

| File | Role |
| --- | --- |
| `types.ts` | DTOs, portal keys, size limits |
| `scope.ts` | `thinkTankEntityOs` — portal + Entity OS isolation |
| `threads.ts` | list / create / rename / send (UDL tables) |
| `attachments.ts` | upload / list / extract text (`os-think-tank` bucket) |
| `extract-text.ts` | PDF via unpdf (serverless PDF.js) / Word / Excel / CSV / TXT harvest |
| `think-tank-desk.tsx` | UI: thread list, switch, rename, attach |
| `think-tank-threads.sql` | same DDL as Tage `supabase/phase107_think_tank_threads.sql` (+ Word/Excel MIME) |

SQL is applied **once** on the shared UDL DB (`opdqybaatfbwkokbzwli`). Do not
re-apply per portal. Do not invent a second thread table.

## Isolation (do not leak)

| Axis | How |
| --- | --- |
| User | RLS `profile_id = auth.uid()` |
| Product / portal | `portal_key` (`tage` · `r619` · `inda` · `signent` · future slug) |
| Entity OS (Tage switcher) | `entity_os` (`ENT-FIRM` when unlocked, else the lock) |

A Visionary in Tage → Recruit 619 OS must **not** see threads from the Recruit
619 portal (`r619` key), and vice versa. Messaging reach is unchanged (person,
not OS).

## Wire in the clone

1. Copy this folder → `src/lib/platform/think-tank/`.
2. Keep portal-specific `src/lib/think-tank/prompts.ts` + `context.ts`.
3. Point `src/lib/think-tank/service.ts` at `threads.ts` / `attachments.ts`
   with the clone’s `PORTAL_KEY` and LLM (`preferredChatCompletion` or Grok).
4. Replace `ThinkTankClient` with a thin wrapper around `ThinkTankDesk`.
5. **Home TTFB:** do **not** `await loadThinkTank()` in the server page.
   Mount `<ThinkTankClient />` and let it fetch on the client (same idea as
   R619 `#207` — defer AI, don’t block metrics).

### Server actions the desk expects

```ts
loadThinkTankDesk(conversationId?: string | null)
sendThinkTankChat(conversationId: string | null, message: string)
createThinkTankThread(title?: string)
renameThinkTankThread(conversationId: string, title: string)
uploadThinkTankAttachment(formData: FormData)  // fields: file, optional conversationId
removeThinkTankAttachment(attachmentId: string)
```

## UX

- **Thread list** on refresh / new thread (history is never wiped).
- **New thread** creates an empty named thread; old threads stay.
- **Rename** (pencil) — e.g. “Alex desk”, “Strategy”, “Personal execution”.
- **Attach** PDF/Word/Excel/CSV/TXT to the **active thread only**. PDF text is
  extracted with `unpdf` (first 20 pages / 40k chars). Spreadsheets become a
  capped sheet-name + cell dump. Image-only scans get a no-text-layer note
  instead of fake content. Clones must `npm install unpdf`.

## Future clone portal_key

Use a lowercase slug (`acme`, `northstar`, …). `entity_os` is the clone’s
`ENT-*`. No SQL enum change required (`portal_key` is a slug check).
