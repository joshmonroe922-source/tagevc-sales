/** Service-role audit inserts for Microsoft calendar / tasks edge functions. */

// deno-lint-ignore no-explicit-any
export async function auditMsAction(
  service: any,
  opts: {
    userId: string;
    email: string;
    eventType: string;
    path?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await service.rpc('insert_audit_event', {
      p_user_id: opts.userId,
      p_email: opts.email,
      p_event_type: opts.eventType,
      p_path: opts.path ?? '/sales/calendar',
      p_metadata: opts.metadata ?? {},
    });
  } catch (err) {
    console.warn('auditMsAction failed', opts.eventType, err);
  }
}
