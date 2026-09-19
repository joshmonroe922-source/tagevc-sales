# Entity repo architecture

**Separate companies. Connect data. Not one mega-repo.**

Tage, Recruit 619, Signent HR, and Instant NDA are four legal entities. They share a Tage VC Unified Data Layer while Josh operates them. They do **not** share a git repo, a Cursor workspace, or a Vercel project.

Shared Postgres is an API / `entity_id` contract. It is not a reason to merge source.

## Canonical map

| Entity | `entity_id` | Marketing repo | OS / product repo(s) | Public / portal |
| --- | --- | --- | --- | --- |
| Tage VC (holding) | `ENT-FIRM` | `tagevc-website` | `tagevc-sales` (`tagevc-os`) | tageventurecapital.com / app.tagevc.com |
| Recruit 619 | `ENT-R619` | `recruit619-website` | `recruit619-portal` | recruit619.com / portal.recruit619.com |
| Signent HR | `ENT-SIGNENT` | `signent-hr` | `signenthr-portal` (GitHub: `signent-hr-portal`) | signenthr.com / portal.signenthr.com |
| Instant NDA | `ENT-INDA` | `instantnda-website` | `instantnda-portal` + `InstaNDA` (consumer app) | instantnda.us / portal.instantnda.us / app.instantnda.us |

Tage Systems and Tage Technologies stay their own marketing repos. They are not operating companies you would sell with Recruit.

Local path for Signent’s OS is **`/Users/joshmonroe/Projects/signenthr-portal`**. Do not open `signent-hr-portal` — that folder is a pointer only.

## Layers

| Layer | Keep together? |
| --- | --- |
| One legal entity’s OS/portal | Own repo + own Vercel project |
| That entity’s marketing site | Own repo + own Vercel project — not inside the OS |
| Instant NDA consumer app | Own repo, separate from portal and marketing |
| Tage VC OS | Own repo; **only** app allowed to see all entities |
| Cross-entity data | HTTPS APIs + `entity_id`. Never a shared git repo |

- **Cursor project** = one folder / one repo. Do not multi-root all four OSes.
- **GitHub repo** = the transfer unit in a sale.
- **Vercel project** = one deployable app, root = that app. Never another brand in a `web/` subdirectory.
- **Supabase / Stripe / Resend / Gusto / DocuSign** = the real sale blockers. Per-entity or exportable.

## Website → OS

A public site talks only to **its own** OS over HTTPS (form POST, webhook, or a small public API). It must not import portal code or use another company’s `DATABASE_URL`.

1. Visitor submits on that brand’s apex domain.
2. The website API writes a lead into that brand’s OS (Tage intake only when the site is Tage’s).
3. If Recruit needs a Signent lead, Recruit does not read Signent’s database. Signent or Tage emits an event the other OS may call.

Current intake:

| Site | Writes to |
| --- | --- |
| `tagevc-website` | Tage OS `POST /api/deal-flow/website-intake` (`docs/LEAD_GEN_SPINE.md`) |
| `recruit619-website` | Recruit portal public APIs (`portal.recruit619.com`) |
| `signent-hr` | Signent inbox `hello@signenthr.com` (own brand — not Instant NDA) |
| `instantnda-website` | Instant NDA `request-enterprise` edge function (own Supabase) |

Sister-brand links on a marketing site are navigation only. They are not a data bus.

## What not to do

- Do not merge the four portals because they share a shell or a database. Copy `src/lib/platform/shell/` when cloning an entity (`docs/SUBSIDIARY_OS_SHELL.md`).
- Do not nest a marketing site inside an OS or consumer-app repo.
- Do not point two brands at one Vercel project.
- Do not put Recruit + Signent + Instant source inside a Tage Technologies monorepo. Tage owns **shared services as APIs**.

## Sale

See [ENTITY_SALE_CHECKLIST.md](./ENTITY_SALE_CHECKLIST.md).
