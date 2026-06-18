import { useCallback, useEffect, useMemo, useState } from 'react';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizationContext } from '@/hooks/useOrganizationContext';

import type {
  InboxAgent,
  InboxConversation,
  InboxConversationInsert,
  InboxConversationParticipant,
  InboxConversationParticipantInsert,
  InboxConversationUpdate,
  InboxConversationView,
  InboxTag,
  InboxTeamMember,
} from '@/features/inbox/types';

const sortByRecentActivity = (items: InboxConversationView[]) => {
  return [...items].sort((a, b) => {
    const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : new Date(a.created_at).getTime();
    const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : new Date(b.created_at).getTime();
    return bTime - aTime;
  });
};

const buildParticipantRows = (
  conversationId: string,
  organizationId: string,
  userIds: string[]
): InboxConversationParticipantInsert[] => {
  const uniqueUserIds = [...new Set(userIds)];

  return uniqueUserIds.map((userId, index) => ({
    conversation_id: conversationId,
    organization_id: organizationId,
    user_id: userId,
    role: index === 0 ? 'owner' : 'member',
  }));
};

export function useInboxConversations() {
  const [conversations, setConversations] = useState<InboxConversationView[]>([]);
  const [tags, setTags] = useState<InboxTag[]>([]);
  const [agents, setAgents] = useState<InboxAgent[]>([]);
  const [teamMembers, setTeamMembers] = useState<InboxTeamMember[]>([]);
  const [loading, setLoading] = useState(false);

  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();

  const teamMemberMap = useMemo(
    () => new Map(teamMembers.map((member) => [member.user_id, member])),
    [teamMembers]
  );

  const fetchTeamMembers = useCallback(async (): Promise<InboxTeamMember[]> => {
    if (!currentOrganization?.id) {
      return [];
    }

    const { data: roleRows, error: rolesError } = await supabase
      .from('user_roles')
      .select('user_id, role')
      .eq('organization_id', currentOrganization.id);

    if (rolesError) {
      throw rolesError;
    }

    const userIds = (roleRows || []).map((row) => row.user_id);
    if (!userIds.length) {
      return [];
    }

    const { data: profileRows, error: profilesError } = await supabase
      .from('profiles')
      .select('user_id, display_name, avatar_url')
      .in('user_id', userIds);

    if (profilesError) {
      throw profilesError;
    }

    return (roleRows || []).map((row) => {
      const profile = (profileRows || []).find((entry) => entry.user_id === row.user_id);
      return {
        user_id: row.user_id,
        role: row.role,
        display_name: profile?.display_name || null,
        avatar_url: profile?.avatar_url || null,
      } as InboxTeamMember;
    });
  }, [currentOrganization?.id]);

  const fetchConversations = useCallback(async () => {
    if (!currentOrganization?.id || !user?.id) {
      setConversations([]);
      setTags([]);
      setAgents([]);
      setTeamMembers([]);
      return;
    }

    setLoading(true);
    try {
      const [{ data: conversationRows, error: conversationError }, { data: tagRows, error: tagError }, { data: agentRows, error: agentError }, fetchedTeamMembers, { data: mentionRows, error: mentionError }] =
        await Promise.all([
          supabase
            .schema('inbox')
            .from('conversations')
            .select('*')
            .eq('organization_id', currentOrganization.id),
          supabase
            .schema('inbox')
            .from('tags')
            .select('*')
            .eq('organization_id', currentOrganization.id)
            .order('is_system', { ascending: false })
            .order('name', { ascending: true }),
          supabase
            .schema('inbox')
            .from('agents')
            .select('*')
            .eq('organization_id', currentOrganization.id)
            .eq('is_active', true)
            .order('display_name', { ascending: true }),
          fetchTeamMembers(),
          supabase
            .schema('inbox')
            .from('mentions')
            .select('conversation_id')
            .eq('organization_id', currentOrganization.id)
            .eq('mentioned_user_id', user.id)
            .eq('is_read', false),
        ]);

      if (conversationError) throw conversationError;
      if (tagError) throw tagError;
      if (agentError) throw agentError;
      if (mentionError) throw mentionError;

      const conversationsData = (conversationRows || []) as InboxConversation[];
      const conversationIds = conversationsData.map((conversation) => conversation.id);

      const [{ data: participantRows, error: participantError }, { data: conversationTagRows, error: conversationTagError }] = await Promise.all([
        conversationIds.length
          ? supabase
              .schema('inbox')
              .from('conversation_participants')
              .select('*')
              .in('conversation_id', conversationIds)
          : Promise.resolve({ data: [], error: null }),
        conversationIds.length
          ? supabase
              .schema('inbox')
              .from('conversation_tags')
              .select('conversation_id, tag_id')
              .in('conversation_id', conversationIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (participantError) throw participantError;
      if (conversationTagError) throw conversationTagError;

      const participantsByConversation = new Map<string, InboxConversationParticipant[]>();
      for (const participant of (participantRows || []) as InboxConversationParticipant[]) {
        const current = participantsByConversation.get(participant.conversation_id) || [];
        current.push(participant);
        participantsByConversation.set(participant.conversation_id, current);
      }

      const tagsById = new Map((tagRows || []).map((tag) => [tag.id, tag as InboxTag]));
      const tagsByConversation = new Map<string, InboxTag[]>();
      for (const relation of conversationTagRows || []) {
        const tag = tagsById.get(relation.tag_id);
        if (!tag) continue;

        const current = tagsByConversation.get(relation.conversation_id) || [];
        current.push(tag);
        tagsByConversation.set(relation.conversation_id, current);
      }

      const mentionCountByConversation: Record<string, number> = {};
      for (const mention of mentionRows || []) {
        mentionCountByConversation[mention.conversation_id] = (mentionCountByConversation[mention.conversation_id] || 0) + 1;
      }

      const agentMap = new Map((agentRows || []).map((agent) => [agent.id, agent as InboxAgent]));

      const mapped = conversationsData.map((conversation) => {
        const participants = participantsByConversation.get(conversation.id) || [];
        const viewerParticipant = participants.find((participant) => participant.user_id === user.id);
        const mentionCount = mentionCountByConversation[conversation.id] || 0;

        const hasUnreadByTimestamp =
          Boolean(conversation.last_message_at) &&
          (!viewerParticipant?.last_read_at ||
            new Date(conversation.last_message_at as string).getTime() > new Date(viewerParticipant.last_read_at).getTime());

        return {
          ...conversation,
          unread_count: hasUnreadByTimestamp ? 1 + mentionCount : mentionCount,
          mention_count: mentionCount,
          participants,
          tags: tagsByConversation.get(conversation.id) || [],
          agent: conversation.agent_id ? agentMap.get(conversation.agent_id) || null : null,
        } as InboxConversationView;
      });

      setConversations(sortByRecentActivity(mapped));
      setTags((tagRows || []) as InboxTag[]);
      setAgents((agentRows || []) as InboxAgent[]);
      setTeamMembers(fetchedTeamMembers);
    } catch (error) {
      console.error('Failed to fetch inbox conversations:', error);
      setConversations([]);
      setTags([]);
      setAgents([]);
      setTeamMembers([]);
    } finally {
      setLoading(false);
    }
  }, [currentOrganization?.id, fetchTeamMembers, user?.id]);

  const createConversation = useCallback(async (
    payload: Omit<InboxConversationInsert, 'organization_id' | 'created_by_user_id'>,
    participantUserIds: string[]
  ) => {
    if (!currentOrganization?.id || !user?.id) {
      throw new Error('User not authenticated or organization not selected.');
    }

    const { data: createdConversation, error: conversationError } = await supabase
      .schema('inbox')
      .from('conversations')
      .insert({
        ...payload,
        organization_id: currentOrganization.id,
        created_by_user_id: user.id,
      })
      .select('*')
      .single();

    if (conversationError || !createdConversation) {
      throw conversationError || new Error('Failed to create conversation.');
    }

    const participantRows = buildParticipantRows(
      createdConversation.id,
      currentOrganization.id,
      [user.id, ...participantUserIds]
    );

    const { error: participantError } = await supabase
      .schema('inbox')
      .from('conversation_participants')
      .insert(participantRows);

    if (participantError) {
      throw participantError;
    }

    await fetchConversations();
    return createdConversation;
  }, [currentOrganization?.id, fetchConversations, user?.id]);

  const startDirectConversation = useCallback(async (targetUserId: string) => {
    if (!currentOrganization?.id || !user?.id) {
      throw new Error('User not authenticated or organization not selected.');
    }

    if (targetUserId === user.id) {
      throw new Error('Cannot create direct conversation with yourself.');
    }

    const { data: myParticipantRows, error: myParticipantError } = await supabase
      .schema('inbox')
      .from('conversation_participants')
      .select('conversation_id')
      .eq('organization_id', currentOrganization.id)
      .eq('user_id', user.id)
      .is('left_at', null);

    if (myParticipantError) {
      throw myParticipantError;
    }

    const conversationIds = (myParticipantRows || []).map((row) => row.conversation_id);

    if (conversationIds.length) {
      const [{ data: targetParticipantRows, error: targetParticipantError }, { data: directConversations, error: directError }] =
        await Promise.all([
          supabase
            .schema('inbox')
            .from('conversation_participants')
            .select('conversation_id')
            .eq('organization_id', currentOrganization.id)
            .eq('user_id', targetUserId)
            .is('left_at', null)
            .in('conversation_id', conversationIds),
          supabase
            .schema('inbox')
            .from('conversations')
            .select('id')
            .eq('organization_id', currentOrganization.id)
            .eq('type', 'direct')
            .in('id', conversationIds),
        ]);

      if (targetParticipantError) throw targetParticipantError;
      if (directError) throw directError;

      const targetSet = new Set((targetParticipantRows || []).map((row) => row.conversation_id));
      const existingConversation = (directConversations || []).find((conversation) => targetSet.has(conversation.id));

      if (existingConversation) {
        return existingConversation.id;
      }
    }

    const created = await createConversation(
      {
        type: 'direct',
        status: 'open',
        title: null,
        assigned_to_user_id: user.id,
        agent_id: null,
        external_conversation_id: null,
        metadata: {},
      },
      [targetUserId]
    );

    return created.id;
  }, [createConversation, currentOrganization?.id, user?.id]);

  const startAgentConversation = useCallback(async (agentId: string) => {
    if (!currentOrganization?.id || !user?.id) {
      throw new Error('User not authenticated or organization not selected.');
    }

    const { data: existing, error: existingError } = await supabase
      .schema('inbox')
      .from('conversations')
      .select('id')
      .eq('organization_id', currentOrganization.id)
      .eq('type', 'ai_agent')
      .eq('agent_id', agentId)
      .eq('created_by_user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing?.id) {
      return existing.id;
    }

    const created = await createConversation(
      {
        type: 'ai_agent',
        status: 'open',
        title: null,
        assigned_to_user_id: user.id,
        agent_id: agentId,
        external_conversation_id: null,
        metadata: {},
      },
      []
    );

    return created.id;
  }, [createConversation, currentOrganization?.id, user?.id]);

  const updateConversation = useCallback(async (conversationId: string, updates: InboxConversationUpdate) => {
    if (!currentOrganization?.id) {
      throw new Error('Organization not selected.');
    }

    const { error } = await supabase
      .schema('inbox')
      .from('conversations')
      .update(updates)
      .eq('id', conversationId)
      .eq('organization_id', currentOrganization.id);

    if (error) {
      throw error;
    }

    await fetchConversations();
  }, [currentOrganization?.id, fetchConversations]);

  const setConversationArchived = useCallback(async (conversationId: string, archived: boolean) => {
    await updateConversation(conversationId, {
      status: archived ? 'archived' : 'open',
    });
  }, [updateConversation]);

  const attachTag = useCallback(async (conversationId: string, tagId: string) => {
    const { error } = await supabase
      .schema('inbox')
      .from('conversation_tags')
      .insert({
        conversation_id: conversationId,
        tag_id: tagId,
        created_by_user_id: user?.id || null,
      });

    if (error && error.code !== '23505') {
      throw error;
    }

    await fetchConversations();
  }, [fetchConversations, user?.id]);

  const detachTag = useCallback(async (conversationId: string, tagId: string) => {
    const { error } = await supabase
      .schema('inbox')
      .from('conversation_tags')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('tag_id', tagId);

    if (error) {
      throw error;
    }

    await fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (!currentOrganization?.id) {
      return;
    }

    const channel = supabase
      .channel(`inbox-conversations-${currentOrganization.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'inbox',
          table: 'conversations',
          filter: `organization_id=eq.${currentOrganization.id}`,
        },
        () => {
          void fetchConversations();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'inbox',
          table: 'conversation_participants',
          filter: `organization_id=eq.${currentOrganization.id}`,
        },
        () => {
          void fetchConversations();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'inbox',
          table: 'conversation_tags',
        },
        () => {
          void fetchConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentOrganization?.id, fetchConversations]);

  return {
    conversations,
    tags,
    agents,
    teamMembers,
    teamMemberMap,
    loading,
    refresh: fetchConversations,
    createConversation,
    startDirectConversation,
    startAgentConversation,
    updateConversation,
    setConversationArchived,
    attachTag,
    detachTag,
  };
}

