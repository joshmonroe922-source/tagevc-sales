# Phase 72 — HRIS deepen (pre-Signent)

Additive on Phase 68 foundation + Phase 71 mailbox scaffold.

## Deepened vs already existed

| Area | Existed (68/71) | Deepened (72) |
|------|-----------------|---------------|
| Employees / templates / runs / steps / events | Yes | Comp fields, manager_profile_id |
| r619 onboarding/offboarding templates | Yes | Hooks: graph_provision, mailbox_grant, docusign_send |
| Dennis test employee + run | Yes | Propagate missing steps + sync hooks |
| Cadence + overdue → HR tickets | Yes | Unchanged; still exercised |
| Visionary mailbox step | Scaffold | Assist dispatch + existing-employee pass |
| Graph joiner | — | Opt-in create/update + evidence |
| Document vault | Links stub | `os_hris_documents` + `hris-private` bucket |
| DocuSign from HRIS | Legal stack only | Offer/NDA step send with human confirm |
| Manager self-service | — | `/shared-services/hr/manager` |
| IT child runs | Link kinds typed | Auto-link on start onboarding/offboarding |

## Signent readiness gaps (still open)

1. Multi-tenant Signent HR OS product surface (not built — intentional)
2. Live Graph User.ReadWrite.All + Exchange.ManageAsApp admin consent in production
3. Live DocuSign JWT for HRIS offer/NDA (mock works without secrets)
4. Payroll / benefits providers + I-9 eVerify automation
5. Recruit commission calc consuming protected comp fields
6. Full employee portal (self-service docs, tax forms) beyond manager steps
7. Cross-entity Signent tenancy + white-label checklist packs
8. Hardening: storage RLS beyond firm-wide for entity-scoped HR ops
9. Signed PDF pull-back from DocuSign into vault (status recorded; archive sync later)
10. Manager assignment UX (today: paste profile UUID)

## Apply

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tagevc-os/supabase/phase72_hris_deepen.sql
```

Env (optional live assists): see `docs/MS_GRAPH_HRIS.md`
