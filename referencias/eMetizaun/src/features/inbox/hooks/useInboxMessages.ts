import { useCallback, useEffect, useMemo, useState } from 'react';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizationContext } from '@/hooks/useOrganizationContext';

import type {
  InboxConversationView,
  InboxMentionInsert,
  InboxMessage,
  InboxMessageAttachment,
  InboxMessageAttachmentInsert,
  InboxMessageInsert,
  InboxMessageView,
  InboxOutboundEventInsert,
  InboxTeamMember,
} from '@/features/inbox/types';

interface UseInboxMessagesOptions {
  conversationId: string | null;
  conversation: InboxConversationView | null;
  mentionableUsers: InboxTeamMember[];
}

interface SendMessageInput {
  content: string;
  files?: File[];
  format?: InboxMessage['format'];
}

type InboxMessageRowWithAttachments = InboxMessage & {
  message_attachments: InboxMessageAttachment[] | null;
};

const URL_REGEX = /(https?:\/\/[^\s]+)/i;

const normalizeMentionValue = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();

const parseMentionedUserIds = (content: string, users: InboxTeamMember[], currentUserId: string | null) => {
  const mentions = content.match(/@([a-zA-Z0-9._-]+)/g) || [];
  if (!mentions.length) return [];

  const bySlug = new Map<string, string>();
  for (const user of users) {
    if (!user.display_name) continue;
    const slug = normalizeMentionValue(user.display_name);
    if (slug) {
      bySlug.set(slug, user.user_id);
    }
  }

  const ids = new Set<string>();
  for (const mention of mentions) {
    const normalized = normalizeMentionValue(mention.replace('@', ''));
    const directMatch = bySlug.get(normalized);
    if (directMatch && directMatch !== currentUserId) {
      ids.add(directMatch);
      continue;
    }

    for (const [slug, userId] of bySlug.entries()) {
      if (slug.startsWith(normalized) && userId !== currentUserId) {
        ids.add(userId);
        break;
      }
    }
  }

  return [...ids];
};

const mapMessageRows = (rows: InboxMessageRowWithAttachments[]): InboxMessageView[] => {
  return rows.map((row) => ({
    ...row,
    attachments: (row.message_attachments || []).sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ),
  })) as InboxMessageView[];
};

