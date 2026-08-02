# DocuSign — entity sync + automation spine (D01)

**Status:** Org account ready with **all four entities** as DocuSign accounts. LIVE connect + mapping is the priority this week; other partners stay dry-run until contracts land.

## Entity ↔ DocuSign account map

| Tage entity | Code | DocuSign account id (env / binding) |
|-------------|------|-------------------------------------|
| Tage Venture Capital | `ENT-FIRM` | `DOCUSIGN_ACCOUNT_ID` or `DOCUSIGN_ACCOUNT_ID_FIRM` · binding `external_account_id` |
| Recruit 619 | `ENT-R619` | `DOCUSIGN_ACCOUNT_ID_R619` |
| Signent HR | `ENT-SIGNENT` | `DOCUSIGN_ACCOUNT_ID_SIGNENT` |
| Instant NDA | `ENT-INDA` | `DOCUSIGN_ACCOUNT_ID_INDA` |

Shared Integration Key / JWT user can impersonate per account when configured. Bindings live on `os_partner_entity_bindings` (`partner_key = docusign`).

Code: `src/lib/docusign/entity-accounts.ts` · lifecycle hook `ensure_docusign_account_binding`.

## Automation spine (library → sign → library → record)

```
Document Library template
        │
        ▼
Autofill from record (employee / vendor / deal / client_org)
        │
        ▼
Send envelope (entity DocuSign account)
        │
        ▼
Connect webhook → status events
        │
        ▼
Pull signed PDF → Document Library
        │
        ▼
Attach to DB record (HRIS step, AP vendor, matter, etc.)
```

Seams:

| Step | Code / route |
|------|----------------|
| Config / JWT | `src/lib/docusign/config.ts`, `jwt.ts` |
| Entity account resolve | `src/lib/docusign/entity-accounts.ts` |
| Send | `src/lib/docusign/send.ts`, HRIS `docusign-step.ts` |
| Connect webhook | `/api/docusign/connect` |
| Signed pull-back | `src/lib/docusign/signed-docs.ts` |
| Automation plan (scaffold) | `src/lib/docusign/automation-spine.ts` |

## Josh checklist

**Full paste pack:** [`docs/DOCUSIGN_JOSH_CHECKLIST.md`](./DOCUSIGN_JOSH_CHECKLIST.md)

1. Apps and Keys → Integration Key + RSA → `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_PRIVATE_KEY`, `DOCUSIGN_USER_ID`
2. Set default + per-entity account IDs (table above)
3. OAuth host / base path (demo vs prod)
4. JWT consent once (impersonation + signature scopes)
5. Connect → **`https://app.tagevc.com/api/docusign/webhook`** + `DOCUSIGN_CONNECT_HMAC_SECRET`
6. Confirm each entity account appears under Technology → Partner stack / Legal → DocuSign

## Hold LIVE for others

Dialpad, Gusto, Marketing presence, etc. stay fail-closed until Josh reports each contract is secured this week.
