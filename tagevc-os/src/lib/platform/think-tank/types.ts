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
  '.txt',
  '.md',
  '.csv',
  '.html',
  '.htm',
] as const;

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
