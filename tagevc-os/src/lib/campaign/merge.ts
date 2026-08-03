/**
 * Merge field catalog + Liquid-lite renderer (contact/account/owner/context/system).
 * Never prints raw {{tokens}}; escapes HTML unless html_safe.
 */

import type { MergeField } from '@/lib/campaign/types';

const DENY_FIELDS = new Set([
  'ssn',
  'bank_account',
  'password_hash',
  'password',
  'ssn_last4',
  'tax_id',
]);

export const DEFAULT_MERGE_FIELDS: MergeField[] = [
  {
    object: 'contact',
    api_name: 'first_name',
    label: 'First name',
    data_type: 'text',
    group: 'Contact',
    insert_token: '{{contact.first_name | default: "there"}}',
    sensitive: false,
    sample_value: 'Alex',
  },
  {
    object: 'contact',
    api_name: 'last_name',
    label: 'Last name',
    data_type: 'text',
    group: 'Contact',
    insert_token: '{{contact.last_name}}',
    sensitive: false,
    sample_value: 'Rivera',
  },
  {
    object: 'contact',
    api_name: 'full_name',
    label: 'Full name',
    data_type: 'text',
    group: 'Contact',
    insert_token: '{{contact.full_name}}',
    sensitive: false,
    sample_value: 'Alex Rivera',
  },
  {
    object: 'contact',
    api_name: 'primary_email',
    label: 'Email',
    data_type: 'email',
    group: 'Contact',
    insert_token: '{{contact.primary_email}}',
    sensitive: false,
    sample_value: 'alex@example.com',
  },
  {
    object: 'contact',
    api_name: 'title',
    label: 'Title',
    data_type: 'text',
    group: 'Contact',
    insert_token: '{{contact.title}}',
    sensitive: false,
    sample_value: 'VP Operations',
  },
  {
    object: 'contact',
    api_name: 'lifecycle',
    label: 'Lifecycle',
    data_type: 'text',
    group: 'Contact',
    insert_token: '{{contact.lifecycle}}',
    sensitive: false,
    sample_value: 'Active',
  },
  {
    object: 'account',
    api_name: 'name',
    label: 'Account name',
    data_type: 'text',
    group: 'Account',
    insert_token: '{{account.name}}',
    sensitive: false,
    sample_value: 'Acme Corp',
  },
  {
    object: 'account',
    api_name: 'canonical_domain',
    label: 'Domain',
    data_type: 'text',
    group: 'Account',
    insert_token: '{{account.canonical_domain}}',
    sensitive: false,
    sample_value: 'acme.com',
  },
  {
    object: 'account',
    api_name: 'industry',
    label: 'Industry',
    data_type: 'text',
    group: 'Account',
    insert_token: '{{account.industry}}',
    sensitive: false,
    sample_value: 'Technology',
  },
  {
    object: 'owner',
    api_name: 'full_name',
    label: 'Owner name',
    data_type: 'text',
    group: 'Owner',
    insert_token: '{{owner.full_name}}',
    sensitive: false,
    sample_value: 'Josh Monroe',
  },
  {
    object: 'owner',
    api_name: 'email',
    label: 'Owner email',
    data_type: 'email',
    group: 'Owner',
    insert_token: '{{owner.email}}',
    sensitive: false,
    sample_value: 'joshmonroe@tagevc.com',
  },
  {
    object: 'owner',
    api_name: 'title',
    label: 'Owner title',
    data_type: 'text',
    group: 'Owner',
    insert_token: '{{owner.title}}',
    sensitive: false,
    sample_value: 'Owner / CEO',
  },
  {
    object: 'context',
    api_name: 'job.title',
    label: 'Job title',
    data_type: 'text',
    group: 'Context',
    insert_token: '{{context.job.title}}',
    sensitive: false,
    sample_value: 'Staff Recruiter',
  },
  {
    object: 'context',
    api_name: 'nda.document_title',
    label: 'NDA document',
    data_type: 'text',
    group: 'Context',
    insert_token: '{{context.nda.document_title}}',
    sensitive: false,
    sample_value: 'Mutual NDA',
  },
  {
    object: 'system',
    api_name: 'entity_name',
    label: 'Entity name',
    data_type: 'text',
    group: 'System',
    insert_token: '{{system.entity_name}}',
    sensitive: false,
    sample_value: 'Tage Venture Capital',
  },
  {
    object: 'system',
    api_name: 'unsubscribe_url',
    label: 'Unsubscribe URL',
    data_type: 'url',
    group: 'System',
    insert_token: '{{system.unsubscribe_url}}',
    sensitive: false,
  },
  {
    object: 'system',
    api_name: 'preferences_url',
    label: 'Preferences URL',
    data_type: 'url',
    group: 'System',
    insert_token: '{{system.preferences_url}}',
    sensitive: false,
  },
];

export type MergeContext = {
  contact?: Record<string, unknown>;
  account?: Record<string, unknown>;
  owner?: Record<string, unknown>;
  context?: Record<string, unknown>;
  system?: Record<string, unknown>;
  sender?: { signature?: string };
};

function getPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Resolve {{ns.path | default: "x"}} tokens. */
export function renderMergeTemplate(
  template: string,
  ctx: MergeContext,
  opts?: { htmlSafeFields?: Set<string> },
): { rendered: string; missing: string[] } {
  const missing: string[] = [];
  const htmlSafe = opts?.htmlSafeFields ?? new Set(['sender.signature']);

  const rendered = template.replace(
    /\{\{\s*([a-zA-Z0-9_.]+)(?:\s*\|\s*default:\s*"([^"]*)")?\s*\}\}/g,
    (_full, rawPath: string, fallback?: string) => {
      const path = String(rawPath);
      const leaf = path.split('.').pop() ?? path;
      if (DENY_FIELDS.has(leaf.toLowerCase())) return '';

      const [ns, ...rest] = path.split('.');
      const restPath = rest.join('.');
      let value: unknown;
      switch (ns) {
        case 'contact':
          value = getPath(ctx.contact, restPath);
          break;
        case 'account':
        case 'company':
          value = getPath(ctx.account, restPath);
          break;
        case 'owner':
          value = getPath(ctx.owner, restPath);
          break;
        case 'context':
          value = getPath(ctx.context, restPath);
          break;
        case 'system':
          value = getPath(ctx.system, restPath);
          break;
        case 'sender':
          value = getPath(ctx.sender, restPath);
          break;
        default:
          value = undefined;
      }

      if (value == null || value === '') {
        if (fallback !== undefined) return escapeHtml(fallback);
        missing.push(path);
        return '';
      }

      const str = String(value);
      if (htmlSafe.has(path)) return str;
      return escapeHtml(str);
    },
  );

  return { rendered, missing: [...new Set(missing)] };
}

export function filterMergeFieldsForAcl(fields: MergeField[]): MergeField[] {
  return fields.filter(
    (f) => !f.sensitive && !DENY_FIELDS.has(f.api_name.toLowerCase()),
  );
}
