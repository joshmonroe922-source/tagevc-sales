# OS Brand Assets (Marketing SoT)

**Do not re-upload logos from this doc.** Logos are already in the Marketing document library and Supabase storage. This page documents paths and the `getEntityLogo` resolver only.

## Source of truth

| Layer | Location |
| --- | --- |
| UI | https://app.tagevc.com/documents → **Marketing / Brand** |
| Storage | `brand-assets/marketing-sot/{entity_id}/` |
| Public base | `https://opdqybaatfbwkokbzwli.supabase.co/storage/v1/object/public/brand-assets/marketing-sot/` |
| Local app | `public/brand/{entity_id}/` |
| Manifest | `brand/marketing-sot/MANIFEST.md` |
| Signent Downloads copy | `~/Downloads/Signent HR Logos/` |

**Family colors (Signent / shared gold-navy):** gold `#B2A384` · navy `#3B4559` · white `#FFFFFF`

## Resolver

```ts
import { getEntityLogo } from '@/lib/entities/logo';

getEntityLogo('ENT-FIRM', 'primary'); // light rectangle
getEntityLogo('ENT-R619', 'icon');
getEntityLogo('ENT-SIGNENT', 'primary', { surface: 'dark' });
getEntityLogo('ENT-INDA', 'icon'); // badge
```

| Entity | Primary (light) | Icon / alt |
| --- | --- | --- |
| Tage Venture Capital (`ENT-FIRM`) | gold-blue-on-white | dark: gold-white-on-navy |
| Recruit 619 (`ENT-R619`) | gold-on-white | icon: blue-on-white · dark: gold-on-navy |
| Signent HR (`ENT-SIGNENT`) | gold-on-white | icon: navy-on-white · dark: gold-on-navy |
| Instant NDA (`ENT-INDA`) | horizontal | icon: badge · dark: horizontal-outlined |

Coverage check: `assertBrandLogoCoverage()` (unit-tested). Expected: **11** files across four entities.

## Paths (filenames)

See `brand/marketing-sot/MANIFEST.md` for doc IDs + public URLs. Local mirrors:

- `public/brand/ENT-FIRM/tagevc-logo-*.png` (2)
- `public/brand/ENT-R619/recruit619-logo-*.png` (3)
- `public/brand/ENT-INDA/instantnda-*.png` (3)
- `public/brand/ENT-SIGNENT/signent-hr-logo-*.png` (3)

## Exit criteria

- [x] Resolver returns primary + icon for all four entities
- [x] Public storage URLs return HTTP 200 (verified)
- [x] No bulk re-seed / re-upload from this pass
