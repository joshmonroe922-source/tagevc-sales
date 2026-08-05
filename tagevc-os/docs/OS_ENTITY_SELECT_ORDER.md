# Entity / company select order

Canonical order for **every** company/entity scope dropdown (SSC, Portfolio filters, dashboards, reports, credit, messaging, etc.):

1. **Consolidated** (only when the control supports multi-entity rollup)
2. **Tage Venture Capital** (`ENT-FIRM`) — IES `9341457251412290`
3. **Recruit 619** (`ENT-R619`) — IES `9341457251406251`
4. **Signent HR** (`ENT-SIGNENT`) — IES `9341457251424506`
5. **Instant NDA** (`ENT-INDA`) — IES `9341457533727282`
6. Any future entities — append **A–Z by display name**

## Helper

```ts
import { sortEntitiesForSelect } from '@/lib/entities/display-order';
import { entityDisplayName, entityLabel } from '@/lib/entities/display-name';
import { EntityBadge } from '@/components/entities/entity-badge';

const ordered = sortEntitiesForSelect(entities);
const label = entityLabel(entity); // or entityDisplayName(entity)
```

- Single shared module: `src/lib/entities/display-order.ts`
- Display names: `src/lib/entities/display-name.ts` (`entityDisplayName` / `entityLabel`)
- UI badge: `src/components/entities/entity-badge.tsx`
- `CompanySelect` applies this order by default (`allowConsolidated` prepends Consolidated)
- Labels are company display names — never raw `ENT-*` as the primary label
- Entity options for SSC are cached in `src/lib/entities/entity-select-cache.ts` (TTL) so function navigation does not refetch a full directory
- Agent note: `AGENTS.md` (entity labels section)

## Do not

- Hardcode A–Z-only sorts that put Instant NDA before Tage VC
- Duplicate priority lists in individual components
- Render `{entity_id}` or `ENT-*` as the visible company name in product UI
