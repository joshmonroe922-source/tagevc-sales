/** Read-only survey of tenant + HRIS state before provisioning Dennis. */

import { graph, sb } from './lib.mjs';

const line = (s) => console.log(s);

{
  const r = await graph('v1.0/domains?$select=id,isVerified,isDefault,supportedServices');
  line('=== DOMAINS ===');
  if (!r.ok) line(JSON.stringify(r.body).slice(0, 400));
  else
    for (const d of r.body.value)
      line(
        `${d.id} | verified:${d.isVerified} default:${d.isDefault} | ${(d.supportedServices || []).join(',')}`,
      );
}

{
  const r = await graph('v1.0/subscribedSkus');
  line('\n=== SKUS ===');
  if (!r.ok) line(JSON.stringify(r.body).slice(0, 400));
  else
    for (const s of r.body.value) {
      const exo = s.servicePlans.filter((p) => /EXCHANGE/i.test(p.servicePlanName));
      line(
        `${s.skuPartNumber} | skuId:${s.skuId} | enabled:${s.prepaidUnits.enabled} consumed:${s.consumedUnits} avail:${s.prepaidUnits.enabled - s.consumedUnits} | status:${s.capabilityStatus} | EXO plans:${exo.map((p) => p.servicePlanName).join(',') || 'NONE'}`,
      );
    }
}

{
  const r = await graph(
    'v1.0/users?$select=id,displayName,userPrincipalName,mail,accountEnabled,jobTitle,assignedLicenses&$top=200',
  );
  line('\n=== USERS ===');
  if (!r.ok) line(JSON.stringify(r.body).slice(0, 400));
  else {
    line(`count=${r.body.value.length}`);
    for (const u of r.body.value)
      line(
        `${u.userPrincipalName} | ${u.displayName} | mail:${u.mail} | on:${u.accountEnabled} | ${u.jobTitle || '-'} | lic:${(u.assignedLicenses || []).length}`,
      );
  }
}

{
  const r = await graph('v1.0/groups?$select=id,displayName,mailEnabled,securityEnabled,mail&$top=100');
  line('\n=== GROUPS ===');
  if (!r.ok) line(JSON.stringify(r.body).slice(0, 400));
  else for (const g of r.body.value) line(`${g.id} | ${g.displayName} | mail:${g.mail || '-'} | sec:${g.securityEnabled}`);
}

{
  const r = await sb(
    'os_hris_process_runs?select=id,run_key,kind,status,start_date,template_id,os_hris_process_templates(slug,name)&employee_id=eq.3d7937db-34f1-4be1-82a6-21e84b2b26a7',
  );
  line('\n=== DENNIS RUNS ===');
  line(JSON.stringify(r.body, null, 1).slice(0, 2000));
}

{
  const r = await sb(
    'os_hris_process_steps?select=id,step_key,title,status,system_hook,automation,owner_role,due_at,sort_order&order=sort_order.asc&limit=100&run_id=in.(select)',
  );
  line('\n=== (steps fetched separately) ===');
  void r;
}
