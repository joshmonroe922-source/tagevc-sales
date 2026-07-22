-- Hotfix: Shared Services crashed after Phase 40 because
-- os_slo_owner_coverage_metrics (security_invoker) called
-- phase39_owner_authorized, which is revoked from callers.
-- Safe to re-run.

create or replace function public.phase40_replacement_eligible(
  p_owner_id uuid, p_entity_id text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_owner_id is null then false
    else public.phase39_owner_authorized(p_owner_id, p_entity_id)
  end;
$$;

create or replace view public.os_slo_owner_coverage_metrics
with (security_invoker=true) as
select p.policy_id,p.service,p.metric_key,o.entity_id,o.owner_id,o.expires_at,
  o.replacement_owner_id,
  greatest(0,ceil(extract(epoch from(o.expires_at-now()))/86400))::integer as days_remaining,
  (o.expires_at<=now()+interval '30 days') as warning,
  (o.replacement_owner_id is not null
    and public.phase40_replacement_eligible(o.replacement_owner_id,o.entity_id))
    as eligible_replacement_named
from public.os_slo_policies p
join public.os_slo_owners o on o.service=p.service and o.metric_key=p.metric_key
  and o.active and o.effective_at<=now()
  and (o.expires_at is null or o.expires_at>now())
where p.lifecycle_status='published' and p.enabled and o.expires_at is not null;

grant execute on function public.phase40_normalized_policy(public.os_slo_policies),
  public.phase40_replacement_eligible(uuid,text)
  to authenticated, service_role;
grant select on public.os_slo_policy_draft_comparisons,
  public.os_slo_simulations, public.os_slo_owner_coverage_metrics
  to authenticated, service_role;
