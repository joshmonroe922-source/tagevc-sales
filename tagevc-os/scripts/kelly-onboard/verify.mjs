/** Read-only verify after apply.mts */
import { sb } from '../dennis-onboard/lib.mjs';

const EMP = 'aee6fda8-2a8b-4fac-b2da-91c3252954b6';
const e = await sb(
  `os_hris_employees?id=eq.${EMP}&select=full_name,work_email,profile_id,upn,entra_object_id,identity_status,onboarding_status,onboarding_pct,status`,
);
console.log('employee', e.body?.[0]);

const steps = await sb(
  `os_hris_process_steps?run_id=eq.373afe10-f5bf-4c2f-8728-dc1b5aa38dca&step_key=in.(bs.ms_email,bs.hris_invite)&select=step_key,status,evidence_note`,
);
console.log('steps', steps.body);

const pid = e.body?.[0]?.profile_id;
if (pid) {
  const p = await sb(`profiles?id=eq.${pid}&select=email,role,entity_id,active`);
  console.log('profile', p.body?.[0]);
}
