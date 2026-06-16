import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { MessageAttachment } from "./MessageAttachment";
import type { ChatAttachment } from "@/types/chat";

interface MessageBubbleProps {
  content: string;
  sentAt: string;
  isOutbound: boolean;
  senderName?: string | null;
  attachments?: ChatAttachment[];
}

const ATTACHMENT_PLACEHOLDERS = new Set(["[imagem enviada]", "[audio enviado]", "[documento enviado]"]);

export function MessageBubble({ content, sentAt, isOutbound, senderName, attachments = [] }: MessageBubbleProps) {
  const time = format(new Date(sentAt), "HH:mm", { locale: ptBR });
  const normalizedContent = content.trim();
  const visibleContent =
    attachments.length > 0 && ATTACHMENT_PLACEHOLDERS.has(normalizedContent.toLowerCase()) ? "" : normalizedContent;
  const hasAttachments = attachments.length > 0;

  return (
    <div className={cn(
      "flex w-full",
      isOutbound ? "justify-end" : "justify-start"
    )}>
      <div className={cn(
        "max-w-[min(82%,36rem)] px-4 py-2.5 text-sm shadow-sm",
        isOutbound
          ? hasAttachments
            ? "rounded-[18px] rounded-br-[4px] border border-[var(--color-primary-100)] bg-[var(--color-primary-50)] text-[var(--color-gray-800)]"
            : "rounded-[18px] rounded-br-[4px] bg-[var(--color-primary-500)] text-[var(--color-surface-1)] shadow-primary"
          : "rounded-[18px] rounded-bl-[4px] border border-[var(--border-default)] bg-[var(--color-surface-1)] text-[var(--color-gray-700)]"
      )}>
        {!isOutbound && senderName && (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-primary-500)]">
            {senderName}
          </p>
        )}
        {attachments.length > 0 && (
          <div className={cn("flex flex-col gap-2", visibleContent && "mb-2")}>
            {attachments.map((attachment) => (
              <MessageAttachment key={attachment.id} attachment={attachment} isOutbound={isOutbound} />
            ))}
          </div>
        )}
        {visibleContent && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{visibleContent}</p>}
        <p className={cn(
          "text-[10px] mt-1 text-right",
          isOutbound
            ? hasAttachments
              ? "text-[var(--color-gray-500)]"
              : "text-[var(--color-primary-100)]"
            : "text-[var(--color-gray-500)]"
        )}>
          {time}
        </p>
      </div>
    </div>
  );
}
