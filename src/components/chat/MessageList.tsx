import { Fragment, useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble";
import { DateSeparator } from "./DateSeparator";
import type { ChatMessage } from "@/types/chat";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatChatDateLabel, getDayKey } from "@/lib/utils/chatDate";

interface MessageListProps {
  messages: ChatMessage[];
  loading: boolean;
}

export function MessageList({ messages, loading }: MessageListProps) {
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const previousMessageCountRef = useRef(0);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);

  const getScrollViewport = () => {
    return scrollRootRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null;
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
    shouldStickToBottomRef.current = true;
    setHasUnreadMessages(false);
  };

  const updateStickiness = () => {
    const viewport = getScrollViewport();
    if (!viewport) {
      shouldStickToBottomRef.current = true;
      return;
    }

    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 120;
    if (shouldStickToBottomRef.current) {
      setHasUnreadMessages(false);
    }
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const messageCountIncreased = messages.length > previousMessageCountRef.current;
      previousMessageCountRef.current = messages.length;

      if (loading || shouldStickToBottomRef.current) {
        scrollToBottom(messages.length <= 1 ? "auto" : "smooth");
        return;
      }

      if (messageCountIncreased) {
        setHasUnreadMessages(true);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [messages, loading]);

  if (loading) {
    return (
      <div className="flex-1 p-6 space-y-4">
        {/* Skeleton ghost cards */}
        <div className="h-14 w-2/3 rounded-[18px] bg-[var(--color-border-subtle)] animate-pulse" />
        <div className="h-14 w-1/2 rounded-[18px] bg-[var(--color-border-subtle)] animate-pulse ml-auto" />
        <div className="h-14 w-3/5 rounded-[18px] bg-[var(--color-border-subtle)] animate-pulse" />
        <div className="h-10 w-2/5 rounded-[18px] bg-[var(--color-border-subtle)] animate-pulse ml-auto" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-[var(--color-text-secondary)]">Nenhuma mensagem ainda</p>
      </div>
    );
  }

  const messagesById = new Map(messages.map((message) => [message.id, message]));

  return (
    <div className="relative min-h-0 flex-1">
    <ScrollArea ref={scrollRootRef} onScrollCapture={updateStickiness} className="h-full">
      <div className="space-y-3 py-4 pl-5 pr-7">
        {messages.map((message, index) => {
          const currentMessageDate = new Date(message.sent_at);
          const previousMessage = index > 0 ? messages[index - 1] : null;
          const previousMessageDate = previousMessage ? new Date(previousMessage.sent_at) : null;

          const shouldShowDateSeparator =
            !previousMessageDate || getDayKey(currentMessageDate) !== getDayKey(previousMessageDate);

          return (
            <Fragment key={message.id}>
              {shouldShowDateSeparator && (
                <DateSeparator label={formatChatDateLabel(currentMessageDate)} />
              )}
              <MessageBubble
                content={message.content}
                sentAt={message.sent_at}
                isOutbound={message.direction_code === 2}
                senderName={message.sender_name}
                sourceType={message.source_type}
                systemKind={message.system_kind}
                attachments={message.attachments}
                quickReply={message.quick_reply}
                replyToMessage={
                  message.quick_reply?.kind === "selection" && message.quick_reply.replyToMessageId
                    ? messagesById.get(message.quick_reply.replyToMessageId) ?? null
                    : null
                }
              />
            </Fragment>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
    {hasUnreadMessages && (
      <button
        type="button"
        onClick={() => scrollToBottom()}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-[var(--border-default)] bg-[var(--color-surface-1)] px-3 py-1.5 text-xs font-semibold text-[var(--color-primary-600)] shadow-sm focus-ring"
      >
        Novas mensagens
      </button>
    )}
    </div>
  );
}
