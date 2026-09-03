import { Fragment, useEffect, useRef } from "react";
import { Loader2, Reply } from "lucide-react";
import { format } from "date-fns";

import { DateSeparator } from "@/components/chat/DateSeparator";
import { MessageAttachment } from "@/components/chat/MessageAttachment";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatChatDateLabel, getDayKey } from "@/lib/utils/chatDate";
import type { ChatAttachment } from "@/types/chat";
import type { InternalMessage, InternalMessageSegment } from "@/types/internalChat";

function MessageSegments({ segments, onOpenLead }: { segments: InternalMessageSegment[]; onOpenLead: (leadId: string) => void }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {segments.map((segment, index) => {
        if (segment.type === "text") return <Fragment key={index}>{segment.text}</Fragment>;
        if (segment.type === "lead" && segment.accessible && segment.leadId) {
          return <button key={index} type="button" onClick={() => onOpenLead(segment.leadId!)} className="rounded font-semibold text-[var(--color-primary-700)] underline-offset-2 hover:underline focus-ring">{segment.text}</button>;
        }
        return <span key={index} className={segment.type === "lead" ? "font-medium text-[var(--color-gray-500)]" : "rounded bg-[var(--color-primary-50)] px-1 font-semibold text-[var(--color-primary-700)]"}>{segment.text}</span>;
      })}
    </p>
  );
}

export function InternalMessageList({
  messages,
  loading,
  loadingOlder,
  hasMore,
  isGroup,
  onLoadOlder,
  onReply,
  onOpenLead,
}: {
  messages: InternalMessage[];
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  isGroup: boolean;
  onLoadOlder: () => void;
  onReply: (message: InternalMessage) => void;
  onOpenLead: (leadId: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const olderScrollSnapshotRef = useRef<{ height: number; top: number } | null>(null);
  const previousCountRef = useRef(0);

  useEffect(() => {
    if (loadingOlder) return;
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (viewport && olderScrollSnapshotRef.current) {
      const snapshot = olderScrollSnapshotRef.current;
      viewport.scrollTop = snapshot.top + viewport.scrollHeight - snapshot.height;
      olderScrollSnapshotRef.current = null;
      previousCountRef.current = messages.length;
      return;
    }
    if (messages.length > previousCountRef.current) {
      endRef.current?.scrollIntoView({ block: "end", behavior: previousCountRef.current ? "smooth" : "auto" });
    }
    previousCountRef.current = messages.length;
  }, [loadingOlder, messages.length]);

  if (loading) {
    return <div className="flex-1 space-y-4 p-6" aria-label="Carregando mensagens do Time">{["w-2/3", "ml-auto w-1/2", "w-3/5"].map((width) => <div key={width} className={`h-14 ${width} animate-pulse rounded-[var(--radius-xl)] bg-[var(--color-bg-muted)]`} />)}</div>;
  }

  if (messages.length === 0) {
    return <div className="flex flex-1 items-center justify-center p-6"><p className="text-center text-sm text-[var(--color-gray-500)]">Envie a primeira mensagem desta conversa</p></div>;
  }

  return (
    <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1 bg-[var(--color-bg-base)]">
      <div className="space-y-3 px-4 py-5 md:px-6">
        {hasMore ? (
          <div className="flex justify-center"><button type="button" disabled={loadingOlder} onClick={() => {
            const viewport = scrollAreaRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
            if (viewport) olderScrollSnapshotRef.current = { height: viewport.scrollHeight, top: viewport.scrollTop };
            onLoadOlder();
          }} className="inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--color-surface-1)] px-3 py-1.5 text-xs font-semibold text-[var(--color-gray-600)] shadow-sm focus-ring">{loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Carregar anteriores</button></div>
        ) : null}
        {messages.map((message, index) => {
          const previous = index > 0 ? messages[index - 1] : null;
          const showDate = !previous || getDayKey(new Date(previous.createdAt)) !== getDayKey(new Date(message.createdAt));
          return (
            <Fragment key={message.id}>
              {showDate ? <DateSeparator label={formatChatDateLabel(new Date(message.createdAt))} /> : null}
              <div className={`group flex ${message.isOwn ? "justify-end" : "justify-start"}`}>
                <div className={`relative max-w-[84%] rounded-[var(--radius-xl)] border px-3.5 py-2.5 shadow-sm md:max-w-[70%] ${message.isOwn ? "border-[var(--color-primary-100)] bg-[var(--color-primary-50)]" : "border-[var(--border-default)] bg-[var(--color-surface-1)]"}`}>
                  {isGroup && !message.isOwn ? <p className="mb-1 text-xs font-semibold text-[var(--color-primary-700)]">{message.authorName}</p> : null}
                  {message.replyTo ? <div className="mb-2 rounded-[var(--radius-lg)] border-l-2 border-[var(--color-primary-500)] bg-[var(--color-surface-2)] px-2.5 py-2"><p className="truncate text-[11px] font-semibold text-[var(--color-primary-700)]">{message.replyTo.authorName}</p><p className="truncate text-xs text-[var(--color-gray-600)]">{message.replyTo.preview}</p></div> : null}
                  {message.deletedAt ? <p className="text-sm italic text-[var(--color-gray-500)]">Mensagem excluida</p> : <MessageSegments segments={message.segments} onOpenLead={onOpenLead} />}
                  {message.attachments.map((attachment) => {
                    const sharedAttachment: ChatAttachment = {
                      id: attachment.id,
                      kind: attachment.kind,
                      mimeType: attachment.mimeType,
                      fileName: attachment.fileName,
                      fileSize: attachment.fileSize,
                      url: attachment.downloadUrl,
                      expiresAt: null,
                      storageDeletedAt: attachment.storageDeletedAt,
                    };
                    return <div key={attachment.id} className="mt-2"><MessageAttachment attachment={sharedAttachment} isOutbound={message.isOwn} /></div>;
                  })}
                  <div className="mt-1.5 flex items-center justify-end gap-2"><button type="button" aria-label={`Responder mensagem de ${message.authorName}`} onClick={() => onReply(message)} className="rounded p-0.5 text-[var(--color-gray-500)] opacity-100 transition-opacity hover:text-[var(--color-primary-600)] focus:opacity-100 focus-ring md:opacity-0 md:group-hover:opacity-100"><Reply className="h-3.5 w-3.5" /></button><time className="font-mono text-[10px] text-[var(--color-gray-500)]" dateTime={message.createdAt}>{format(new Date(message.createdAt), "HH:mm")}{message.optimistic ? " · enviando" : ""}</time></div>
                </div>
              </div>
            </Fragment>
          );
        })}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
