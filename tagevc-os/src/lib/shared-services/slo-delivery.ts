import { createPersistClient } from '@/lib/supabase/persist-client';

type DeliveryJob = {
  job_id: string;
  adapter: 'in_app_owner' | 'webhook';
  destination_key: string;
  payload: Record<string, unknown>;
  lease_token: string;
};

function webhookUrl(destinationKey: string): string | null {
  const suffix = destinationKey.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const value = process.env[`SLO_WEBHOOK_${suffix}`]?.trim();
  return value && /^https:\/\//.test(value) ? value : null;
}

export async function deliverSloAlerts(limit = 25) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('claim_slo_delivery_jobs', {
    p_limit: limit,
    p_lease_seconds: 120,
  });
  if (error) throw new Error(error.message);
  const jobs = (data ?? []) as DeliveryJob[];
  let delivered = 0;
  let failed = 0;
  for (const job of jobs) {
    if (job.adapter === 'in_app_owner') {
      const { error: inAppError } = await sb.rpc('deliver_slo_in_app_job', {
        p_job_id: job.job_id,
        p_lease_token: job.lease_token,
      });
      if (inAppError) {
        const { error: completionError } = await sb.rpc(
          'complete_slo_delivery_job',
          {
            p_job_id: job.job_id,
            p_lease_token: job.lease_token,
            p_outcome: 'failed',
            p_response_code: null,
            p_error_detail: inAppError.message,
          },
        );
        if (completionError) throw new Error(completionError.message);
        failed += 1;
      } else {
        delivered += 1;
      }
      continue;
    }
    let outcome = 'delivered';
    let responseCode: number | null = null;
    let errorDetail: string | null = null;
    try {
      const url = webhookUrl(job.destination_key);
      if (!url) {
        throw new Error('Webhook environment destination is not configured');
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(job.payload),
        signal: AbortSignal.timeout(10_000),
      });
      responseCode = response.status;
      if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
      delivered += 1;
    } catch (error) {
      outcome = 'failed';
      errorDetail = error instanceof Error ? error.message : 'Delivery failed';
      failed += 1;
    }
    const { error: completionError } = await sb.rpc(
      'complete_slo_delivery_job',
      {
        p_job_id: job.job_id,
        p_lease_token: job.lease_token,
        p_outcome: outcome,
        p_response_code: responseCode,
        p_error_detail: errorDetail,
      },
    );
    if (completionError) throw new Error(completionError.message);
  }
  return { claimed: jobs.length, delivered, failed };
}
