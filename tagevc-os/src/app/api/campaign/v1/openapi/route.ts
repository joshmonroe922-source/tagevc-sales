import { jsonOk } from '@/lib/campaign/http';

export async function GET() {
  return jsonOk({
    openapi: '3.0.3',
    info: {
      title: 'Tage Email Campaign Center API',
      version: '1.0.0',
      description:
        'Spine service marketing.email_campaign_center — owned MTA + Graph dual-plane',
    },
    paths: {
      '/api/campaign/v1/campaigns': { get: {}, post: {} },
      '/api/campaign/v1/lists': { get: {}, post: {} },
      '/api/campaign/v1/segments': { get: {}, post: {} },
      '/api/campaign/v1/templates': { get: {}, post: {} },
      '/api/campaign/v1/suppressions': { get: {}, post: {} },
      '/api/campaign/v1/merge-fields': { get: {} },
      '/api/campaign/v1/analytics/overview': { get: {} },
      '/api/campaign/v1/journeys': { get: {}, post: {} },
      '/api/campaign/v1/journeys/{id}': { get: {}, patch: {} },
      '/api/campaign/v1/journeys/starter-packs': { get: {}, post: {} },
      '/api/campaign/v1/intelligence': { get: {} },
      '/api/campaign/v1/intelligence/sto': { post: {} },
      '/api/campaign/v1/intelligence/ai-assist': { post: {} },
      '/api/campaign/v1/docusign': { get: {}, post: {} },
      '/api/campaign/v1/me/email-campaign-center/home': { get: {} },
      '/api/campaign/v1/team/campaigns': { get: {} },
      '/api/campaign/p/unsub/one-click': { post: {} },
      '/api/campaign/hooks/dialer/attempts': { post: {} },
      '/api/campaign/hooks/mta/postal': { post: {} },
    },
  });
}
