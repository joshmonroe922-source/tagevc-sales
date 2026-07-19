# Finance documents

Sensitive source materials for the Accounting & Finance portal live here locally and are **gitignored**.

| File | Use |
|------|-----|
| `Finance and Accounting Functions and Audit.docx` | Seed source for `finance_control_templates` / migration `0027` |
| `_extracted.txt` | Plain-text extract (local) |
| `_seed_controls.py.out.sql` | Generated VALUES for migration seed (local) |

Do not commit `.docx` / PDF exports. Schema and seed SQL live in `supabase/migrations/0027_finance_accounting_audit.sql`.

See `SETUP_FINANCE.md` for portal routes and operations.
