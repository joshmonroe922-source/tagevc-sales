# Document Library — visibility & role ACL

## Nav
- **Shared Services → Admin → Document Library** (`/documents`)
- Deep links and routes unchanged (`/documents`, `/documents/entities/:id`, `/documents/:docId`)
- Active `/documents*` keeps the Shared Services + Admin accordions open

## Visibility layers
1. **Module** — `read:documents` / nav module `documents`
2. **Entity scope** — subsidiary roles only see their company (pipeline scope)
3. **Role ACL** — folder defaults + optional per-file `visible_roles`
4. **Full library bypass** — Visionary and Admin always see the whole library

## Folder defaults
| Folder | Default |
|--------|---------|
| `01_Corporate` … `04_Financials`, `06_Ops`, `07_Signed` | Open |
| `05_HR` | COO, Service Lead, Counsel/Ops (+ Visionary/Admin) |

## Per-file ACL (`visible_roles`)
- `null` — inherit folder default
- `[]` — explicitly open to all document-capable roles
- `[role, …]` — only those roles (+ Visionary/Admin)

## Who can set ACL
**Visionary** and **Admin** only — on upload / create-from-template, or on the document detail **Role access** card.

## Whole library view
Open **Shared Services → Admin → Document Library** (`/documents`).
- Visionary/Admin: banner **Whole library view** + every file
- Other roles: banner **Role-filtered view** + only allowed folders/files

## Entity sections
`listDocumentLibraryEntities()` drives the folder cards / upload company list:
- **ENT-FIRM** — Tage Venture Capital (firm-level docs)
- Operating subsidiaries (Recruit 619, Instant NDA, Signent HR, …)
- Same entity/pipeline scope as the rest of the library (firm-wide roles see all; subsidiary-scoped roles only their company)

SQL: `supabase/phase80_document_visible_roles.sql` (optional until applied; app still enforces ACL in memory).
