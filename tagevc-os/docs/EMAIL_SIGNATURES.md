# Email signatures (Microsoft Outlook / M365)

**SoT HTML:** `brand/marketing-sot/email-signatures/`  
**Downloads:** `/Users/joshmonroe/Downloads/Brand Collateral/Email Signatures/`  
**Code:** `src/lib/brand/email-signatures/` · HRIS assist `src/lib/hris/email-signature-step.ts`

## Concept (all entities, future-proof)

Every signature includes a linked **logo bar of related companies**:

| Signer entity | Logo bar order |
| --- | --- |
| **Tage VC (ENT-FIRM)** | Parent → all subsidiaries |
| **Any subsidiary** | Employer → parent → sister companies |

Order is driven by `ENTITY_SELECT_PRIORITY_IDS` + logo catalog. Adding a new subsidiary to that list (and logo SoT) expands the bar without a one-off redesign.

Websites come from `getEntityBrandPresence` (`entity-brand-presence.ts`):

| Entity | Site |
| --- | --- |
| Tage Venture Capital | https://tagevc.com |
| Recruit 619 | https://recruit619.com |
| Signent HR | https://signenthr.com |
| Instant NDA | https://instantnda.us |

## People (priority)

| Person | Email / UPN | Entity | Title |
| --- | --- | --- | --- |
| Josh Monroe | joshmonroe@tagevc.com | ENT-FIRM (Tage VC) | Owner / CEO |
| Lauren Monroe | laurenmonroe@tagevc.com (Entra UPN/mail) | ENT-FIRM (Tage VC) | Principal Strategist |

Files (each person):

- `~/Downloads/{Name} Email Signature.html`
- `~/Downloads/Brand Collateral/Email Signatures/{Name}/`
- `brand/marketing-sot/email-signatures/people/{Name-Slug}/`

Both use the **parent portfolio logo-bar** (Tage → Recruit 619 → Signent HR → Instant NDA).

### Paste into Outlook (manual — works today)

1. Double-click `{Name} Email Signature.html` to open in a browser.
2. ⌘A → ⌘C.
3. **Outlook Mac:** Outlook → Settings → Email → Signatures → New → paste → assign to new + reply.
4. **Outlook on the web:** Settings → Mail → Compose and reply → Email signature → paste → Save.
5. **Outlook Windows:** File → Options → Mail → Signatures.

### M365 org / mailbox push

**Status: NEED_HUMAN (EXO)** — Microsoft Graph has **no** supported application API to write Outlook signatures (`mailboxSettings` does not include signature HTML). Do **not** claim Graph can set signatures.

Admin path (Exchange Online PowerShell — not Graph):

```powershell
Connect-ExchangeOnline -UserPrincipalName admin@tagevc.com
Set-MailboxMessageConfiguration -Identity 'joshmonroe@tagevc.com' `
  -SignatureHtml (Get-Content -Raw 'path/to/Josh-Monroe.fragment.html') `
  -AutoAddSignature $true `
  -AutoAddSignatureOnReply $true
Set-MailboxMessageConfiguration -Identity 'laurenmonroe@tagevc.com' `
  -SignatureHtml (Get-Content -Raw 'path/to/Lauren-Monroe.fragment.html') `
  -AutoAddSignature $true `
  -AutoAddSignatureOnReply $true
```

Do **not** apply to break-glass accounts. Bulk apply to all mailboxes requires Josh confirmation (ping before irreversible production sweep).

Optional gate: `EMAIL_SIGNATURE_APPLY=1` enables live assist attempts (still returns NEED_HUMAN until EXO wiring exists).

## HRIS onboarding

Template step `sd.email_sig` (“Configure email signature & Teams background”) is assisted via `system_hook` / step key match → `runEmailSignatureAssist`:

- Builds HTML from employee `entity_id` + name/title/email/phone
- Audits dry-run / NEED_HUMAN outcome
- Stores evidence note with ready HTML length for IT paste / EXO

Migration to set `system_hook = 'email_signature'` on `sd.email_sig` (idempotent): see `supabase/phase_email_signature_onboarding.sql`.

## Export script

```bash
npx tsx scripts/brand-collateral/export-email-signatures.ts
```

## Related

- Logos: `brand/marketing-sot/MANIFEST.md`, `src/lib/entities/logo.ts`
- Brand presence URLs: `src/lib/shared-services/entity-brand-presence.ts`
- Graph HRIS: `docs/MS_GRAPH_HRIS.md`
