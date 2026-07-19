/** How the portal can open a mail attachment for in-app viewing. */
export type MailAttachmentPreviewKind = 'inline' | 'office' | 'none';

const OFFICE_EXT = new Set([
  'doc',
  'docx',
  'docm',
  'dot',
  'dotx',
  'xls',
  'xlsx',
  'xlsm',
  'xlsb',
  'xlt',
  'xltx',
  'ppt',
  'pptx',
  'pptm',
  'pot',
  'potx',
  'pps',
  'ppsx',
  'odt',
  'ods',
  'odp',
  'rtf',
]);

const INLINE_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'pdf',
  'txt',
  'csv',
  'md',
  'log',
  'json',
  'xml',
  'html',
  'htm',
  'css',
  'js',
  'ts',
  'tsx',
  'jsx',
]);

const OFFICE_MIME_PREFIXES = [
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.',
  'application/vnd.oasis.opendocument.',
  'application/rtf',
  'text/rtf',
];

function fileExt(name: string): string {
  const base = name.trim().split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function mailAttachmentPreviewKind(
  name: string,
  contentType: string | null | undefined,
): MailAttachmentPreviewKind {
  const ct = (contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  const ext = fileExt(name);

  if (
    ct.startsWith('image/') ||
    ct === 'application/pdf' ||
    ct.startsWith('text/') ||
    ct === 'application/json' ||
    ct === 'application/xml' ||
    INLINE_EXT.has(ext)
  ) {
    return 'inline';
  }

  if (OFFICE_MIME_PREFIXES.some((p) => ct.startsWith(p)) || OFFICE_EXT.has(ext)) {
    return 'office';
  }

  return 'none';
}

export function base64ToBlobUrl(base64: string, contentType: string): string {
  const cleaned = base64.replace(/\s/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: contentType || 'application/octet-stream' });
  return URL.createObjectURL(blob);
}

/** Graph preview postParameters → hidden form fields (same as Files). */
export function parseGraphPreviewPostParameters(
  raw: string | null,
): Array<{ name: string; value: string }> {
  if (!raw) return [];
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  const out: Array<{ name: string; value: string }> = [];
  params.forEach((value, name) => {
    out.push({ name, value });
  });
  return out;
}
