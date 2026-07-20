/**
 * MDM / Intune lifecycle webhook hooks (Phases 25–26).
 * Set MDM_WEBHOOK_URL (+ optional MDM_WEBHOOK_SECRET).
 */

export async function invokeMdmLifecycleHook(input: {
  action: 'offboard' | 'onboard';
  user_id: string;
  run_id: string;
  entity_id?: string | null;
}): Promise<{ ok: boolean; skipped?: boolean; detail: string }> {
  const url = process.env.MDM_WEBHOOK_URL?.trim();
  if (!url) {
    return {
      ok: false,
      skipped: true,
      detail: 'MDM_WEBHOOK_URL not set — complete manually',
    };
  }
  try {
    const secret = process.env.MDM_WEBHOOK_SECRET?.trim();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({
        action: input.action,
        user_id: input.user_id,
        run_id: input.run_id,
        entity_id: input.entity_id ?? null,
        source: 'tagevc-os',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        detail: `MDM HTTP ${res.status}: ${text.slice(0, 120)}`,
      };
    }
    return { ok: true, detail: `MDM ${input.action} webhook accepted` };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'MDM webhook failed',
    };
  }
}

/** @deprecated Prefer invokeMdmLifecycleHook({ action: 'offboard', … }) */
export async function invokeMdmOffboardHook(input: {
  user_id: string;
  run_id: string;
  entity_id?: string | null;
}) {
  return invokeMdmLifecycleHook({ ...input, action: 'offboard' });
}
