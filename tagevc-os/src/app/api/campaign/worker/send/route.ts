import { processDueSendJobs } from '@/lib/campaign/workers/orchestrator';
import { jsonError, jsonOk } from '@/lib/campaign/http';
export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const cron = req.headers.get('x-vercel-cron');
  const secret = process.env.CRON_SECRET || process.env.CAMPAIGN_WORKER_SECRET;
  if (secret && auth !== `Bearer ${secret}` && !cron) return jsonError('UNAUTHORIZED', 'Unauthorized', 401);
  const result = await processDueSendJobs({ limit: 25 });
  return jsonOk({ data: result });
}
export async function GET(req: Request) { return POST(req); }
