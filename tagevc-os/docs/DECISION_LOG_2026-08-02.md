# Tage OS decision log — 2026-08-02 (plain language)

Josh answered the open product/policy questions. This log is the source of truth for what we build next. Instant NDA product work stays untouched.

| ID | Decision | What it means in practice |
|----|----------|---------------------------|
| **D01** | Hold most partner LIVE flags; connect as contracts land this week. **DocuSign is ready now.** | Keep Dialpad/Gusto/marketing/etc. fail-closed until Josh reports a signed contract. Prioritize DocuSign: map all 4 Tage entities ↔ DocuSign accounts, then automate library → autofill → e-sign → return to library → attach to DB records. |
| **D02 = A** | Apply empty Signent client tenancy **now**. Capture the full Signent HR OS vision. | Ship `client_org_id` + RLS seams with **no fake clients**. Build Sales + Ops portal architecture docs; sales selects features → invoice → lead becomes client → PO/products sync → autofill forms → electronic HR audit → AI findings (ops edit before client share) → upsell proposals. Maximize LTV with AI (documented). |
| **D03 = YES** | Signent is a wholly owned sub of Tage Global. | Hire via Tage OS HR Shared Services (same as R619/INDA) but employed by Signent. Operate at **portal.signenthr.com**; marketing site **www.signenthr.com**. |
| **D04 = A** | Freeze new Tech Stack commercial writes. | Technology Stack contracts/payments become read-only with clear redirect to Vendor Management. Write-through (option B) can come later if needed. |
| **D05 = B + AP/W-9 automation** | Auto-create AP vendor when VM vendor is Active; build invoice inbox + W-9 campaign seams. | Entity-specific invoice emails → AP portal; W-9 request button + annual campaign (tasks, bulk send, weekly reminders); AI year check + AP exception path; expense/cash forecast report shells. **Honest about email:** seams + DNS/mailbox checklist for Josh — no invented credentials. |
| **D06** | Josh needs a clearer explanation first. | **Do not implement a guess.** Parent will re-explain. Leave pending. |
| **D07 = B** | Soft stop on onboarding when partner hooks are not live. | Notify Visionary + HR; allow override with audit note; emphasize automation health alerts. |
| **D08** | Tage VC only for deal → entity/portfolio approve. | Toggle on Tage VC employee onboarding (default Visionary; expandable later). |
| **D09 = C** | Separate LMS per entity. | Not Recruit-619-only system of record. Reflect in training architecture. |
| **D10 = B** | Keep work queues separate + glossary. | Each Shared Service home shows outstanding tickets for that SS. **Bug fix:** outstanding items must be clickable through to completion. |
| **D11 = C** | Ban marketing stubs entirely. | No auto-stub even in non-prod. |
| **D12 = A** | Label scopes in UI only for net worth / assets. | Clarify Personal vs Assets Net Worth labels; no IA collapse. |

## Needs Josh (credentials / DNS)

1. DocuSign Integration Key, User ID, Account ID(s) per entity, private key, Connect webhook secret.
2. Per-entity DocuSign account IDs for ENT-FIRM / ENT-R619 / ENT-SIGNENT / ENT-INDA bindings.
3. Invoice inbound mailboxes (DNS + provider): prefer `invoices@{entity-domain}` or `ap+{entity}@tagevc.com` parsed by Resend/Postmark/Google Group into AP.
4. Outbound W-9 request From address(es) and reply parsing path.
5. D06 answer after re-explain.
6. Partner LIVE flags as each contract closes this week.

## Related docs / code

- `docs/PARTNER_SPINE.md` — DocuSign connect + entity mapping
- `docs/HRIS_SPINE.md` + `docs/SIGNENT_HR_OS_VISION.md` — Signent model + LTV
- `docs/CONTRACTS_PAYMENTS_SOR.md` — Tech Stack freeze
- `docs/AP_INVOICE_W9_SPINE.md` — AP inbox / W-9 / forecasts
- `docs/WORK_QUEUE_GLOSSARY.md` — queues stay separate
- `supabase/phase91_signent_client_tenancy.sql` — empty client tenancy
- `supabase/phase91_ap_w9_invoice_spine.sql` — AP/W-9 scaffold tables
