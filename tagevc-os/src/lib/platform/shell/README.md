# Platform shell — copy into subsidiary OS scaffolds

Portable twins of Tage AppTopBar patterns. Copy these files into a new
entity portal under the matching `src/components/...` paths, then wire
entity-specific ticket create + alerts data sources.

See `docs/SUBSIDIARY_OS_SHELL.md`.

| File | Portal destination |
| --- | --- |
| `create-ticket-split-button.tsx` | Merge into `components/help-desk/create-ticket-modal.tsx` as `GlobalCreateTicketButton` |
| `app-top-bar.tsx` | `components/help-desk/help-desk-shell.tsx` |
| `alerts-bell.tsx` | `components/layout/alerts-bell.tsx` (swap data source) |
