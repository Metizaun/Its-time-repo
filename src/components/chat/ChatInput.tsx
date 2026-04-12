import { useState, KeyboardEvent, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SendHorizontal } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async () => {
    if (!message.trim() || isLoading || disabled) return;
    
    setIsLoading(true);
    try {
      await onSend(message);
      setMessage("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"; 
      }
    } finally {
      setIsLoading(false);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 10);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [message]);

  return (
    // LIMPEZA TOTAL:
    // Sem 'absolute', sem 'bottom-0', sem 'inset-x-0'.
    // Apenas largura 100% (w-full) e o estilo visual.
    // O Grid Overlay no arquivo Chat.tsx cuida da posição.
    <div className="w-full p-4 border-t border-border/40 bg-background/60 backdrop-blur-xl supports-[backdrop-filter]:bg-background/40">
      <div className="relative flex items-end gap-2 bg-muted/50 border rounded-3xl px-3 py-2 transition-all shadow-sm focus-within:ring-1 focus-within:ring-primary/20">
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite sua mensagem..."
          disabled={disabled || isLoading}
          rows={1}
          className="min-h-[24px] max-h-[150px] w-full resize-none border-0 shadow-none focus-visible:ring-0 bg-transparent py-3 px-2 text-base placeholder:text-muted-foreground/70"
        />
        <Button
          onClick={handleSend}
          disabled={!message.trim() || isLoading || disabled}
          size="icon"
          className={`rounded-full w-10 h-10 shrink-0 mb-1 transition-all duration-200 ${
            message.trim() 
              ? "bg-primary hover:bg-primary/90 text-primary-foreground scale-100 opacity-100" 
              : "bg-muted-foreground/20 text-muted-foreground hover:bg-muted-foreground/30 scale-90 opacity-70"
          }`}
        >
          <SendHorizontal className="h-5 w-5 ml-0.5" />
        </Button>
      </div>
      <div className="text-center mt-2">
        <p className="text-[10px] text-muted-foreground opacity-50">Enter para enviar, Shift + Enter para quebrar linha</p>
      </div>
    </div>
  );
}