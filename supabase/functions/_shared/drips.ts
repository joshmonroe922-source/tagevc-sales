import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { renderTemplate, sendResendEmail, tagsFromRecord } from './email.ts';
import { recordOutboundEmail } from './emailAnalytics.ts';

type LeadRow = {
  id: string;
  name: string;
  email: string;
  company: string;
  deal_path: string;
  assigned_rep_id: string | null;
};

const DEAL_PATH_LABELS: Record<string, string> = {
  launch: 'Launch',
  partner: 'Partner',
  exit: 'Exit',
};

export async function enrollLeadInNewDrip(
  supabase: SupabaseClient,
  lead: LeadRow,
): Promise<void> {
  const { data: settings } = await supabase
    .from('sales_settings')
    .select('drips_enabled, automation_owner_id')
    .eq('id', '00000000-0000-4000-8000-000000000001')
    .maybeSingle();

  if (settings && settings.drips_enabled === false) return;

  const { data: seq } = await supabase
    .from('sales_drip_sequences')
    .select('id')
    .eq('slug', 'new-lead-nurture')
    .eq('active', true)
    .maybeSingle();

  if (!seq) return;

  const ownerId =
    lead.assigned_rep_id ?? settings?.automation_owner_id ?? null;

  const { error } = await supabase.from('sales_drip_enrollments').upsert(
    {
      sequence_id: seq.id,
      lead_id: lead.id,
      owner_id: ownerId,
      status: 'active',
      current_step: 0,
      next_send_at: new Date().toISOString(),
    },
    { onConflict: 'sequence_id,lead_id' },
  );

  if (error) {
    console.error('drip enroll failed', error);
    return;
  }

  await supabase.from('sales_lead_activities').insert({
    lead_id: lead.id,
    activity_type: 'drip_enrolled',
    summary: 'Enrolled in new-lead-nurture drip',
    metadata: { sequence_id: seq.id },
    created_by: ownerId,
  });
}

export async function cancelActiveDrips(
  supabase: SupabaseClient,
  leadId: string,
): Promise<void> {
  await supabase
    .from('sales_drip_enrollments')
    .update({
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      next_send_at: null,
    })
    .eq('lead_id', leadId)
    .eq('status', 'active');
}

function leadVars(lead: LeadRow): Record<string, string> {
  return {
    name: lead.name,
    email: lead.email,
    company: lead.company || '—',
    deal_path: DEAL_PATH_LABELS[lead.deal_path] ?? lead.deal_path,
  };
}

