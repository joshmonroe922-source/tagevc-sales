import { isIP } from 'node:net';
import { createPersistClient } from '@/lib/supabase/persist-client';

type DeliveryJob = {
  job_id: string;
  adapter: 'in_app_owner' | 'webhook';
  destination_key: string;
  payload: Record<string, unknown>;
  lease_token: string;
};

type RouteTestJob = {
  job_id: string;
  route_test_id: string;
  adapter: 'in_app_owner' | 'webhook';
  destination_key: string;
  owner_id: string | null;
  lease_token: string;
  is_test: true;
};

export function webhookUrl(destinationKey: string): string | null {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(destinationKey)) return null;
  const suffix = destinationKey.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const value = process.env[`SLO_WEBHOOK_${suffix}`]?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const allowedHosts = new Set(
      (process.env.SLO_WEBHOOK_ALLOWED_HOSTS ?? '')
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    );
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      !hostname.includes('.') ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      isIP(hostname) !== 0 ||
      !allowedHosts.has(hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function deliverSloAlerts(limit = 25) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('claim_slo_delivery_jobs', {
    p_limit: limit,
    p_lease_seconds: 900,
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
        redirect: 'error',
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
  const { data: testData, error: testError } = await sb.rpc(
    'claim_slo_route_test_jobs_phase39',
    {
      p_limit: Math.min(limit, 10),
      p_lease_seconds: 300,
    },
  );
  if (testError) throw new Error(testError.message);
  const testJobs = (testData ?? []) as RouteTestJob[];
  let routeTestsDelivered = 0;
  let routeTestsFailed = 0;
  for (const job of testJobs) {
    if (!job.is_test) throw new Error('Refusing to deliver an unmarked route test');
    if (job.adapter === 'in_app_owner') {
      const { error: inAppError } = await sb.rpc(
        'deliver_slo_in_app_route_test_phase39',
        { p_job_id: job.job_id, p_lease_token: job.lease_token },
      );
      if (!inAppError) {
        routeTestsDelivered += 1;
        continue;
      }
      const { error: completionError } = await sb.rpc(
        'complete_slo_route_test_job_phase39',
        {
          p_job_id: job.job_id,
          p_lease_token: job.lease_token,
          p_outcome: 'failed',
          p_response_code: null,
          p_provider_id: null,
          p_error_detail: inAppError.message,
        },
      );
      if (completionError) throw new Error(completionError.message);
      routeTestsFailed += 1;
      continue;
    }
    let outcome: 'delivered' | 'failed' = 'delivered';
    let responseCode: number | null = null;
    let errorDetail: string | null = null;
    try {
      const url = webhookUrl(job.destination_key);
      if (!url) throw new Error('Webhook environment destination is not configured');
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tagevc-slo-test': 'true',
        },
        redirect: 'error',
        body: JSON.stringify({
          test: true,
          kind: 'slo_delivery_route_test',
          route_test_id: job.route_test_id,
          message: 'TEST only — no incident was opened or changed.',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      responseCode = response.status;
      if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
      routeTestsDelivered += 1;
    } catch (error) {
      outcome = 'failed';
      errorDetail = error instanceof Error ? error.message : 'Route test failed';
      routeTestsFailed += 1;
    }
    const { error: completionError } = await sb.rpc(
      'complete_slo_route_test_job_phase39',
      {
        p_job_id: job.job_id,
        p_lease_token: job.lease_token,
        p_outcome: outcome,
        p_response_code: responseCode,
        p_provider_id: null,
        p_error_detail: errorDetail,
      },
    );
    if (completionError) throw new Error(completionError.message);
  }
  return {
    claimed: jobs.length,
    delivered,
    failed,
    routeTestsClaimed: testJobs.length,
    routeTestsDelivered,
    routeTestsFailed,
  };
}
