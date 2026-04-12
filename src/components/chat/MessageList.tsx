import { Fragment, useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { DateSeparator } from "./DateSeparator";
import { ChatMessage } from "@/hooks/useChat";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatChatDateLabel, getDayKey } from "@/lib/utils/chatDate";

interface MessageListProps {
  messages: ChatMessage[];
  loading: boolean;
}

export function MessageList({ messages, loading }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      scrollToBottom();
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [messages, loading]);

  if (loading) {
    return (
      <div className="flex-1 p-4 space-y-4">
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-16 w-2/3 ml-auto" />
        <Skeleton className="h-16 w-2/3" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>Nenhuma mensagem ainda</p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 h-full">
      <div className="space-y-4 py-4 pl-4 pr-7">
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
              />
            </Fragment>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
  );
}
