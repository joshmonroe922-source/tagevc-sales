import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  completePlannerTask,
  createPlannerTask,
  fetchMe,
  fetchMyPlannerPlans,
  fetchPlannerTaskEtag,
  fetchPlannerTasks,
  getMsConfig,
  getValidAccessToken,
  requireActiveSalesUser,
} from '../_shared/microsoftGraph.ts';
import { auditMsAction } from '../_shared/msAudit.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

type Body = {
  action?: 'plans' | 'list' | 'create' | 'complete';
  plan_id?: string;
  task_id?: string;
  title?: string;
  assign_to_me?: boolean;
};

function mapTask(t: {
  id: string;
  title: string;
  percentComplete: number;
  planId: string;
  dueDateTime?: string | null;
  createdDateTime?: string | null;
}) {
  return {
    id: t.id,
    title: t.title || '(No title)',
    plan_id: t.planId,
    percent_complete: t.percentComplete ?? 0,
    due: t.dueDateTime ?? null,
    created_at: t.createdDateTime ?? null,
    completed: (t.percentComplete ?? 0) >= 100,
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    const config = getMsConfig();
    if (!config.configured) {
      return jsonResponse(
        { error: 'Microsoft Graph is not configured', configured: false },
        503,
        origin,
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const userClient = createUserClient(authHeader);
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const service = createServiceClient();
    const salesUser = await requireActiveSalesUser(service, user.email);
    if (!salesUser) {
      return jsonResponse({ error: 'Forbidden' }, 403, origin);
    }

    const body = (await req.json()) as Body;
    const action = body.action ?? 'plans';

    let accessToken: string;
    try {
      const result = await getValidAccessToken(service, config, salesUser.id);
      accessToken = result.accessToken;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Not connected';
      return jsonResponse({ error: message, needs_reconnect: true }, 401, origin);
    }

    if (action === 'plans') {
      try {
        const plans = await fetchMyPlannerPlans(accessToken);
        return jsonResponse(
          {
            plans: plans.map((p) => ({
              id: p.id,
              title: p.title,
              owner: p.owner ?? null,
            })),
            hint:
              plans.length === 0
                ? 'No Planner plans found for your account. Create a plan in Microsoft Planner (Teams) first, or ask an admin if Group.Read.All / Tasks.ReadWrite consent is missing.'
                : null,
          },
          200,
          origin,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Planner plans failed';
        return jsonResponse(
          {
            plans: [],
            error: message,
            hint:
              'Planner may require admin consent for Tasks.ReadWrite (or Group.Read.All). Reconnect after consent, or use Microsoft To Do instead.',
          },
          200,
          origin,
        );
      }
    }

    const planId = (body.plan_id ?? '').trim();
    if (!planId && action !== 'complete') {
      return jsonResponse({ error: 'plan_id is required' }, 400, origin);
    }

    if (action === 'list') {
      const tasks = await fetchPlannerTasks(accessToken, planId);
      const mapped = tasks.map(mapTask);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'planner_view',
        path: '/sales/calendar',
        metadata: { plan_id: planId, task_count: mapped.length },
      });
      return jsonResponse(
        { plan_id: planId, tasks: mapped },
        200,
        origin,
      );
    }

    if (action === 'create') {
      const title = (body.title ?? '').trim();
      if (!title) {
        return jsonResponse({ error: 'title is required' }, 400, origin);
      }
      let assignments:
        | Record<string, { '@odata.type': string; orderHint: string }>
        | undefined;
      if (body.assign_to_me !== false) {
        const me = await fetchMe(accessToken);
        if (me.id) {
          assignments = {
            [me.id]: {
              '@odata.type': '#microsoft.graph.plannerAssignment',
              orderHint: ' !',
            },
          };
        }
      }
      const created = await createPlannerTask(accessToken, planId, title, assignments);
      const task = mapTask(created);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'planner_create',
        path: '/sales/calendar',
        metadata: {
          plan_id: planId,
          task_id: task.id,
          title: task.title,
        },
      });
      return jsonResponse({ plan_id: planId, task }, 200, origin);
    }

    if (action === 'complete') {
      const taskId = (body.task_id ?? '').trim();
      if (!taskId) {
        return jsonResponse({ error: 'task_id is required' }, 400, origin);
      }
      const etag = await fetchPlannerTaskEtag(accessToken, taskId);
      const updated = await completePlannerTask(accessToken, taskId, etag);
      const task = mapTask(updated);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'planner_complete',
        path: '/sales/calendar',
        metadata: {
          task_id: task.id,
          title: task.title,
          plan_id: task.plan_id,
        },
      });
      return jsonResponse({ task }, 200, origin);
    }

    return jsonResponse({ error: 'Unknown action' }, 400, origin);
  } catch (err) {
    console.error('microsoft-planner', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Planner request failed' },
      500,
      origin,
    );
  }
});