export async function processDueDrips(
  supabase: SupabaseClient,
  limit = 50,
): Promise<{ processed: number; errors: string[] }> {
  const now = new Date().toISOString();
  const errors: string[] = [];
  let processed = 0;

  const { data: settings } = await supabase
    .from('sales_settings')
    .select('drips_enabled, auto_tasks_enabled, intake_alert_email, automation_owner_id')
    .eq('id', '00000000-0000-4000-8000-000000000001')
    .maybeSingle();

  if (settings && settings.drips_enabled === false) {
    return { processed: 0, errors: [] };
  }

  const { data: due, error: dueErr } = await supabase
    .from('sales_drip_enrollments')
    .select('id, sequence_id, lead_id, owner_id, current_step, next_send_at')
    .eq('status', 'active')
    .lte('next_send_at', now)
    .order('next_send_at', { ascending: true })
    .limit(limit);

  if (dueErr) {
    return { processed: 0, errors: [dueErr.message] };
  }

  for (const enrollment of due ?? []) {
    try {
      const { data: lead } = await supabase
        .from('sales_leads')
        .select('id, name, email, company, deal_path, assigned_rep_id, stage')
        .eq('id', enrollment.lead_id)
        .maybeSingle();

      if (!lead) {
        await supabase
          .from('sales_drip_enrollments')
          .update({ status: 'cancelled', completed_at: now })
          .eq('id', enrollment.id);
        continue;
      }

      if (['closed_won', 'closed_lost', 'passed'].includes(lead.stage)) {
        await supabase
          .from('sales_drip_enrollments')
          .update({ status: 'cancelled', completed_at: now, next_send_at: null })
          .eq('id', enrollment.id);
        continue;
      }

      const { data: step } = await supabase
        .from('sales_drip_steps')
        .select('*')
        .eq('sequence_id', enrollment.sequence_id)
        .eq('step_order', enrollment.current_step)
        .maybeSingle();

      if (!step) {
        await supabase
          .from('sales_drip_enrollments')
          .update({
            status: 'completed',
            completed_at: now,
            next_send_at: null,
          })
          .eq('id', enrollment.id);
        await supabase.from('sales_lead_activities').insert({
          lead_id: lead.id,
          activity_type: 'drip_completed',
          summary: 'Drip sequence completed',
          created_by: enrollment.owner_id,
        });
        processed += 1;
        continue;
      }

      const vars = leadVars(lead);
      const subject = renderTemplate(step.subject, vars);
      const body = renderTemplate(step.body_html, vars);
      const alertTo =
        settings?.intake_alert_email || Deno.env.get('INTAKE_ALERT_EMAIL') || '';

      if (step.action_type === 'create_task') {
        if (settings?.auto_tasks_enabled !== false) {
          const owner =
            enrollment.owner_id ??
            lead.assigned_rep_id ??
            settings?.automation_owner_id;
          if (owner) {
            const dueAt = new Date();
            dueAt.setDate(dueAt.getDate() + 1);
            await supabase.from('sales_tasks').insert({
              sales_user_id: owner,
              lead_id: lead.id,
              title: subject,
              notes: body.replace(/<[^>]+>/g, ''),
              due_at: dueAt.toISOString(),
              status: 'open',
            });
            await supabase.from('sales_lead_activities').insert({
              lead_id: lead.id,
              activity_type: 'task_created',
              summary: `Drip task: ${subject}`,
              created_by: owner,
            });
          }
        }
      } else if (step.action_type === 'email_lead' && lead.email) {
        const tags = tagsFromRecord({
          source: 'drip_lead',
          lead_id: lead.id,
        });
        const sent = await sendResendEmail({
          to: lead.email,
          subject,
          html: body,
          tags,
        });
        if (!sent.ok) errors.push(`email_lead ${lead.id}: ${sent.error}`);
        await supabase.from('sales_lead_activities').insert({
          lead_id: lead.id,
          activity_type: sent.ok ? 'email_sent' : 'email_queued',
          summary: `Drip email: ${subject}`,
          metadata: {
            error: sent.error ?? null,
            resend_id: sent.id ?? null,
          },
          created_by: enrollment.owner_id,
        });
        if (sent.ok && sent.id) {
          await recordOutboundEmail(supabase, {
            resendId: sent.id,
            to: lead.email,
            subject,
            source: 'drip_lead',
            leadId: lead.id,
            tags,
            sentBy: enrollment.owner_id,
          });
          let ownerEmail: string | null = null;
          if (enrollment.owner_id) {
            const { data: ownerRow } = await supabase
              .from('sales_users')
              .select('email')
              .eq('id', enrollment.owner_id)
              .maybeSingle();
            ownerEmail = ownerRow?.email ?? null;
          }
          await supabase.rpc('insert_audit_event', {
            p_user_id: enrollment.owner_id,
            p_email: ownerEmail,
            p_event_type: 'email_sent',
            p_path: `/sales/deal-sourcing/leads/${lead.id}`,
            p_metadata: {
              to: lead.email,
              subject,
              source: 'drip',
              lead_id: lead.id,
              resend_id: sent.id,
            },
          });
        }
      } else {
        // internal_reminder → email Josh
        if (alertTo) {
          const tags = tagsFromRecord({
            source: 'drip_reminder',
            lead_id: lead.id,
          });
          const reminderSubject = `[Tage VC] ${subject}`;
          const sent = await sendResendEmail({
            to: alertTo,
            subject: reminderSubject,
            html: body,
            tags,
          });
          if (!sent.ok) errors.push(`reminder ${lead.id}: ${sent.error}`);
          if (sent.ok && sent.id) {
            await recordOutboundEmail(supabase, {
              resendId: sent.id,
              to: alertTo,
              subject: reminderSubject,
              source: 'drip_reminder',
              leadId: lead.id,
              tags,
              sentBy: enrollment.owner_id,
            });
            let ownerEmail: string | null = null;
            if (enrollment.owner_id) {
              const { data: ownerRow } = await supabase
                .from('sales_users')
                .select('email')
                .eq('id', enrollment.owner_id)
                .maybeSingle();
              ownerEmail = ownerRow?.email ?? null;
            }
            await supabase.rpc('insert_audit_event', {
              p_user_id: enrollment.owner_id,
              p_email: ownerEmail,
              p_event_type: 'email_sent',
              p_path: `/sales/deal-sourcing/leads/${lead.id}`,
              p_metadata: {
                to: alertTo,
                subject: reminderSubject,
                source: 'drip_reminder',
                lead_id: lead.id,
                resend_id: sent.id,
              },
            });
          }
        }
        await supabase.from('sales_lead_activities').insert({
          lead_id: lead.id,
          activity_type: 'drip_step_sent',
          summary: `Drip reminder: ${subject}`,
          created_by: enrollment.owner_id,
        });
      }

      const nextOrder = enrollment.current_step + 1;
      const { data: nextStep } = await supabase
        .from('sales_drip_steps')
        .select('delay_days, step_order')
        .eq('sequence_id', enrollment.sequence_id)
        .eq('step_order', nextOrder)
        .maybeSingle();

      if (!nextStep) {
        await supabase
          .from('sales_drip_enrollments')
          .update({
            status: 'completed',
            current_step: nextOrder,
            last_sent_at: now,
            completed_at: now,
            next_send_at: null,
          })
          .eq('id', enrollment.id);
        await supabase.from('sales_lead_activities').insert({
          lead_id: lead.id,
          activity_type: 'drip_completed',
          summary: 'Drip sequence completed',
          created_by: enrollment.owner_id,
        });
      } else {
        const nextAt = new Date();
        // delay_days is absolute from enrollment day-0 style: use delta from previous step
        const { data: prevStep } = await supabase
          .from('sales_drip_steps')
          .select('delay_days')
          .eq('sequence_id', enrollment.sequence_id)
          .eq('step_order', enrollment.current_step)
          .maybeSingle();
        const delta = Math.max(
          0,
          (nextStep.delay_days ?? 0) - (prevStep?.delay_days ?? 0),
        );
        nextAt.setDate(nextAt.getDate() + delta);
        await supabase
          .from('sales_drip_enrollments')
          .update({
            current_step: nextOrder,
            last_sent_at: now,
            next_send_at: nextAt.toISOString(),
          })
          .eq('id', enrollment.id);
      }

      processed += 1;
    } catch (err) {
      errors.push(
        `enrollment ${enrollment.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { processed, errors };
}
