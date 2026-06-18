import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type InboxAgent = Tables<{ schema: 'inbox' }, 'agents'>;
export type InboxConversation = Tables<{ schema: 'inbox' }, 'conversations'>;
export type InboxConversationInsert = TablesInsert<{ schema: 'inbox' }, 'conversations'>;
export type InboxConversationUpdate = TablesUpdate<{ schema: 'inbox' }, 'conversations'>;

export type InboxConversationParticipant = Tables<{ schema: 'inbox' }, 'conversation_participants'>;
export type InboxConversationParticipantInsert = TablesInsert<{ schema: 'inbox' }, 'conversation_participants'>;

export type InboxMessage = Tables<{ schema: 'inbox' }, 'messages'>;
export type InboxMessageInsert = TablesInsert<{ schema: 'inbox' }, 'messages'>;
export type InboxMessageUpdate = TablesUpdate<{ schema: 'inbox' }, 'messages'>;

export type InboxMessageAttachment = Tables<{ schema: 'inbox' }, 'message_attachments'>;
export type InboxMessageAttachmentInsert = TablesInsert<{ schema: 'inbox' }, 'message_attachments'>;

export type InboxTag = Tables<{ schema: 'inbox' }, 'tags'>;
export type InboxConversationTag = Tables<{ schema: 'inbox' }, 'conversation_tags'>;

export type InboxMention = Tables<{ schema: 'inbox' }, 'mentions'>;
export type InboxMentionInsert = TablesInsert<{ schema: 'inbox' }, 'mentions'>;

export type InboxOutboundEventInsert = TablesInsert<{ schema: 'inbox' }, 'outbound_events'>;

export interface InboxTeamMember {
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  display_name: string | null;
  avatar_url: string | null;
}

export interface InboxConversationView extends InboxConversation {
  unread_count: number;
  mention_count: number;
  participants: InboxConversationParticipant[];
  tags: InboxTag[];
  agent: InboxAgent | null;
}

export interface InboxMessageView extends InboxMessage {
  attachments: InboxMessageAttachment[];
}

export type InboxFilter = 'you' | 'mentions' | 'all' | 'archive' | 'tag';

