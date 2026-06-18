import { useEffect, useMemo, useRef } from 'react';
import { Bot, Download, Link2, UserRound } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';

import { MessageInput } from '@/features/inbox/components/MessageInput';
import type { InboxConversationView, InboxMessageView, InboxTeamMember } from '@/features/inbox/types';

interface ChatThreadProps {
  conversation: InboxConversationView | null;
  currentUserId: string | null;
  loading?: boolean;
  sending?: boolean;
  messages: InboxMessageView[];
  teamMemberMap: Map<string, InboxTeamMember>;
  onSendMessage: (payload: { content: string; files: File[] }) => Promise<void>;
}

interface LinkPreviewData {
  url?: string;
  title?: string;
  description?: string;
}

const isLinkPreviewData = (value: unknown): value is LinkPreviewData => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.url === 'string' ||
    typeof candidate.title === 'string' ||
    typeof candidate.description === 'string'
  );
};

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

const formatTimestamp = (value: string) => {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
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

export function ChatThread({
  conversation,
  currentUserId,
  loading = false,
  sending = false,
  messages,
  teamMemberMap,
  onSendMessage,
}: ChatThreadProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, conversation?.id]);

  const title = useMemo(() => {
    if (!conversation) return null;
    return getConversationTitle(conversation, currentUserId, teamMemberMap);
  }, [conversation, currentUserId, teamMemberMap]);

  const subtitle = useMemo(() => {
    if (!conversation) return null;

    if (conversation.type === 'ai_agent') {
      return conversation.agent?.slug ? `Agent: ${conversation.agent.slug}` : 'AI workforce';
    }

    const peopleCount = conversation.participants.length;
    if (conversation.type === 'direct') {
      return 'Direct message';
    }

    return `${peopleCount} participant${peopleCount === 1 ? '' : 's'}`;
  }, [conversation]);

  const headerAvatar = useMemo(() => {
    if (!conversation || !title) return null;
    return getConversationAvatarData(conversation, currentUserId, teamMemberMap, title);
  }, [conversation, currentUserId, teamMemberMap, title]);

  const handleDownloadAttachment = async (bucket: string, path: string, fallbackName: string) => {
    try {
      const { data: signedData, error: signedError } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60);

      if (signedError || !signedData?.signedUrl) {
        throw signedError || new Error('Failed to create signed URL');
      }

      const link = document.createElement('a');
      link.href = signedData.signedUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.download = fallbackName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Failed to download attachment:', error);
    }
  };

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/20 text-sm text-muted-foreground">
        Select a conversation to start messaging.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <header className="border-b bg-background px-4 py-3 text-foreground">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 border border-border">
            <AvatarImage src={headerAvatar?.avatarUrl || undefined} alt={title || 'Conversation'} />
            <AvatarFallback className="bg-muted text-xs font-semibold text-muted-foreground">
              {headerAvatar?.isAgent ? <Bot className="h-3.5 w-3.5" /> : headerAvatar?.fallback || <UserRound className="h-3.5 w-3.5" />}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold">{title}</h3>
              {conversation.type === 'ai_agent' && <Badge variant="secondary">AI</Badge>}
            </div>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto bg-background" ref={containerRef}>
        <div className="space-y-4 p-4">
          {loading && <p className="text-xs text-muted-foreground">Loading messages...</p>}

          {!loading && messages.length === 0 && (
            <p className="text-xs text-muted-foreground">No messages yet. Send the first one.</p>
          )}

          {messages.map((message) => {
            const isUserMessage = message.sender_kind === 'user' && message.sender_user_id === currentUserId;
            const isAgentMessage = message.sender_kind === 'agent';

            const senderName = isUserMessage
              ? 'You'
              : message.sender_kind === 'user'
                ? teamMemberMap.get(message.sender_user_id || '')?.display_name || 'Teammate'
                : message.sender_kind === 'agent'
                  ? conversation.agent?.display_name || 'Agent'
                    : message.sender_kind === 'external'
                      ? message.sender_external_id || 'External'
                      : 'System';

            const rawLinkPreview =
              message.metadata &&
              typeof message.metadata === 'object' &&
              'link_preview' in message.metadata
                ? (message.metadata as Record<string, unknown>).link_preview
                : null;

            const linkPreview = isLinkPreviewData(rawLinkPreview) ? rawLinkPreview : null;
            const senderMember = message.sender_user_id ? teamMemberMap.get(message.sender_user_id) : null;
            const senderAvatarUrl = isAgentMessage
              ? conversation.agent?.avatar_url || null
              : senderMember?.avatar_url || null;
            const senderFallback = senderName.slice(0, 1).toUpperCase();

            return (
              <div key={message.id} className={`flex ${isUserMessage ? 'justify-end' : 'justify-start'}`}>
                {!isUserMessage && (
                  <Avatar className="mt-5 h-8 w-8 border border-border">
                    <AvatarImage src={senderAvatarUrl || undefined} alt={senderName} />
                    <AvatarFallback className="bg-muted text-[11px] font-semibold text-muted-foreground">
                      {isAgentMessage ? <Bot className="h-3.5 w-3.5" /> : senderFallback}
                    </AvatarFallback>
                  </Avatar>
                )}

                <div className={`max-w-[80%] ${isUserMessage ? '' : 'ml-2'}`}>
                  <p className={`mb-1 text-xs font-normal ${isUserMessage ? 'text-right text-muted-foreground' : 'text-muted-foreground'}`}>
                    {senderName} {formatTimestamp(message.created_at)}
                  </p>

                  <div
                    className={`rounded-lg border px-3 py-2 text-sm shadow-sm ${
                      isUserMessage
                        ? 'border-[var(--accent-orange)] bg-[var(--accent-orange)] text-white'
                        : isAgentMessage
                          ? 'border-violet-200 bg-violet-50 text-foreground'
                          : 'border-border bg-white text-foreground'
                    }`}
                  >
                    {message.format === 'markdown' || isAgentMessage ? (
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}

                    {Boolean(linkPreview?.url) && (
                      <div
                        className={`mt-3 rounded-md border p-2 ${isUserMessage ? 'border-[var(--accent-orange)] bg-[var(--accent-orange-light)]' : 'bg-background'}`}
                      >
                        <div className="flex items-start gap-2">
                          <Link2 className="mt-0.5 h-4 w-4" />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold">{linkPreview.title || linkPreview.url}</p>
                            <a className="truncate text-xs underline" href={linkPreview.url} target="_blank" rel="noreferrer">
                              {linkPreview.url}
                            </a>
                            {linkPreview.description && (
                              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{linkPreview.description}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {message.attachments.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {message.attachments.map((attachment) => (
                          <button
                            key={attachment.id}
                            type="button"
                            onClick={() => void handleDownloadAttachment(attachment.bucket, attachment.path, attachment.file_name)}
                            className={`flex w-full items-center justify-between rounded border px-2 py-1 text-xs ${
                              isUserMessage ? 'border-[var(--accent-orange)] bg-[var(--accent-orange-light)]' : 'bg-background'
                            }`}
                          >
                            <span className="truncate pr-2">{attachment.file_name}</span>
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="flex justify-start">
              <div className="rounded-md bg-white px-3 py-2 text-xs text-muted-foreground shadow-sm">Sending...</div>
            </div>
          )}
        </div>
      </div>

      <MessageInput
        disabled={!conversation || loading}
        loading={sending}
        onSendMessage={onSendMessage}
      />
    </div>
  );
}

