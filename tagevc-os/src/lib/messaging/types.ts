export type ConversationKind = 'dm' | 'group' | 'channel';

export type DirectoryProfile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  active: boolean;
  /** Home / profile entity (canonical when available). */
  entity_id?: string | null;
  /** Display badge for multi-sub directory (P3). */
  entity_badge?: string | null;
};

export type ConversationMember = {
  user_id: string;
  member_role: 'owner' | 'member';
  last_read_at: string | null;
  joined_at: string;
  left_at: string | null;
  profile?: DirectoryProfile | null;
};

export type ConversationRow = {
  id: string;
  kind: ConversationKind;
  title: string | null;
  dm_key: string | null;
  entity_id: string | null;
  linked_ref_type: string | null;
  linked_ref_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  archived_at: string | null;
  is_private?: boolean;
  description?: string | null;
};

export type ConversationListItem = ConversationRow & {
  members: ConversationMember[];
  unread_count: number;
  display_title: string;
  peer_ids: string[];
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  parent_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  sender?: DirectoryProfile | null;
  reactions?: Array<{ emoji: string; count: number; mine: boolean }>;
  files?: MessageFile[];
};

export type MessageAttachment = {
  doc_id: string;
  title: string;
};

export type UploadedChatFile = {
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
};

export type MessageFile = {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  signed_url?: string | null;
};

export type AttachableDocument = {
  doc_id: string;
  title: string;
  entity_id: string | null;
  status: string;
};

export type NotificationPrefs = {
  user_id: string;
  email_digests: boolean;
  digest_frequency: 'off' | 'daily' | 'weekly';
  notify_mentions: boolean;
  notify_chat_messages: boolean;
  /** Phase 59: optional email for critical events only. */
  email_critical_digests?: boolean;
  /** Phase 59: in-app critical event alerts. */
  notify_critical_events?: boolean;
  /** Phase 59: in-app owner/assignee routing alerts. */
  notify_owner_assignments?: boolean;
  muted_conversation_ids: string[];
  updated_at: string;
};
