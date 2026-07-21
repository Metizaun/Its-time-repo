import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { MessageAttachment } from "./MessageAttachment";
import { QuickReplyOptions, QuickReplyQuote } from "./QuickReplyDisplay";
import type { ChatAttachment, ChatMessage, ChatQuickReply, ChatSystemKind } from "@/types/chat";

interface MessageBubbleProps {
  content: string;
  sentAt: string;
  isOutbound: boolean;
  senderName?: string | null;
  attachments?: ChatAttachment[];
  sourceType?: string;
  systemKind?: ChatSystemKind | null;
  quickReply?: ChatQuickReply | null;
  replyToMessage?: ChatMessage | null;
}

const ATTACHMENT_PLACEHOLDERS = new Set([
  "[imagem enviada]",
  "[audio enviado]",
  "[documento enviado]",
  "[imagem recebida]",
  "[audio recebido]",
]);

function formatInternalNote(content: string) {
  const withoutPrefix = content.replace("[Nota Interna - Handoff IA]", "").trim();
  return withoutPrefix || "Motivo e resumo indisponiveis.";
}

export function MessageBubble({
  content,
  sentAt,
  isOutbound,
  senderName,
  attachments = [],
  sourceType = "human",
  systemKind = null,
  quickReply = null,
  replyToMessage = null,
}: MessageBubbleProps) {
  const time = format(new Date(sentAt), "HH:mm", { locale: ptBR });
  const normalizedContent = content.trim();
  const hasAudioAttachment = attachments.some((attachment) => attachment.kind === "audio");
  const visibleContent =
    hasAudioAttachment || (attachments.length > 0 && ATTACHMENT_PLACEHOLDERS.has(normalizedContent.toLowerCase()))
      ? ""
      : normalizedContent;
  const hasAttachments = attachments.length > 0;
  const replyPreviewContent = replyToMessage?.attachments.some((attachment) => attachment.kind === "audio")
    ? "Áudio"
    : replyToMessage?.content;

  if (sourceType === "system") {
    if (systemKind === "handoff_note") {
      return (
        <div className="flex w-full justify-center">
          <div className="max-w-[min(88%,42rem)] rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-4 py-3 text-left shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-gray-600)]">
              Nota Interna (IA)
            </p>
            <div className="mt-2 border-l border-[var(--color-gray-200)] pl-3">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--color-gray-700)]">
                {formatInternalNote(normalizedContent)}
              </p>
            </div>
            <p className="mt-2 text-right text-[10px] text-[var(--color-gray-500)]">{time}</p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex w-full justify-center">
        <div className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-1.5 text-center shadow-sm">
          <p className="text-xs font-medium text-[var(--color-gray-600)]">{normalizedContent}</p>
          <p className="mt-1 text-[10px] text-[var(--color-gray-500)]">{time}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex w-full",
      isOutbound ? "justify-end" : "justify-start"
    )}>
      <div className="min-w-0 max-w-[min(82%,36rem)]">
        <div className={cn(
          "px-4 py-2.5 text-sm shadow-sm",
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
          {quickReply?.kind === "selection" && replyPreviewContent && (
            <QuickReplyQuote content={replyPreviewContent} />
          )}
          {attachments.length > 0 && (
            <div className={cn("flex flex-col gap-2", visibleContent && "mb-2")}>
              {attachments.map((attachment) => (
                <MessageAttachment key={attachment.id} attachment={attachment} isOutbound={isOutbound} />
              ))}
            </div>
          )}
          {visibleContent && (
            <p className={cn(
              "whitespace-pre-wrap break-words text-sm leading-relaxed",
              quickReply?.kind === "selection" && "font-semibold text-[var(--color-gray-800)]",
            )}>
              {visibleContent}
            </p>
          )}
          <p className={cn(
            "mt-1 text-right text-[10px]",
            isOutbound
              ? hasAttachments
                ? "text-[var(--color-gray-500)]"
                : "text-[var(--color-primary-100)]"
              : "text-[var(--color-gray-500)]"
          )}>
            {time}
          </p>
        </div>
        {quickReply?.kind === "options" && <QuickReplyOptions options={quickReply.options} />}
      </div>
    </div>
  );
}
