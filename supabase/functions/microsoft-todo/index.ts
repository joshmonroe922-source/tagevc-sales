import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  createTodoList,
  createTodoTask,
  fetchTodoLists,
  fetchTodoTasks,
  getMsConfig,
  getValidAccessToken,
  patchTodoTask,
  requireActiveSalesUser,
  type TodoImportance,
  type TodoList,
} from '../_shared/microsoftGraph.ts';
import { auditMsAction } from '../_shared/msAudit.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

const MASTER_TODO_SLUG = 'master';
const MASTER_TODO_DISPLAY = 'Tage · Master';

const PORTAL_TODO_NAMES: Record<string, string> = {
  [MASTER_TODO_SLUG]: MASTER_TODO_DISPLAY,
  personal: 'Tage · Personal',
  'deal-sourcing': 'Tage · Deal Sourcing',
  'due-diligence': 'Tage · Due Diligence',
  'new-start-up': 'Tage · New Start Up',
  'new-acquisition': 'Tage · New Mergers & Acquisitions',
  'manage-portfolio': 'Tage · Manage Portfolio',
  'executive-leadership': 'Tage · Executive Leadership',
  reporting: 'Tage · Reporting',
  'accounting-finance': 'Tage · Accounting and Finance',
  legal: 'Tage · Legal',
  marketing: 'Tage · Marketing',
  technology: 'Tage · Technology',
  'human-resources': 'Tage · Human Resources',
};

type Body = {
  action?:
    | 'lists'
    | 'list'
    | 'create'
    | 'complete'
    | 'update'
    | 'ensure_list'
    | 'master';
  list_id?: string;
  task_id?: string;
  title?: string;
  body?: string;
  due?: string | null;
  importance?: string | null;
  time_zone?: string | null;
  portal_slug?: string | null;
  /** When action=master, only ensure/load these portal lists (assigned portals). */
  portal_slugs?: string[] | null;
};

function normalizeImportance(raw: string | null | undefined): TodoImportance | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'low' || v === 'normal' || v === 'high') return v;
  return null;
}

function portalListDisplayName(slug: string): string | null {
  const key = slug.trim();
  return PORTAL_TODO_NAMES[key] ?? null;
}

function mapTask(t: {
  id: string;
  title: string;
  status: string;
  importance: string | null;
  dueDateTime: { dateTime: string; timeZone: string } | null;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  body?: { content?: string | null } | null;
}) {
  return {
    id: t.id,
    title: t.title || '(No title)',
    status: t.status,
    importance: t.importance,
    due: t.dueDateTime?.dateTime ?? null,
    due_timezone: t.dueDateTime?.timeZone ?? null,
    created_at: t.createdDateTime ?? null,
    updated_at: t.lastModifiedDateTime ?? null,
    body_preview: t.body?.content?.slice(0, 500) ?? null,
    completed: t.status === 'completed',
  };
}

async function loadCachedListId(
  service: ReturnType<typeof createServiceClient>,
  salesUserId: string,
  portalSlug: string,
): Promise<string | null> {
  try {
    const { data, error } = await service
      .from('sales_user_todo_lists')
      .select('ms_list_id')
      .eq('sales_user_id', salesUserId)
      .eq('portal_slug', portalSlug)
      .maybeSingle();
    if (error) return null;
    return (data?.ms_list_id as string | undefined)?.trim() || null;
  } catch {
    return null;
  }
}

async function saveCachedListId(
  service: ReturnType<typeof createServiceClient>,
  salesUserId: string,
  portalSlug: string,
  msListId: string,
  displayName: string,
): Promise<void> {
  try {
    await service.from('sales_user_todo_lists').upsert(
      {
        sales_user_id: salesUserId,
        portal_slug: portalSlug,
        ms_list_id: msListId,
        list_display_name: displayName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'sales_user_id,portal_slug' },
    );
  } catch (err) {
    console.error('microsoft-todo save list cache', err);
  }
}

