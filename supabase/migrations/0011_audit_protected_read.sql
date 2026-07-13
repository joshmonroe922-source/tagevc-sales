-- Allow any protected actor (Josh allowlist session) to read all protected
-- audit rows, so activity across josh@ / joshmonroe@ / etc. stays visible to Josh
-- only — not merely the single email used for that login.

drop policy if exists "Protected actors read own audit events" on public.audit_events;

create policy "Protected actors read protected audit events"
  on public.audit_events for select
  using (
    public.is_active_sales_user()
    and actor_protected = true
    and public.current_audit_actor_is_protected()
  );
