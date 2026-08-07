-- Email signature onboarding hook (idempotent)
-- Wire sd.email_sig → system_hook email_signature for assist dispatch

alter table public.os_hris_process_template_steps
  drop constraint if exists os_hris_process_template_steps_system_hook_check;

alter table public.os_hris_process_template_steps
  add constraint os_hris_process_template_steps_system_hook_check
  check (
    system_hook is null
    or system_hook in (
      'manual', 'payroll', 'it_provision', 'asset_audit', 'benefits',
      'access_revoke', 'i9', 'handbook_ack', 'employment_contract',
      'compliance_ack', 'messaging_revoke', 'portal_revoke', 'ticketing_revoke',
      'knowledge_handoff', 'exit_interview',
      'graph_provision', 'mailbox_grant', 'docusign_send', 'document_vault',
      'verified_first', 'screening',
      'gusto_provision',
      'email_signature'
    )
  );

update public.os_hris_process_template_steps
set system_hook = 'email_signature',
    automation = 'assist'
where step_key = 'sd.email_sig'
  and coalesce(system_hook, '') is distinct from 'email_signature';

-- Runtime steps already spawned from templates
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'os_hris_process_steps'
      and column_name = 'system_hook'
  ) then
    update public.os_hris_process_steps
    set system_hook = 'email_signature',
        automation = 'assist'
    where step_key = 'sd.email_sig'
      and coalesce(system_hook, '') is distinct from 'email_signature';
  end if;
end $$;