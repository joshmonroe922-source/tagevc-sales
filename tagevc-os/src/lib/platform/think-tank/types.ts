/**
 * Think Tank DTOs + constants — portable across Tage / R619 / INDA / Signent.
 * Copy `src/lib/platform/think-tank/` into each new entity OS.
 */

export const THINK_TANK_PORTAL_KEYS = ['tage', 'r619', 'inda', 'signent'] as const;
export type ThinkTankPortalKey = (typeof THINK_TANK_PORTAL_KEYS)[number];

export const THINK_TANK_ENTITY_OS = {
  tage: 'ENT-FIRM',
  r619: 'ENT-R619',
  inda: 'ENT-INDA',
  signent: 'ENT-SIGNENT',
} as const;

export const THINK_TANK_BUCKET = 'os-think-tank';
export const THINK_TANK_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const THINK_TANK_MAX_ATTACHMENTS = 10;
export const THINK_TANK_MAX_MESSAGE = 8000;
export const THINK_TANK_ATTACHMENT_CONTEXT_CHARS = 12_000;
export const THINK_TANK_RATE_PER_MINUTE = 12;
export const THINK_TANK_DEFAULT_TITLE = 'New thread';

export const THINK_TANK_ALLOWED_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
  '.md',
  '.html',
  '.htm',
] as const;

export const THINK_TANK_ALLOWED_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/csv',
] as const;

/** Browsers often omit MIME or send a generic zip/OLE type for Office files. */
const THINK_TANK_GENERIC_MIMES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.ms-office',
]);

export const THINK_TANK_FILE_ACCEPT = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
  '.md',
  '.html',
  '.htm',
  ...THINK_TANK_ALLOWED_MIMES,
].join(',');

export function thinkTankFileExtension(fileName: string): string | null {
  const base = (fileName.split(/[/\\]/).pop() ?? '').toLowerCase();
  const match = base.match(/(\.[a-z0-9]+)$/);
  if (!match) return null;
  return (THINK_TANK_ALLOWED_EXTENSIONS as readonly string[]).includes(match[1])
    ? match[1]
    : null;
}

/** Server-side gate: allowed extension AND (allowed or generic MIME). */
export function isThinkTankAllowedFile(fileName: string, mimeType: string): boolean {
  if (!thinkTankFileExtension(fileName)) return false;
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim();
  if (THINK_TANK_GENERIC_MIMES.has(mime)) return true;
  return (THINK_TANK_ALLOWED_MIMES as readonly string[]).includes(mime);
}

export type ThinkTankThreadDto = {
  id: string;
  title: string;
  roleHint: string | null;
  entityOs: string;
  updatedAt: string;
  createdAt: string;
};

export type ThinkTankMessageDto = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  createdAt: string;
};

export type ThinkTankAttachmentDto = {
  id: string;
  conversationId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  signedUrl?: string | null;
  extractError?: string | null;
};

export type ThinkTankDeskState = {
  threads: ThinkTankThreadDto[];
  conversationId: string | null;
  messages: ThinkTankMessageDto[];
  attachments: ThinkTankAttachmentDto[];
  entityOs: string;
  roleBand: string;
  viewAsLabel: string | null;
};

export type ThinkTankSendResult =
  | {
      conversationId: string;
      thread: ThinkTankThreadDto;
      userMessage: ThinkTankMessageDto;
      assistantMessage: ThinkTankMessageDto;
      model: string | null;
    }
  | { error: string };

export type ThinkTankLlmMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ThinkTankLlmResult = {
  content: string | null;
  model: string | null;
  provider?: string | null;
  error?: string;
};
