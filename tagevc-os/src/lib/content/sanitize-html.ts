/**
 * Sanitize rich HTML on write. Prefer storing html + plain-text derivative.
 * Lists should never re-sanitize every row at render time.
 */

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'a',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'code',
  'pre',
  'span',
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'rel', 'target']),
  span: new Set(['class']),
};

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

function isSafeHref(href: string): boolean {
  const t = href.trim().toLowerCase();
  return (
    t.startsWith('https://') ||
    t.startsWith('http://') ||
    t.startsWith('mailto:') ||
    t.startsWith('/') ||
    t.startsWith('#')
  );
}

/**
 * Lightweight HTML sanitizer for job / content descriptions.
 * Not a full DOMPurify replacement — strips scripts, events, and disallowed tags.
 */
export function sanitizeRichHtml(input: string | null | undefined): string {
  if (!input) return '';
  let html = stripTags(String(input));

  html = html.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (full, tagRaw, attrsRaw) => {
    const tag = String(tagRaw).toLowerCase();
    const closing = full.startsWith('</');
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (closing) return `</${tag}>`;

    const attrs = String(attrsRaw ?? '');
    const allowed = ALLOWED_ATTRS[tag];
    if (!allowed || allowed.size === 0) return `<${tag}>`;

    const kept: string[] = [];
    const re = /([a-z0-9:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(attrs))) {
      const name = m[1].toLowerCase();
      if (!allowed.has(name)) continue;
      const value = m[3] ?? m[4] ?? m[5] ?? '';
      if (name === 'href' && !isSafeHref(value)) continue;
      if (name === 'target' && value !== '_blank') continue;
      kept.push(`${name}="${value.replace(/"/g, '&quot;')}"`);
    }
    if (tag === 'a' && kept.some((k) => k.startsWith('target='))) {
      if (!kept.some((k) => k.startsWith('rel='))) {
        kept.push('rel="noopener noreferrer"');
      }
    }
    return kept.length ? `<${tag} ${kept.join(' ')}>` : `<${tag}>`;
  });

  return html.trim();
}

/** Plain-text derivative for list snippets / search. */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, '\n')
    .trim();
}

/** Sanitize on save — returns both derivatives. */
export function sanitizeRichContentOnWrite(rawHtml: string | null | undefined): {
  description_html: string;
  description_text: string;
} {
  const description_html = sanitizeRichHtml(rawHtml);
  return {
    description_html,
    description_text: htmlToPlainText(description_html),
  };
}
