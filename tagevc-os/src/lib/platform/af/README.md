# Platform A&F — copy into every entity OS

Canonical Accounting & Finance spine for Tage VC and all subsidiary / future OS clones.

| File | Purpose |
| --- | --- |
| `sections.ts` | Four sibling sections + hub path + `{Entity} A&F` label helper |
| `nav.ts` | Nested / flat / section-list nav builders |
| `index.ts` | Re-exports |

## Required routes

```
/shared-services/af                 # hub
/shared-services/af/accounting
/shared-services/af/finance
/shared-services/af/audit
/shared-services/af/controls
```

## Nav branding

| Portal | Left-nav parent |
| --- | --- |
| Tage VC | Shared Services → **Tage VC A&F** (nested accordion) |
| Recruit 619 | Section **Recruit 619 A&F** (or Shared Services A&F if that naming is already used) |
| Instant NDA | **Instant NDA A&F** (+ flat section siblings) |
| Signent HR | **Signent HR A&F** (+ flat section siblings) |
| Future clone | **`{Entity Name} A&F`** with the same four sections |

See `docs/SUBSIDIARY_OS_SHELL.md` § A&F and `docs/TAGE_VC_AF.md`.
