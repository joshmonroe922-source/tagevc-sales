# Entity OS switcher — one login, every operating system

The sidebar brand block (where the UI used to read a hardcoded **Tage VC**) is
now an operating-system switcher for firm-wide Visionary. Selecting a company
puts the whole shell — nav, entity scope, and branding — into that entity's OS
**in the same login session**. No re-auth, no subdomain hop.

Everyone else keeps the static brand line of the single OS they were hired
into.

## Who sees it

| Condition | Switcher |
| --- | --- |
| Real profile role is `visionary` | Shown |
| Any other role (`think_tank`, `coo`, `partner`, `admin`, `sub_lead`, `ssc_*`, …) | Hidden — static brand line |
| Visionary while impersonating via Role Switcher | Hidden |
| Visionary while in Live Look | Hidden |

Gate: `canSwitchEntityOs({ realRole, impersonatingAs, liveLookActive })` in
`@/lib/rbac/entity-os`. The last two rules exist because Role Switcher and
Live Look already rewrite the effective profile — stacking a third scope would
make the visible surface ambiguous.

## What changes when you switch

| Surface | Behavior |
| --- | --- |
| Sidebar brand | Company short name over "Operating System" (`Recruit 619 / Operating System`) |
| Banner | "Working in: Recruit 619" with an **Exit to Tage VC** button |
| Nav | Multi-company **Assets** accordion collapses to that company's overview (`/entities/{id}`) — the same shape a Subsidiary Leader sees |
| Entity scope | `isFirmWideAccess` returns `false`, so pipeline, portfolio, SSC, A&F, DocuSign, vendor, and to-do reads narrow to that entity (plus its direct children) |
| Landing | Switching in navigates to the entity overview |
| Messaging | Deliberately unchanged — messaging reach follows the person, not the OS |

Exiting (selecting **Tage Venture Capital**, the banner button, or letting the
cookie expire) restores the full firm-wide view.

## How it works

| Piece | Module |
| --- | --- |
| Options, labels, parse, gate | `@/lib/rbac/entity-os` (pure — safe for RBAC / nav / client) |
| Cookie I/O | `@/lib/rbac/entity-os-cookie` (`tagevc_entity_os`, httpOnly, 12h) |
| Session wiring | `getSessionContext()` → `SessionContext.activeEntityOs` |
| Scope | `isFirmWideAccess(role, entityId, activeEntityOs)` and friends in `@/lib/rbac/entity-scope` |
| Server actions | `switchEntityOsAction` / `exitEntityOsAction` in `src/app/(app)/entity-os/actions.ts` |
| UI | `src/components/layout/entity-os-switcher.tsx` + `entity-os-banner.tsx` |
| Portable twin | `src/lib/platform/shell/entity-os-brand.tsx` |

While the lock is set, `getSessionContext()` also rewrites
`profile.entity_id` to the selected entity, so every existing
`canAccessEntityId` / `canAccessPipelineEntity` comparison lines up without
each call site needing to know about the switcher. The role is **not**
rewritten — Visionary stays Visionary, and permissions are untouched.

## Security model — narrowing only

This is an **app-layer scope switch, not a credential switch**.

- Visionary already holds firm-wide access, so choosing an entity can only
  ever *reduce* what is returned. There is no path by which the cookie grants
  access the real profile lacks.
- Supabase RLS (`is_firm_wide_access()`, `can_access_entity()`) still evaluates
  the real `profiles` row and stays firm-wide for Visionary. The narrowing is
  enforced above it. That is intentional: making the DB session pretend to be a
  different tenant would require minting a scoped token per switch, which buys
  nothing when the operator is authorized for all of it anyway.
- A stale or tampered cookie degrades to firm-wide: `parseEntityOsId` rejects
  anything that is not a known, visible registry entity.
- Every switch writes an activity event (`entity_os_enter` / `entity_os_exit`).

For a genuinely scoped DB session — e.g. giving a non-Visionary operator
temporary access to a second entity — the switcher is the wrong tool. That
needs a real cross-entity grant on the profile plus RLS support.

## Adding an entity

Nothing to do. Options come from `getCachedEntitySelectOptions()` over the
entity registry, ordered by `@/lib/entities/display-order` and filtered through
`registry-visibility`. A newly provisioned subsidiary appears automatically
(after the 5-minute select cache TTL, or immediately via
`invalidateEntitySelectCache()`).

## Subsidiary portals

Subsidiary OSes are separate deployments. They inherit the brand block by
copying `src/lib/platform/shell/entity-os-brand.tsx`; with a single option it
renders as static brand lines. A portal must never show the switcher to a role
scoped to one entity.
