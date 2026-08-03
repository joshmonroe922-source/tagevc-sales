# Spine integration

- Nav: Shared Services / Marketing / Email Campaign Center
- Service key: `marketing.email_campaign_center`
- Feature flags: `ecc_entity_flags.campaign_enabled`
- Coexists with `os_platform_email_*` tracking + marketing paid stack
- Dialer: `POST /api/campaign/hooks/dialer/attempts`
- DocuSign: library IDs only via `campaign-docusign` port