/** One shared list for the simple capture model: Tage · Master, else Graph defaultList. */
async function ensureMasterList(
  accessToken: string,
  service: ReturnType<typeof createServiceClient>,
  salesUserId: string,
): Promise<{ list: TodoList; display_name: string; created: boolean }> {
  const cached = await loadCachedListId(service, salesUserId, MASTER_TODO_SLUG);
  const lists = await fetchTodoLists(accessToken);

  if (cached) {
    const stillThere = lists.find((l) => l.id === cached);
    if (stillThere) {
      return {
        list: stillThere,
        display_name: stillThere.displayName || MASTER_TODO_DISPLAY,
        created: false,
      };
    }
  }

  const byMasterName = lists.find(
    (l) =>
      (l.displayName ?? '').trim().toLowerCase() === MASTER_TODO_DISPLAY.toLowerCase(),
  );
  if (byMasterName) {
    await saveCachedListId(
      service,
      salesUserId,
      MASTER_TODO_SLUG,
      byMasterName.id,
      MASTER_TODO_DISPLAY,
    );
    return { list: byMasterName, display_name: MASTER_TODO_DISPLAY, created: false };
  }

  const defaultList =
    lists.find((l) => l.wellknownListName === 'defaultList') ?? lists[0];
  if (defaultList) {
    const display = defaultList.displayName || 'Tasks';
    await saveCachedListId(
      service,
      salesUserId,
      MASTER_TODO_SLUG,
      defaultList.id,
      display,
    );
    return { list: defaultList, display_name: display, created: false };
  }

  const created = await createTodoList(accessToken, MASTER_TODO_DISPLAY);
  await saveCachedListId(
    service,
    salesUserId,
    MASTER_TODO_SLUG,
    created.id,
    MASTER_TODO_DISPLAY,
  );
  return { list: created, display_name: MASTER_TODO_DISPLAY, created: true };
}

async function ensurePortalList(
  accessToken: string,
  service: ReturnType<typeof createServiceClient>,
  salesUserId: string,
  portalSlug: string,
): Promise<{ list: TodoList; display_name: string; created: boolean }> {
  if (portalSlug === MASTER_TODO_SLUG) {
    return ensureMasterList(accessToken, service, salesUserId);
  }

  const displayName = portalListDisplayName(portalSlug);
  if (!displayName) {
    throw new Error(`Unknown portal_slug: ${portalSlug}`);
  }

  const cached = await loadCachedListId(service, salesUserId, portalSlug);
  const lists = await fetchTodoLists(accessToken);

  if (cached) {
    const stillThere = lists.find((l) => l.id === cached);
    if (stillThere) {
      return { list: stillThere, display_name: displayName, created: false };
    }
  }

  const byName = lists.find(
    (l) => (l.displayName ?? '').trim().toLowerCase() === displayName.toLowerCase(),
  );
  if (byName) {
    await saveCachedListId(service, salesUserId, portalSlug, byName.id, displayName);
    return { list: byName, display_name: displayName, created: false };
  }

  const created = await createTodoList(accessToken, displayName);
  await saveCachedListId(service, salesUserId, portalSlug, created.id, displayName);
  return { list: created, display_name: displayName, created: true };
}

