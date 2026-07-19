'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  createMaTarget,
  updateMaStage,
  updateMaTaskStatus,
} from '@/lib/data/ma-store';
import {
  MA_DEAL_TYPES,
  MA_STAGES,
  PRIORITIES,
  TASK_STATUSES,
} from '@/lib/types';

export type ActionResult =
  | { ok: true; maId?: string; message?: string }
  | { ok: false; error: string };

function revalidateMa(maId?: string) {
  revalidatePath('/deal-flow');
  revalidatePath('/deal-flow/ma');
  if (maId) revalidatePath(`/deal-flow/ma/${maId}`);
}

const createSchema = z.object({
  company_name: z.string().min(1, 'Target company is required'),
  website: z.string().optional(),
  sector: z.string().optional(),
  deal_type: z.enum(MA_DEAL_TYPES).optional(),
  source: z.string().optional(),
  owner: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  enterprise_value_m: z.coerce.number().optional(),
  revenue_m: z.coerce.number().optional(),
  ebitda_m: z.coerce.number().optional(),
  notes: z.string().optional(),
});

export async function createMaTargetAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createSchema.safeParse({
    company_name: formData.get('company_name'),
    website: formData.get('website') || undefined,
    sector: formData.get('sector') || undefined,
    deal_type: formData.get('deal_type') || undefined,
    source: formData.get('source') || undefined,
    owner: formData.get('owner') || undefined,
    priority: formData.get('priority') || undefined,
    enterprise_value_m: formData.get('enterprise_value_m') || undefined,
    revenue_m: formData.get('revenue_m') || undefined,
    ebitda_m: formData.get('ebitda_m') || undefined,
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }
  try {
    const target = createMaTarget(parsed.data);
    revalidateMa(target.ma_id);
    return { ok: true, maId: target.ma_id, message: `Created ${target.ma_id}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function changeMaStageAction(
  maId: string,
  stage: string,
): Promise<ActionResult> {
  if (!(MA_STAGES as readonly string[]).includes(stage)) {
    return { ok: false, error: 'Invalid M&A stage' };
  }
  try {
    const { spawned } = updateMaStage(
      maId,
      stage as (typeof MA_STAGES)[number],
    );
    revalidateMa(maId);
    return {
      ok: true,
      maId,
      message:
        spawned.length > 0
          ? `Moved to ${stage}; spawned ${spawned.length} task(s)`
          : `Moved to ${stage}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function setMaTaskStatusAction(
  taskId: string,
  status: string,
  maId: string,
): Promise<ActionResult> {
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: 'Invalid status' };
  }
  try {
    updateMaTaskStatus(taskId, status as (typeof TASK_STATUSES)[number]);
    revalidateMa(maId);
    return { ok: true, maId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}
