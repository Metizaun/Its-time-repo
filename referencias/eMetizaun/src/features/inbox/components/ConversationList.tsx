import { Archive, Bot, RotateCcw } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import type { InboxConversationView, InboxTeamMember } from '@/features/inbox/types';

interface ConversationListProps {
  conversations: InboxConversationView[];
  selectedConversationId: string | null;
  currentUserId: string | null;
  loading?: boolean;
  teamMemberMap: Map<string, InboxTeamMember>;
  onSelectConversation: (conversationId: string) => void;
  onToggleArchive: (conversationId: string, archived: boolean) => void;
}

const getConversationTitle = (
  conversation: InboxConversationView,
  currentUserId: string | null,
  teamMemberMap: Map<string, InboxTeamMember>
) => {
  if (conversation.title) return conversation.title;

  if (conversation.type === 'ai_agent') {
    return conversation.agent?.display_name || 'AI Agent';
  }

  if (conversation.type === 'direct') {
    const target = conversation.participants.find((participant) => participant.user_id !== currentUserId);
    if (target) {
      return teamMemberMap.get(target.user_id)?.display_name || 'Direct message';
    }
  }

  if (conversation.type === 'group') return 'Group chat';
  if (conversation.type === 'channel') return 'Team channel';
  return 'Conversation';
};

const getConversationAvatarData = (
  conversation: InboxConversationView,
  currentUserId: string | null,
  teamMemberMap: Map<string, InboxTeamMember>,
  title: string
) => {
  if (conversation.type === 'ai_agent') {
    return {
      avatarUrl: conversation.agent?.avatar_url || null,
      fallback: (conversation.agent?.display_name || title).slice(0, 1).toUpperCase(),
      isAgent: true,
    };
  }

  if (conversation.type === 'direct') {
    const target = conversation.participants.find((participant) => participant.user_id !== currentUserId);
    const member = target ? teamMemberMap.get(target.user_id) : null;
    return {
      avatarUrl: member?.avatar_url || null,
      fallback: (member?.display_name || title).slice(0, 1).toUpperCase(),
      isAgent: false,
    };
  }

  return {
    avatarUrl: null,
    fallback: title.slice(0, 1).toUpperCase(),
    isAgent: false,
  };
};

export function ConversationList({
  conversations,
  selectedConversationId,
  currentUserId,
  loading = false,
  teamMemberMap,
  onSelectConversation,
  onToggleArchive,
}: ConversationListProps) {
  return (
    <div className="h-full min-h-0 border-r bg-muted/30">
      <div className="border-b px-4 py-3">
        <h2 className="text-lg font-semibold">Conversations</h2>
      </div>

      <div className="h-[calc(100%-57px)] min-h-0 overflow-y-auto">
        {loading && (
          <div className="px-4 py-6 text-sm text-muted-foreground">Loading conversations...</div>
        )}

        {!loading && !conversations.length && (
          <div className="px-4 py-6 text-sm text-muted-foreground">No conversations found for this filter.</div>
        )}

        {conversations.map((conversation) => {
          const title = getConversationTitle(conversation, currentUserId, teamMemberMap);
          const isSelected = selectedConversationId === conversation.id;
          const isArchived = conversation.status === 'archived';
          const avatar = getConversationAvatarData(conversation, currentUserId, teamMemberMap, title);

          return (
            <div
              key={conversation.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectConversation(conversation.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectConversation(conversation.id);
                }
              }}
              className={`border-b px-3 py-3 focus:outline-none ${
                isSelected
                  ? 'border-l-[2.5px] border-l-[var(--accent-orange)] bg-[var(--accent-orange-light)]'
                  : 'bg-muted/20 hover:bg-muted/40'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="relative mt-0.5">
                  <Avatar
                    className={`h-9 w-9 border ${
                      isSelected ? 'border-[var(--accent-orange)]' : 'border-border'
                    }`}
                  >
                    <AvatarImage src={avatar.avatarUrl || undefined} alt={title} />
                    <AvatarFallback
                      className={`text-xs font-semibold ${
                        isSelected
                          ? 'bg-[var(--accent-orange-light)] text-[var(--accent-orange)]'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {avatar.isAgent ? <Bot className="h-3.5 w-3.5" /> : avatar.fallback}
                    </AvatarFallback>
                  </Avatar>

                  {conversation.unread_count > 0 && (
                    <span
                      className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
                      style={{
                        backgroundColor: 'var(--accent-orange)',
                        border: '2px solid var(--inbox-surface)',
                        boxShadow: '0 2px 4px rgba(8, 24, 82, 0.35)',
                      }}
                    >
                      {conversation.unread_count > 9 ? '9+' : conversation.unread_count}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{title}</p>
                    {conversation.type === 'ai_agent' && (
                      <Badge variant="secondary" className="h-5 px-2 text-[10px] uppercase tracking-wide">
                        <Bot className="h-3 w-3 mr-1" /> AI
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs font-normal text-muted-foreground">
                    {conversation.last_message_preview || 'No messages yet'}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={`h-6 w-6 ${
                      isSelected ? 'text-[var(--accent-orange)]' : 'text-muted-foreground'
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleArchive(conversation.id, !isArchived);
                    }}
                  >
                    {isArchived ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                  </Button>

                  <span className="text-[11px] font-normal text-muted-foreground">
                    {conversation.last_message_at
                      ? `${formatDistanceToNowStrict(new Date(conversation.last_message_at), { addSuffix: true })}`
                      : ''}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

