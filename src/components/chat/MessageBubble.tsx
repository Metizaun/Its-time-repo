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
        "max-w-[70%] px-4 py-2.5",
        isOutbound 
          ? "bg-[var(--color-accent)] text-white rounded-[18px] rounded-br-[4px] shadow-[0_2px_8px_rgba(229,57,58,0.2)]" 
          : "bg-white/5 border border-white/5 text-[var(--color-text-primary)] rounded-[18px] rounded-bl-[4px]"
      )}>
        {!isOutbound && senderName && (
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-accent)] font-semibold mb-1">
            {senderName}
          </p>
        )}
        <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{content}</p>
        <p className={cn(
          "text-[10px] mt-1 text-right",
          isOutbound ? "text-white/50" : "text-[var(--color-text-secondary)]"
        )}>
          {time}
        </p>
      </div>
    </div>
  );
}