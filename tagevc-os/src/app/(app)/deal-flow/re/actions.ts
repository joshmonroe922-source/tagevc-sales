'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  createReDeal,
  updateReStage,
  updateReTaskStatus,
} from '@/lib/data/re-store';
import {
  PRIORITIES,
  RE_ROUTES,
  RE_STAGES,
  TASK_STATUSES,
} from '@/lib/types';

export type ActionResult =
  | { ok: true; reId?: string; message?: string }
  | { ok: false; error: string };

function revalidateRe(reId?: string) {
  revalidatePath('/deal-flow');
  revalidatePath('/deal-flow/re');
  if (reId) revalidatePath(`/deal-flow/re/${reId}`);
}

const createSchema = z.object({
  asset_name: z.string().min(1, 'Asset / address is required'),
  route: z.enum(RE_ROUTES),
  asset_type: z.string().optional(),
  market: z.string().optional(),
  source: z.string().optional(),
  sourcer: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  ask_k: z.coerce.number().optional(),
  notes: z.string().optional(),
});

export async function createReDealAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createSchema.safeParse({
    asset_name: formData.get('asset_name'),
    route: formData.get('route'),
    asset_type: formData.get('asset_type') || undefined,
    market: formData.get('market') || undefined,
    source: formData.get('source') || undefined,
    sourcer: formData.get('sourcer') || undefined,
    priority: formData.get('priority') || undefined,
    ask_k: formData.get('ask_k') || undefined,
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }
  try {
    const deal = createReDeal(parsed.data);
    revalidateRe(deal.re_id);
    return { ok: true, reId: deal.re_id, message: `Created ${deal.re_id}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function changeReStageAction(
  reId: string,
  stage: string,
): Promise<ActionResult> {
  if (!(RE_STAGES as readonly string[]).includes(stage)) {
    return { ok: false, error: 'Invalid RE stage' };
  }
  try {
    const { spawned } = updateReStage(
      reId,
      stage as (typeof RE_STAGES)[number],
    );
    revalidateRe(reId);
    return {
      ok: true,
      reId,
      message:
        spawned.length > 0
          ? `Moved to ${stage}; spawned ${spawned.length} task(s)`
          : `Moved to ${stage}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function setReTaskStatusAction(
  taskId: string,
  status: string,
  reId: string,
): Promise<ActionResult> {
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: 'Invalid status' };
  }
  try {
    updateReTaskStatus(taskId, status as (typeof TASK_STATUSES)[number]);
    revalidateRe(reId);
    return { ok: true, reId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}
