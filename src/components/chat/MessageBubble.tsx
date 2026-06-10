import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  content: string;
  sentAt: string;
  isOutbound: boolean;
  senderName?: string | null;
}

export function MessageBubble({ content, sentAt, isOutbound, senderName }: MessageBubbleProps) {
  const time = format(new Date(sentAt), "HH:mm", { locale: ptBR });

  return (
    <div className={cn(
      "flex w-full",
      isOutbound ? "justify-end" : "justify-start"
    )}>
      <div className={cn(
        "max-w-[70%] px-4 py-2.5 text-sm shadow-sm",
        isOutbound 
          ? "rounded-[18px] rounded-br-[4px] bg-[var(--color-primary-500)] text-[var(--color-surface-1)] shadow-primary"
          : "rounded-[18px] rounded-bl-[4px] border border-[var(--border-default)] bg-[var(--color-surface-1)] text-[var(--color-gray-700)]"
      )}>
        {!isOutbound && senderName && (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-primary-500)]">
            {senderName}
          </p>
        )}
        <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{content}</p>
        <p className={cn(
          "text-[10px] mt-1 text-right",
          isOutbound ? "text-[var(--color-primary-100)]" : "text-[var(--color-gray-500)]"
        )}>
          {time}
        </p>
      </div>
    </div>
  );
}
