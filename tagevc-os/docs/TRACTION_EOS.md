# Traction EOS — Tage VC + subsidiaries

## Product
Our Traction EOS (rocks, scorecard, IDS, Level 10, V/TO) on the shared UDL spine.

| Surface | Route | Left-nav label |
| --- | --- | --- |
| Tage VC | `/eos` | **Grow** → **Tage VC Performance Management** + under Shared Services → HR → Performance Management |
| Recruit 619 | `/desk/eos` (alias `/eos`) | **Grow** → **Performance Management** |
| Instant NDA | `/eos` | **Grow** → **Performance Management** |
| Signent HR | `/eos` | **Grow** → **Performance Management** |

Conceptually owned by **Human Resources**; shown under the **Grow** left-nav section (not only under the HR accordion). Grow also includes **Training & Development** (`/training`, R619 `/desk/training`).

On **Tage**, scope titles stay company-qualified (`Recruit 619 Performance Management`, etc.) so multi-entity rollups stay recognizable. Subsidiary portals omit the company prefix (single-entity).

## Spine / rollup
- Canonical tables: `os_eos_rocks`, `os_eos_issues`, `os_eos_todos`, `os_eos_scorecard_metrics`, `os_eos_scorecard_entries`, `os_eos_vto`
- Every row is **`entity_id`-scoped** (`ENT-FIRM`, `ENT-R619`, `ENT-INDA`, `ENT-SIGNENT`, …)
- Subsidiaries write their own `entity_id` on the shared UDL (sync = shared tables; no HTTP mirror required)
- Tage scope toggle: **Consolidated | Tage VC | Recruit 619 | Signent HR | Instant NDA**
  - Consolidated aggregates rock/issue/todo/scorecard rollups across operating entities
  - Writes require a single-company scope

## SQL
Apply once on the shared UDL:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tagevc-os/supabase/phase84_eos_operating_system.sql
```

Idempotent. Migrates existing `r619_eos_*` rows into `os_eos_*` when present. Mirror copies live in each subsidiary `supabase/` folder for clone scaffolds.

## Deploy IDs (Vercel)
| Portal | Project | Domain |
| --- | --- | --- |
| Tage | `tagevc-os` (`prj_ukSfCmpoKFS6VcgkW8LYhVG8ByDO`) | app.tagevc.com |
| Recruit 619 | `recruit619-portal` | portal.recruit619.com |
| Instant NDA | `instantnda-portal` | portal.instantnda.us |
| Signent HR | `signenthr-portal` (prod alias docs: `signent-hr-portal`) | portal.signenthr.com |

## Future entity clones
See `docs/SUBSIDIARY_OS_SHELL.md` — new OS shells must ship **Grow** with EOS nav label **Performance Management** on subsidiaries (plain) / `{Entity Name} Performance Management` on Tage, route `/eos`, **Training & Development** (`/training`), and hard-scope inserts to their `entity_id`.

Clones also inherit **A&F** (`{Entity Name} A&F` + Accounting · Finance · Audit · Controls). See `docs/TAGE_VC_AF.md` and `docs/SUBSIDIARY_OS_SHELL.md` § A&F.
