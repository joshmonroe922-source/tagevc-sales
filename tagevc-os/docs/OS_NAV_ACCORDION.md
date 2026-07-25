# Left nav accordion groups

Tage OS sidebar (`app-sidebar.tsx`) treats parent nav items with `children` as accordion groups.

## Behavior
- **Business Development** → Lead Intake, Deal Flow
- **Portfolio** → Companies, Net Worth
- First tap expands; second tap collapses
- Active child route forces parent open on navigation
- Expanded state persisted in `localStorage` key `tagevc.nav.accordion.v1`
- Chevron rotates; parent is a focusable button (Enter/Space)
- Permissions / `hideDuringLiveLook` / hrefs unchanged — presentation only

Nav config remains data-driven in `src/lib/nav.ts` (`MAIN_NAV` with optional `children`).
