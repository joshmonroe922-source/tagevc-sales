-- phase98b — Digital Card wallet event types (additive)
-- Allows analytics for Apple / Google Wallet adds without widening anon access.

alter table public.os_digital_card_events
  drop constraint if exists os_digital_card_events_event_type_check;

alter table public.os_digital_card_events
  add constraint os_digital_card_events_event_type_check
  check (event_type in (
    'view',
    'save_vcard',
    'exchange_submit',
    'share_click',
    'revoke_hit',
    'wallet_apple',
    'wallet_google'
  ));
