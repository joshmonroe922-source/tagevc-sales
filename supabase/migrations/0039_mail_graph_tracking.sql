-- Graph-sent tracked deal mail: custom open/click tracking (pixel + link redirect).
-- Resend rows keep resend_id; Graph rows use tracking_token.

alter table public.sales_email_messages
  alter column resend_id drop not null;

alter table public.sales_email_messages
  add column if not exists tracking_token text,
  add column if not exists provider text not null default 'resend';

alter table public.sales_email_messages
  drop constraint if exists sales_email_messages_resend_id_key;

create unique index if not exists sales_email_messages_resend_id_uidx
  on public.sales_email_messages (resend_id)
  where resend_id is not null;

create unique index if not exists sales_email_messages_tracking_token_uidx
  on public.sales_email_messages (tracking_token)
  where tracking_token is not null;

alter table public.sales_email_messages
  drop constraint if exists sales_email_messages_provider_check;

alter table public.sales_email_messages
  add constraint sales_email_messages_provider_check
  check (provider in ('resend', 'graph'));

alter table public.sales_email_messages
  drop constraint if exists sales_email_messages_id_present;

alter table public.sales_email_messages
  add constraint sales_email_messages_id_present
  check (resend_id is not null or tracking_token is not null);

create index if not exists sales_email_messages_provider_idx
  on public.sales_email_messages (provider, created_at desc);

comment on column public.sales_email_messages.tracking_token is
  'Opaque token for portal open/click tracking on Graph-sent mail.';
comment on column public.sales_email_messages.provider is
  'resend = Resend API; graph = Microsoft Graph sendMail with custom tracking.';

alter table public.sales_email_events
  alter column resend_id drop not null;

alter table public.sales_email_events
  add column if not exists tracking_token text;

create index if not exists sales_email_events_tracking_token_idx
  on public.sales_email_events (tracking_token, occurred_at desc);
