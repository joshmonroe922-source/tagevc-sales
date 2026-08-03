import { PERMISSIONED_LIFECYCLES } from './types';

export function buildComplianceFooter(input: {
  physicalAddress: string;
  unsubscribeUrl?: string;
  preferencesUrl?: string;
  /** Aliases used by orchestrator */
  unsubUrl?: string;
  prefsUrl?: string;
  lifecycle?: string | null;
  entityName?: string;
}): string {
  const unsubscribeUrl = input.unsubscribeUrl || input.unsubUrl || '#';
  const preferencesUrl = input.preferencesUrl || input.prefsUrl || unsubscribeUrl;
  const relationship = input.lifecycle
    ? PERMISSIONED_LIFECYCLES.has(input.lifecycle)
    : false;
  const addr = escapeHtml(input.physicalAddress || 'Physical address on file');
  const entity = escapeHtml(input.entityName || '');
  if (relationship) {
    return `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;line-height:1.5">
  <p style="margin:0 0 6px">${entity ? `${entity} · ` : ''}${addr}</p>
  <p style="margin:0"><a href="${attr(preferencesUrl)}" style="color:#9ca3af">Manage preferences</a>
  · <a href="${attr(unsubscribeUrl)}" style="color:#9ca3af">Unsubscribe</a></p>
</div>`;
  }
  return `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;line-height:1.5">
  <p style="margin:0 0 8px">You are receiving this email from ${entity || 'our team'}.</p>
  <p style="margin:0 0 8px">${addr}</p>
  <p style="margin:0"><a href="${attr(preferencesUrl)}">Update preferences</a>
  · <a href="${attr(unsubscribeUrl)}">Unsubscribe</a></p>
</div>`;
}

export function injectFooter(html: string, footerHtml: string): string {
  if (html.includes('data-ecc-footer="1"')) return html;
  const wrapped = `<div data-ecc-footer="1">${footerHtml}</div>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${wrapped}</body>`);
  return `${html}${wrapped}`;
}

export function marketingHeaders(input: {
  unsubscribeUrl?: string;
  unsubUrl?: string;
  listId: string;
  campaignId: string;
  entityId: string;
}): Record<string, string> {
  const unsubscribeUrl = input.unsubscribeUrl || input.unsubUrl || '#';
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'List-ID': `<${input.listId}>`,
    'X-Entity-Ref': input.entityId,
    'X-Campaign-Id': input.campaignId,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
