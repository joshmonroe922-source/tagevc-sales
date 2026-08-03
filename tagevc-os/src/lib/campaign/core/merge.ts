import type { MergeField } from './types';

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)(?:\s*\|\s*default:\s*"([^"]*)")?\s*\}\}/g;

export const DEFAULT_MERGE_FIELDS: MergeField[] = [
  { object: 'contact', api_name: 'first_name', label: 'First name', data_type: 'text', sensitive: false, insert_token: '{{contact.first_name | default: "there"}}', sample_value: 'Alex' },
  { object: 'contact', api_name: 'last_name', label: 'Last name', data_type: 'text', sensitive: false, insert_token: '{{contact.last_name}}', sample_value: 'Rivera' },
  { object: 'contact', api_name: 'full_name', label: 'Full name', data_type: 'text', sensitive: false, insert_token: '{{contact.full_name}}', sample_value: 'Alex Rivera' },
  { object: 'contact', api_name: 'primary_email', label: 'Email', data_type: 'email', sensitive: false, insert_token: '{{contact.primary_email}}', sample_value: 'alex@example.com' },
  { object: 'contact', api_name: 'title', label: 'Title', data_type: 'text', sensitive: false, insert_token: '{{contact.title}}', sample_value: 'VP Operations' },
  { object: 'account', api_name: 'name', label: 'Account name', data_type: 'text', sensitive: false, insert_token: '{{account.name}}', sample_value: 'Acme Corp' },
  { object: 'owner', api_name: 'full_name', label: 'Owner name', data_type: 'text', sensitive: false, insert_token: '{{owner.full_name}}', sample_value: 'Josh Monroe' },
  { object: 'system', api_name: 'entity_name', label: 'Entity name', data_type: 'text', sensitive: false, insert_token: '{{system.entity_name}}', sample_value: 'Tage Venture Capital' },
  { object: 'system', api_name: 'unsubscribe_url', label: 'Unsubscribe URL', data_type: 'url', sensitive: false, insert_token: '{{system.unsubscribe_url}}' },
  { object: 'system', api_name: 'preferences_url', label: 'Preferences URL', data_type: 'url', sensitive: false, insert_token: '{{system.preferences_url}}' },
];

export type MergeRenderResult = { rendered: string; html: string; missing: string[] };

export function catalogToFields(
  rows: Array<{
    object_name: string;
    api_name: string;
    label: string;
    data_type: string;
    sensitive: boolean;
    allow: boolean;
  }>,
): MergeField[] {
  return rows
    .filter((r) => r.allow && !r.sensitive)
    .map((r) => ({
      object: r.object_name,
      api_name: r.api_name,
      label: r.label,
      data_type: r.data_type,
      sensitive: r.sensitive,
      insert_token: `{{${r.object_name}.${r.api_name}}}`,
    }));
}

export function renderMergeTemplate(
  template: string,
  ctx: Record<string, Record<string, unknown>>,
): MergeRenderResult {
  const missing: string[] = [];
  const rendered = template.replace(TOKEN_RE, (_m, path: string, fallback?: string) => {
    const [ns, ...rest] = path.split('.');
    const key = rest.join('.');
    const bag = ctx[ns] || {};
    const val: unknown = key ? bag[key] : undefined;
    if (val == null || val === '') {
      if (fallback != null) return escapeHtml(fallback);
      missing.push(path);
      return '';
    }
    return escapeHtml(String(val));
  });
  return { rendered, html: rendered, missing: [...new Set(missing)] };
}

export function assertNoRawTokens(html: string): string[] {
  const left: string[] = [];
  const re = /\{\{\s*([a-zA-Z0-9_.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) left.push(m[1]);
  return left;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
