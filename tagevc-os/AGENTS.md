# Tage OS — agent / contributor notes

## Entity labels in the UI

**Never** show opaque entity codes (`ENT-FIRM`, `ENT-R619`, `ENT-SIGNENT`, `ENT-INDA`, …) as the primary human-facing label.

| Use | Module |
| --- | --- |
| Display name helper | `@/lib/entities/display-name` → `entityDisplayName` / `entityLabel` |
| PageHeader scope chip | `entityScopeContext(entityId)` |
| Compact firm/null fallback | `entityLabelOrFirm(entityId)` |
| Badge in tables/cards | `@/components/entities/entity-badge` → `<EntityBadge entity={…} />` |
| Select order + labels | `@/lib/entities/display-order` + `CompanySelect` |

- **Values** in forms, URLs, RLS, and APIs stay as `entity_id`.
- **Labels** use `name` / `legal_name` / `canonical_name` / `display_name` when present, else the known-name map.
- Raw `ENT-*` is OK only as a muted secondary line, `title` tooltip, admin/debug copy, or technical docs — not the primary label.

See also: `docs/OS_ENTITY_SELECT_ORDER.md`.
