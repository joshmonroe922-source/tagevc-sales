# Technology documents

Sensitive source materials for the Technology portal live here locally and are **gitignored**.

| File | Use |
|------|-----|
| `Technology Plan and Audit.docx` | Seed source for `technology_control_templates` / migration `0029` |
| `_extracted.txt` | Plain-text extract (local) |
| `_seed_controls.py.out.sql` | Generated VALUES for migration seed (local) |
| `_control_meta.txt` | Control count summary (local) |

Do not commit `.docx` / PDF exports. Schema and seed SQL live in `supabase/migrations/0029_technology_plan_audit.sql`.

See `SETUP_TECHNOLOGY.md` for portal routes and operations.
