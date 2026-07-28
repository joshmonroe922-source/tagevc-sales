-- Clear Instant NDA sample/operating test metrics (ARR 480 / burn 30 / cash 540 / runway 18).
-- Keep Instant NDA as a live entity (ENT-INDA + legacy ENT-002 / PF-002 rows).
-- Metrics go to zeros / null until IES supplies live values. Idempotent.
-- Prefer scripts/clear-instant-nda-sample-metrics.mjs with service role.

-- Portfolio Active row(s)
update public.portfolio_companies
   set arr_k = 0,
       mom_growth = 0,
       net_burn_k = 0,
       runway_mo = null,
       cash_k = 0,
       top_risk = 'Not connected — await IES',
       next_milestone = 'Connect Instant NDA IES books',
       notes = coalesce(
         nullif(trim(notes), ''),
         'Live operating subsidiary — metrics from IES when connected'
       ),
       last_update = to_char(now()::date, 'YYYY-MM-DD'),
       updated_at = now()
 where entity_id in ('ENT-002', 'ENT-INDA')
    or portfolio_id = 'PF-002'
    or lower(company_name) = 'instant nda';

-- Period P&L (blue cells)
update public.entity_month_pnl
   set revenue_arr_k = 0,
       cogs_k = 0,
       opex_k = 0,
       net_burn_k = 0,
       ending_cash_k = 0
 where entity_id in ('ENT-002', 'ENT-INDA')
   and coalesce(is_firm, false) = false;

-- CORE KPI pack
update public.entity_month_kpi
   set value_num = case
         when kpi_key in (
           'revenue_arr', 'mom_growth', 'net_burn', 'ending_cash', 'headcount_fte'
         ) then 0
         when kpi_key in (
           'gross_margin', 'runway_mo', 'customer_concentration', 'pipeline_coverage'
         ) then null
         else value_num
       end,
       value_text = case
         when kpi_key = 'runway_mo' then 'n/a'
         when kpi_key = 'top_risk' then 'Not connected — await IES'
         when kpi_key = 'health' then coalesce(value_text, 'On Track')
         else value_text
       end
 where entity_id in ('ENT-002', 'ENT-INDA');

-- Sample SaaS FLEX KPIs (NRR / CAC / LTV) — remove demo pack
delete from public.entity_month_kpi_flex
 where entity_id in ('ENT-002', 'ENT-INDA')
   and flex_key in ('nrr', 'cac', 'ltv');