async function resolveListId(
  accessToken: string,
  service: ReturnType<typeof createServiceClient>,
  salesUserId: string,
  body: Body,
): Promise<{ listId: string; portalSlug: string | null }> {
  const portalSlug = (body.portal_slug ?? '').trim() || null;
  if (portalSlug) {
    const ensured = await ensurePortalList(accessToken, service, salesUserId, portalSlug);
    return { listId: ensured.list.id, portalSlug };
  }

  let listId = (body.list_id ?? '').trim();
  if (!listId) {
    // Default create/list with no portal → shared master list
    const ensured = await ensureMasterList(accessToken, service, salesUserId);
    return { listId: ensured.list.id, portalSlug: MASTER_TODO_SLUG };
  }
  return { listId, portalSlug: null };
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
    const action = body.action ?? 'list';

    let accessToken: string;
    try {
      const result = await getValidAccessToken(service, config, salesUser.id);
      accessToken = result.accessToken;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Not connected';
      return jsonResponse({ error: message, needs_reconnect: true }, 401, origin);
    }

    if (action === 'lists') {
      const lists = await fetchTodoLists(accessToken);
      return jsonResponse(
        {
          lists: lists.map((l) => ({
            id: l.id,
            display_name: l.displayName,
            wellknown: l.wellknownListName ?? null,
          })),
        },
        200,
        origin,
      );
    }

    if (action === 'ensure_list') {
      const portalSlug = (body.portal_slug ?? '').trim();
      if (!portalSlug) {
        return jsonResponse({ error: 'portal_slug is required' }, 400, origin);
      }
      const ensured = await ensurePortalList(
        accessToken,
        service,
        salesUser.id,
        portalSlug,
      );
      return jsonResponse(
        {
          list_id: ensured.list.id,
          display_name: ensured.display_name,
          portal_slug: portalSlug,
          created: ensured.created,
        },
        200,
        origin,
      );
    }

    if (action === 'master') {
      // Simple model: one shared master list (not per-portal aggregates).
      try {
        const ensured = await ensureMasterList(accessToken, service, salesUser.id);
        const tasks = await fetchTodoTasks(accessToken, ensured.list.id);
        return jsonResponse(
          {
            portals: [
              {
                portal_slug: MASTER_TODO_SLUG,
                list_id: ensured.list.id,
                display_name: ensured.display_name,
                tasks: tasks.map(mapTask),
              },
            ],
          },
          200,
          origin,
        );
      } catch (err) {
        console.error('microsoft-todo master', err);
        return jsonResponse(
          { error: err instanceof Error ? err.message : 'Failed to load master To Do' },
          500,
          origin,
        );
      }
    }

    let listId: string;
    let portalSlug: string | null;
    try {
      const resolved = await resolveListId(accessToken, service, salesUser.id, body);
      listId = resolved.listId;
      portalSlug = resolved.portalSlug;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not resolve To Do list';
      const status = message.includes('No Microsoft') ? 404 : 400;
      return jsonResponse({ error: message }, status, origin);
    }

    if (action === 'list') {
      const tasks = await fetchTodoTasks(accessToken, listId);
      return jsonResponse(
        {
          list_id: listId,
          portal_slug: portalSlug,
          tasks: tasks.map(mapTask),
        },
        200,
        origin,
      );
    }

    if (action === 'create') {
      const title = (body.title ?? '').trim();
      if (!title) {
        return jsonResponse({ error: 'title is required' }, 400, origin);
      }
      const importance = normalizeImportance(body.importance);
      const created = await createTodoTask(
        accessToken,
        listId,
        title,
        body.body ?? null,
        body.due ?? null,
        importance,
        body.time_zone ?? null,
      );
      const task = mapTask(created);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'todo_create',
        path: portalSlug ? `/sales/portals/${portalSlug}` : '/sales/todo',
        metadata: {
          list_id: listId,
          task_id: task.id,
          title: task.title,
          importance: task.importance,
          due: task.due,
          portal_slug: portalSlug,
        },
      });
      return jsonResponse(
        { list_id: listId, portal_slug: portalSlug, task },
        200,
        origin,
      );
    }

    if (action === 'update') {
      const taskId = (body.task_id ?? '').trim();
      if (!taskId) {
        return jsonResponse({ error: 'task_id is required' }, 400, origin);
      }

      const patch: Record<string, unknown> = {};
      if (typeof body.title === 'string') {
        const title = body.title.trim();
        if (!title) {
          return jsonResponse({ error: 'title cannot be empty' }, 400, origin);
        }
        patch.title = title;
      }

      if (body.due !== undefined) {
        if (body.due === null || String(body.due).trim() === '') {
          patch.dueDateTime = null;
        } else {
          const dueRaw = String(body.due).trim();
          const tz = (body.time_zone ?? 'UTC').trim() || 'UTC';
          const dateTime = dueRaw
            .replace(/Z$/, '')
            .replace(/([+-]\d{2}:\d{2})$/, '')
            .replace(/\.\d{3}$/, '');
          patch.dueDateTime = { dateTime, timeZone: tz };
        }
      }

      if (body.importance !== undefined) {
        const importance = normalizeImportance(body.importance);
        if (!importance) {
          return jsonResponse(
            { error: 'importance must be low, normal, or high' },
            400,
            origin,
          );
        }
        patch.importance = importance;
      }

      if (Object.keys(patch).length === 0) {
        return jsonResponse({ error: 'No fields to update' }, 400, origin);
      }

      const updated = await patchTodoTask(accessToken, listId, taskId, patch);
      const task = mapTask(updated);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'todo_update',
        path: portalSlug ? `/sales/portals/${portalSlug}` : '/sales/todo',
        metadata: {
          list_id: listId,
          task_id: task.id,
          title: task.title,
          importance: task.importance,
          due: task.due,
          patched: Object.keys(patch),
          portal_slug: portalSlug,
        },
      });
      return jsonResponse(
        { list_id: listId, portal_slug: portalSlug, task },
        200,
        origin,
      );
    }

    if (action === 'complete') {
      const taskId = (body.task_id ?? '').trim();
      if (!taskId) {
        return jsonResponse({ error: 'task_id is required' }, 400, origin);
      }
      const updated = await patchTodoTask(accessToken, listId, taskId, {
        status: 'completed',
      });
      const task = mapTask(updated);

      // Soft-mirror: mark matching Deal Sourcing follow-up done when present.
      try {
        await service
          .from('sales_tasks')
          .update({
            status: 'done',
            completed_at: new Date().toISOString(),
          })
          .eq('ms_todo_task_id', taskId)
          .eq('status', 'open');
      } catch (err) {
        console.error('microsoft-todo mirror sales_tasks', err);
      }

      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'todo_complete',
        path: portalSlug ? `/sales/portals/${portalSlug}` : '/sales/todo',
        metadata: {
          list_id: listId,
          task_id: task.id,
          title: task.title,
          portal_slug: portalSlug,
        },
      });
      return jsonResponse(
        { list_id: listId, portal_slug: portalSlug, task },
        200,
        origin,
      );
    }

    return jsonResponse({ error: 'Unknown action' }, 400, origin);
  } catch (err) {
    console.error('microsoft-todo', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'To Do request failed' },
      500,
      origin,
    );
  }
});
