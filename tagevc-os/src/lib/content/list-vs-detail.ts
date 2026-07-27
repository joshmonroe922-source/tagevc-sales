/**
 * List vs detail HTML policy.
 *
 * LIST queries — select id + summary fields only. Never description_html /
 * large HTML bodies.
 * DETAIL queries — one row; may include description_html + description_text.
 * RENDER detail only via sanitized HTML (sanitize on write; trust store).
 */

/** Columns safe for job / task / content list payloads. */
export const JOB_LIST_SELECT_COLUMNS = [
  'id',
  'title',
  'status',
  'location',
  'owner_id',
  'posted_at',
] as const;

/** Columns for a single job detail row (includes HTML body). */
export const JOB_DETAIL_SELECT_COLUMNS = [
  'id',
  'title',
  'status',
  'location',
  'owner_id',
  'posted_at',
  'description_html',
  'description_text',
] as const;

/** SSC checklist task list — no HTML bodies. */
export const SSC_TASK_LIST_SELECT_COLUMNS = [
  'id',
  'instance_id',
  'template_key',
  'title',
  'status',
  'due_date',
  'owner_role',
  'entity_id',
  'function_key',
  'risk_level',
  'evidence_ticket_id',
] as const;

export function assertNoHtmlInListSelect(selectClause: string): boolean {
  const lower = selectClause.toLowerCase().replace(/\s+/g, '');
  if (lower === '*' || lower.includes('description_html')) return false;
  if (lower.includes('body_html') || lower.includes('content_html')) {
    return false;
  }
  return true;
}