export function useInboxMessages({ conversationId, conversation, mentionableUsers }: UseInboxMessagesOptions) {
  const [messages, setMessages] = useState<InboxMessageView[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();

  const mentionCandidateMap = useMemo(() => new Map(mentionableUsers.map((member) => [member.user_id, member])), [mentionableUsers]);

  const markConversationRead = useCallback(async () => {
    if (!conversationId || !user?.id || !currentOrganization?.id) {
      return;
    }

    const timestamp = new Date().toISOString();

    await Promise.all([
      supabase
        .schema('inbox')
        .from('conversation_participants')
        .update({ last_read_at: timestamp })
        .eq('conversation_id', conversationId)
        .eq('organization_id', currentOrganization.id)
        .eq('user_id', user.id),
      supabase
        .schema('inbox')
        .from('mentions')
        .update({ is_read: true, read_at: timestamp })
        .eq('conversation_id', conversationId)
        .eq('organization_id', currentOrganization.id)
        .eq('mentioned_user_id', user.id)
        .eq('is_read', false),
    ]);
  }, [conversationId, currentOrganization?.id, user?.id]);

  const fetchMessages = useCallback(async () => {
    if (!conversationId || !currentOrganization?.id) {
      setMessages([]);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .schema('inbox')
        .from('messages')
        .select('*, message_attachments(*)')
        .eq('organization_id', currentOrganization.id)
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      setMessages(mapMessageRows((data || []) as InboxMessageRowWithAttachments[]));
      await markConversationRead();
    } catch (error) {
      console.error('Failed to fetch inbox messages:', error);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [conversationId, currentOrganization?.id, markConversationRead]);

  const sendMessage = useCallback(async ({ content, files = [], format = 'text' }: SendMessageInput) => {
    if (!conversationId || !currentOrganization?.id || !user?.id) {
      throw new Error('Conversation is not selected.');
    }

    if (!content.trim() && files.length === 0) {
      return;
    }

    setSending(true);

    try {
      const messageInsert: InboxMessageInsert = {
        organization_id: currentOrganization.id,
        conversation_id: conversationId,
        sender_kind: 'user',
        sender_user_id: user.id,
        sender_agent_id: null,
        sender_external_id: null,
        content: content.trim(),
        format,
        metadata: {},
      };

      const { data: insertedMessage, error: insertError } = await supabase
        .schema('inbox')
        .from('messages')
        .insert(messageInsert)
        .select('*')
        .single();

      if (insertError || !insertedMessage) {
        throw insertError || new Error('Failed to insert message.');
      }

      if (files.length) {
        const attachmentRows: InboxMessageAttachmentInsert[] = [];

        for (const file of files) {
          const safeName = file.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
          const uniquePath = `${currentOrganization.id}/${conversationId}/${crypto.randomUUID()}-${safeName || 'attachment'}`;

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('inbox-attachments')
            .upload(uniquePath, file);

          if (uploadError || !uploadData) {
            throw uploadError || new Error('Failed to upload attachment.');
          }

          attachmentRows.push({
            organization_id: currentOrganization.id,
            conversation_id: conversationId,
            message_id: insertedMessage.id,
            bucket: 'inbox-attachments',
            path: uploadData.path,
            file_name: file.name,
            mime_type: file.type || 'application/octet-stream',
            size_bytes: file.size,
            created_by_user_id: user.id,
          });
        }

        const { error: attachmentError } = await supabase
          .schema('inbox')
          .from('message_attachments')
          .insert(attachmentRows);

        if (attachmentError) {
          throw attachmentError;
        }
      }

      const mentionedUserIds = parseMentionedUserIds(content, mentionableUsers, user.id);
      if (mentionedUserIds.length) {
        const mentionRows: InboxMentionInsert[] = mentionedUserIds.map((mentionedUserId) => ({
          organization_id: currentOrganization.id,
          conversation_id: conversationId,
          message_id: insertedMessage.id,
          mentioned_user_id: mentionedUserId,
        }));

        const { error: mentionError } = await supabase
          .schema('inbox')
          .from('mentions')
          .insert(mentionRows);

        if (mentionError && mentionError.code !== '23505') {
          throw mentionError;
        }
      }

      const urlMatch = content.match(URL_REGEX);
      if (urlMatch?.[1]) {
        const { data: previewData, error: previewError } = await supabase.functions.invoke('inbox-link-preview', {
          body: { url: urlMatch[1] },
        });

        if (!previewError && previewData) {
          const currentMetadata = (insertedMessage.metadata as Record<string, unknown>) || {};
          await supabase
            .schema('inbox')
            .from('messages')
            .update({
              metadata: {
                ...currentMetadata,
                link_preview: previewData,
              },
            })
            .eq('id', insertedMessage.id)
            .eq('organization_id', currentOrganization.id)
            .eq('sender_user_id', user.id);
        }
      }

      if (conversation && (conversation.type === 'ai_agent' || Boolean(conversation.external_conversation_id))) {
        const outboundInsert: InboxOutboundEventInsert = {
          organization_id: currentOrganization.id,
          conversation_id: conversationId,
          message_id: insertedMessage.id,
          event_type: 'message.created',
          target: (conversation.metadata as Record<string, unknown> | null)?.external_target as string || 'n8n:webhook',
          payload: {
            conversation_id: conversationId,
            message_id: insertedMessage.id,
            content: insertedMessage.content,
            sender_user_id: user.id,
            external_conversation_id: conversation.external_conversation_id,
            sender_kind: insertedMessage.sender_kind,
          },
          status: 'pending',
        };

        const { error: outboundError } = await supabase
          .schema('inbox')
          .from('outbound_events')
          .insert(outboundInsert);

        if (outboundError) {
          console.error('Failed to queue outbound event:', outboundError);
        }
      }

      await fetchMessages();
    } finally {
      setSending(false);
    }
  }, [conversation, conversationId, currentOrganization?.id, fetchMessages, mentionableUsers, user?.id]);

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    if (!conversationId || !currentOrganization?.id) {
      return;
    }

    const channel = supabase
      .channel(`inbox-messages-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'inbox',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void fetchMessages();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'inbox',
          table: 'message_attachments',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void fetchMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, currentOrganization?.id, fetchMessages]);

  return {
    messages,
    loading,
    sending,
    mentionCandidateMap,
    refresh: fetchMessages,
    markConversationRead,
    sendMessage,
  };
}

