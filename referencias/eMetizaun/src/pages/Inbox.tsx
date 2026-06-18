import { useEffect, useMemo, useState } from 'react';

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useAuth } from '@/hooks/useAuth';

import { InboxSidebar } from '@/features/inbox/components/InboxSidebar';
import { ConversationList } from '@/features/inbox/components/ConversationList';
import { ChatThread } from '@/features/inbox/components/ChatThread';
import { useInboxConversations } from '@/features/inbox/hooks/useInboxConversations';
import { useInboxMentions } from '@/features/inbox/hooks/useInboxMentions';
import { useInboxMessages } from '@/features/inbox/hooks/useInboxMessages';
import type { InboxFilter } from '@/features/inbox/types';

export default function Inbox() {
  const { user } = useAuth();
  const [activeFilter, setActiveFilter] = useState<InboxFilter>('all');
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  const {
    conversations,
    tags,
    agents,
    teamMembers,
    teamMemberMap,
    loading,
    refresh,
    startDirectConversation,
    startAgentConversation,
    setConversationArchived,
  } = useInboxConversations();

  const { mentionsByConversation, totalUnreadMentions } = useInboxMentions();

  const visibleTeamMembers = useMemo(
    () => teamMembers.filter((member) => member.user_id !== user?.id),
    [teamMembers, user?.id]
  );

  const filteredConversations = useMemo(() => {
    if (activeFilter === 'archive') {
      return conversations.filter((conversation) => conversation.status === 'archived');
    }

    const openConversations = conversations.filter((conversation) => conversation.status === 'open');

    if (activeFilter === 'you') {
      return openConversations.filter((conversation) => conversation.assigned_to_user_id === user?.id);
    }

    if (activeFilter === 'mentions') {
      return openConversations.filter((conversation) => (mentionsByConversation[conversation.id] || 0) > 0);
    }

    if (activeFilter === 'tag' && selectedTagId) {
      return openConversations.filter((conversation) => conversation.tags.some((tag) => tag.id === selectedTagId));
    }

    return openConversations;
  }, [activeFilter, conversations, mentionsByConversation, selectedTagId, user?.id]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  const {
    messages,
    loading: messagesLoading,
    sending,
    sendMessage,
  } = useInboxMessages({
    conversationId: selectedConversation?.id || null,
    conversation: selectedConversation,
    mentionableUsers: teamMembers,
  });

  useEffect(() => {
    if (!filteredConversations.length) {
      setSelectedConversationId(null);
      return;
    }

    const exists = filteredConversations.some((conversation) => conversation.id === selectedConversationId);
    if (!exists) {
      setSelectedConversationId(filteredConversations[0].id);
    }
  }, [filteredConversations, selectedConversationId]);

  const counts = useMemo(
    () => ({
      you: conversations.filter((conversation) => conversation.status === 'open' && conversation.assigned_to_user_id === user?.id).length,
      mentions: totalUnreadMentions,
      all: conversations.filter((conversation) => conversation.status === 'open').length,
      archive: conversations.filter((conversation) => conversation.status === 'archived').length,
    }),
    [conversations, totalUnreadMentions, user?.id]
  );

  const handleSelectTeamMember = async (userId: string) => {
    if (userId === user?.id) {
      return;
    }
    const conversationId = await startDirectConversation(userId);
    setActiveFilter('all');
    setSelectedTagId(null);
    setSelectedConversationId(conversationId);
    await refresh();
  };

  const handleSelectAgent = async (agentId: string) => {
    const conversationId = await startAgentConversation(agentId);
    setActiveFilter('all');
    setSelectedTagId(null);
    setSelectedConversationId(conversationId);
    await refresh();
  };

  const handleToggleArchive = async (conversationId: string, shouldArchive: boolean) => {
    await setConversationArchived(conversationId, shouldArchive);
    await refresh();
  };

  return (
    <div className="inbox-theme h-full min-h-0">
      <ResizablePanelGroup direction="horizontal" className="h-full w-full min-h-0 rounded-lg border bg-muted/30">
        <ResizablePanel defaultSize={20} minSize={16}>
          <InboxSidebar
            activeFilter={activeFilter}
            selectedTagId={selectedTagId}
            counts={counts}
            tags={tags}
            agents={agents}
            teamMembers={visibleTeamMembers}
            onSelectFilter={setActiveFilter}
            onSelectTag={setSelectedTagId}
            onSelectAgent={(agentId) => {
              void handleSelectAgent(agentId);
            }}
            onSelectTeamMember={(memberId) => {
              void handleSelectTeamMember(memberId);
            }}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={26} minSize={20}>
          <ConversationList
            conversations={filteredConversations}
            selectedConversationId={selectedConversationId}
            currentUserId={user?.id || null}
            loading={loading}
            teamMemberMap={teamMemberMap}
            onSelectConversation={setSelectedConversationId}
            onToggleArchive={(conversationId, archived) => {
              void handleToggleArchive(conversationId, archived);
            }}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={54} minSize={30}>
          <ChatThread
            conversation={selectedConversation}
            currentUserId={user?.id || null}
            loading={messagesLoading}
            sending={sending}
            messages={messages}
            teamMemberMap={teamMemberMap}
            onSendMessage={async (payload) => {
              await sendMessage(payload);
              await refresh();
            }}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
