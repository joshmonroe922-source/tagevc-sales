# Subsidiary OS shell pattern (AppTopBar)

Canonical UX from Tage OS (`src/components/help-desk/help-desk-shell.tsx`).

Every subsidiary portal (Recruit 619, Instant NDA, Signent, **future clones**) must ship this upper-right shell:

| Control | Behavior |
| --- | --- |
| **Alerts** | Bell + label + unread badge. Opens notification / soft-alert panel. |
| **Create Ticket** | Primary split-button opens the create-ticket modal. |
| **Help Desk** | Chevron dropdown item → `/help-desk`. **Not** a left-nav primary. |

## Required wiring

1. Wrap the app shell in `HelpDeskShell` (`CreateTicketModalProvider`).
2. Render `AppTopBar` above `<main>` (right-aligned, `h-12`, border-b).
3. `GlobalCreateTicketButton` = primary + chevron → Help Desk (see template below).
4. Remove `Help Desk` from `MAIN_NAV` / left sidebar.
5. Keep `/help-desk` route + page (reachable from the dropdown and deep links).

## Copy targets (scaffold)

When cloning a new entity OS from Instant NDA / Signent / R619:

```
src/components/help-desk/help-desk-shell.tsx   # AppTopBar + HelpDeskShell
src/components/help-desk/create-ticket-modal.tsx  # GlobalCreateTicketButton split
src/components/layout/alerts-bell.tsx          # Alerts control
src/lib/nav.ts                                # no Help Desk left-nav item
```

Reference implementations also live under `src/lib/platform/shell/` (portable twins).

## Nav / Think Tank tests

Assert Help Desk is **absent** from left nav and present only via Create Ticket dropdown:

```ts
assert.ok(!MAIN_NAV.some((n) => n.href === '/help-desk'));
```

## Visual tokens

Create Ticket split uses Tage charcoal:

`bg-[#3a414f] text-white hover:bg-[#535c63]`

## Production Vercel projects (domain owners)

| Portal | Domain | Vercel project |
| --- | --- | --- |
| Recruit 619 | portal.recruit619.com | `recruit619-portal` |
| Instant NDA | portal.instantnda.us | `instantnda-portal` |
| Signent HR | portal.signenthr.com | `signent-hr-portal` (not `signenthr-portal`) |
