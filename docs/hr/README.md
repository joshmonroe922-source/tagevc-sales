# HR audit & onboarding source materials

Place the **HR Compliance Audit** PDF/workbook and onboarding checklists here for local agent work.

- Files matching `*.pdf` / `*.docx` / `*.xlsx` / `*.csv` are **gitignored** (sensitive).
- Control seeds from the audit live in `supabase/migrations/0025_hr_compliance_audit_and_employee_files.sql`.
- Talent acquisition + Signent onboarding templates: `supabase/migrations/0035_hr_talent_acquisition_onboarding.sql`
- Parse notes: `_onboarding_checklist_notes.md`, extracted text: `_onboarding_extracted.txt`
- Portal review: `/sales/hr/compliance` (company-scoped matrix) and `/sales/hr/employees/:id` (employee files).
