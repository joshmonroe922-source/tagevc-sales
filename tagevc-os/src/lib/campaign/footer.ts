/**
 * Compliance footer + RFC 8058 headers. Cannot be stripped from marketing HTML.
 * Relationship tone for Target / Active-Buying / Active / Inactive — still keeps unsub.
 */

const PERMISSIONED_LIFECYCLES = new Set([
  'target',
  'active - buying',
  'active-buying',
  'active_buying',
  'active',
  'inactive',
]);

export function isPermissionedLifecycle(lifecycle?: string | null): boolean {
  if (!lifecycle) return false;
  return PERMISSIONED_LIFECYCLES.has(lifecycle.trim().toLowerCase());
}

export function buildComplianceFooter(input: {
  physicalAddress: string;
  unsubUrl: string;
  prefsUrl: string;
  lifecycle?: string | null;
  entityName?: string;
}): string {
  const addr = escapeHtml(input.physicalAddress || 'Address on file');
  const entity = escapeHtml(input.entityName || 'Tage');
  const relationship = isPermissionedLifecycle(input.lifecycle);

  if (relationship) {
    return `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #d7d3c3;font-size:12px;color:#7c7871;line-height:1.5;font-family:Georgia,serif">
  <p style="margin:0 0 8px">${addr}</p>
  <p style="margin:0">
    <a href="${escapeAttr(input.prefsUrl)}" style="color:#7c7871;text-decoration:underline">Manage preferences</a>
    <span style="margin:0 6px">·</span>
    <a href="${escapeAttr(input.unsubUrl)}" style="color:#9a9590;text-decoration:underline">Unsubscribe</a>
  </p>
</div>`.trim();
  }

  return `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #d7d3c3;font-size:12px;color:#7c7871;line-height:1.5;font-family:system-ui,sans-serif">
  <p style="margin:0 0 8px">You are receiving this from ${entity}.</p>
  <p style="margin:0 0 8px">${addr}</p>
  <p style="margin:0">
    <a href="${escapeAttr(input.prefsUrl)}" style="color:#3a414f">Preference center</a>
    <span style="margin:0 6px">·</span>
    <a href="${escapeAttr(input.unsubUrl)}" style="color:#3a414f">Unsubscribe</a>
  </p>
</div>`.trim();
}

/** Inject footer once — idempotent marker. */
export function injectComplianceFooter(
  html: string,
  footerHtml: string,
): string {
  if (html.includes('data-ecc-footer="1"')) return html;
  const wrapped = `<div data-ecc-footer="1">${footerHtml}</div>`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${wrapped}</body>`);
  }
  return `${html}\n${wrapped}`;
}

export function buildMarketingHeaders(input: {
  unsubUrl: string;
  unsubMailto?: string;
  listId: string;
  campaignId: string;
  entityId: string;
}): Record<string, string> {
  const listUnsub = input.unsubMailto
    ? `<${input.unsubUrl}>, <mailto:${input.unsubMailto}>`
    : `<${input.unsubUrl}>`;
  return {
    'List-Unsubscribe': listUnsub,
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

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
