# Tage VC A&F — platform spine

In-portal **Accounting & Finance** scaffold shared across Tage VC and every
subsidiary / future operating system. Replaces / moves off IES for portal A&F
over time; placeholders are intentional until full product instructions land.

## Standard sections

Siblings under Shared Services / A&F (or `{Entity Name} A&F` on subsidiaries):

1. **Accounting** — `/shared-services/af/accounting`
2. **Finance** — `/shared-services/af/finance`
3. **Audit** — `/shared-services/af/audit`
4. **Controls, Security & Governance** — `/shared-services/af/controls`

Hub: `/shared-services/af`.

## Surfaces

| Portal | Nav label | Notes |
| --- | --- | --- |
| Tage VC | **Tage VC A&F** | Nested under Shared Services; Finance SSC gate |
| Recruit 619 | **Recruit 619 A&F** | Spine section in left nav |
| Instant NDA | **Instant NDA A&F** | Flat MAIN_NAV + hub children |
| Signent HR | **Signent HR A&F** | Flat MAIN_NAV + hub children |
| Future clones | **`{Entity Name} A&F`** | Inherit via `src/lib/platform/af/` |

## Platform wiring

Same copy pattern as AppTopBarShell / `SUBSIDIARY_OS_SHELL`:

- Source of truth: `tagevc-os/src/lib/platform/af/`
- Builders: `buildAfNavBranch` (nested) · `buildAfNavFlat` (flat sidebars) · `buildAfNavSectionItems` (Recruit 619 sections)
- Docs: `docs/SUBSIDIARY_OS_SHELL.md` § A&F

Future OS clones **must** ship these four sections — do not invent a Tage-only
A&F nav shape.

