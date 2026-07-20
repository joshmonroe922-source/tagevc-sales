export type ConversationKind = 'dm' | 'group' | 'channel';

export type DirectoryProfile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  active: boolean;
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
};
