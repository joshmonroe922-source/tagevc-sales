/** Custom open/click tracking for Graph-sent portal mail. */

const TRACKABLE_SCHEME = /^https?:\/\//i;

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function mailTrackingBaseUrl(): string {
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  if (!supabaseUrl) throw new Error('SUPABASE_URL is not configured');
  return `${supabaseUrl}/functions/v1/mail-tracking`;
}

export function openTrackingUrl(token: string, baseUrl?: string): string {
  const base = baseUrl ?? mailTrackingBaseUrl();
  return `${base}?action=open&t=${encodeURIComponent(token)}`;
}

export function clickTrackingUrl(
  token: string,
  destination: string,
  baseUrl?: string,
): string {
  const base = baseUrl ?? mailTrackingBaseUrl();
  const u = base64UrlEncode(destination);
  return `${base}?action=click&t=${encodeURIComponent(token)}&u=${u}`;
}

function isTrackableUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || !TRACKABLE_SCHEME.test(trimmed)) return false;
  if (trimmed.includes('mail-tracking')) return false;
  return true;
}

function wrapHref(href: string, token: string, baseUrl: string): string {
  if (!isTrackableUrl(href)) return href;
  return clickTrackingUrl(token, href, baseUrl);
}

function linkifyTextSegment(text: string, token: string, baseUrl: string): string {
  const urlRe = /(https?:\/\/[^\s<>"']+)/gi;
  return text.replace(urlRe, (match) => {
    if (!isTrackableUrl(match)) return match;
    const tracked = clickTrackingUrl(token, match, baseUrl);
    return `<a href="${tracked}">${match}</a>`;
  });
}

/** Inject click-wrapped links and a 1×1 open-tracking pixel into HTML body. */
export function injectMailTracking(
  html: string,
  token: string,
  baseUrl?: string,
): string {
  const base = baseUrl ?? mailTrackingBaseUrl();
  let body = html;

  body = body.replace(
    /<a\b([^>]*?)\bhref=["']([^"']+)["']([^>]*)>/gi,
    (full, before, href, after) => {
      const tracked = wrapHref(href, token, base);
      if (tracked === href) return full;
      return `<a${before}href="${tracked}"${after}>`;
    },
  );

  const parts = body.split(/(<[^>]+>)/g);
  body = parts
    .map((part) => {
      if (part.startsWith('<')) return part;
      return linkifyTextSegment(part, token, base);
    })
    .join('');

  const pixel =
    `<img src="${openTrackingUrl(token, base)}" width="1" height="1" alt="" ` +
    `style="display:none;border:0;width:1px;height:1px" />`;

  if (/<\/body>/i.test(body)) {
    return body.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return `${body}${pixel}`;
}

/** 1×1 transparent GIF (43 bytes). */
export const TRANSPARENT_GIF = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0),
);
