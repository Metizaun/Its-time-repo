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
        "max-w-[70%] rounded-2xl px-4 py-2 shadow-sm",
        isOutbound 
          ? "bg-primary text-primary-foreground rounded-br-sm" 
          : "bg-muted text-foreground rounded-bl-sm"
      )}>
        {!isOutbound && senderName && (
          <p className="text-xs font-semibold mb-1 opacity-70">{senderName}</p>
        )}
        <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
        <p className={cn(
          "text-xs mt-1 opacity-70 text-right",
          isOutbound ? "text-primary-foreground" : "text-muted-foreground"
        )}>
          {time}
        </p>
      </div>
    </div>
  );
}