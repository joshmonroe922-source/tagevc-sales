-- Portal-managed mail signature (Graph has no compose-signature API).
-- Outlook desktop/mobile signatures remain separate unless Microsoft adds Graph support.

alter table public.sales_users
  add column if not exists mail_signature_html text;

alter table public.sales_users
  add column if not exists mail_signature_enabled boolean not null default true;

comment on column public.sales_users.mail_signature_html is
  'HTML or plain-text portal email signature; appended when sending from portal Mail.';

comment on column public.sales_users.mail_signature_enabled is
  'When true, portal Mail auto-appends mail_signature_html on send/reply/forward.';

create or replace function public.set_my_mail_signature(
  p_html text,
  p_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_html text;
  v_enabled boolean;
begin
  v_uid := public.current_sales_user_id();
  if v_uid is null then
    raise exception 'Not authorized';
  end if;

  v_html := nullif(trim(coalesce(p_html, '')), '');
  if v_html is not null and char_length(v_html) > 20000 then
    raise exception 'Signature too long (max 20000 characters)';
  end if;

  v_enabled := coalesce(p_enabled, true);

  update public.sales_users
  set
    mail_signature_html = v_html,
    mail_signature_enabled = v_enabled
  where id = v_uid;

  return jsonb_build_object(
    'mail_signature_html', v_html,
    'mail_signature_enabled', v_enabled
  );
end;
$$;

revoke all on function public.set_my_mail_signature(text, boolean) from public;
grant execute on function public.set_my_mail_signature(text, boolean) to authenticated;
