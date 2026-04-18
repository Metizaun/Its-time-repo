import { useState, KeyboardEvent, useRef, useEffect } from "react";
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

  const canSend = message.trim() && !isLoading && !disabled;

  return (
    <div className="w-full px-5 py-4 border-t border-white/5 bg-[var(--color-bg-primary)]">
      <div className="relative flex items-end gap-2 bg-white/5 border border-white/5 rounded-[20px] px-4 py-2 transition-all duration-200 focus-within:border-white/10">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite sua mensagem..."
          disabled={disabled || isLoading}
          rows={1}
          className="min-h-[24px] max-h-[150px] w-full resize-none border-0 shadow-none bg-transparent py-3 px-1 text-sm text-white placeholder:text-[var(--color-text-secondary)]/60 focus:outline-none focus:ring-0"
          style={{ outline: "none" }}
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={`rounded-full w-9 h-9 shrink-0 mb-1 flex items-center justify-center transition-all duration-200 ${
            canSend 
              ? "bg-[var(--color-accent)] hover:brightness-110 text-white shadow-[0_2px_8px_rgba(229,57,58,0.25)] scale-100 opacity-100" 
              : "bg-white/5 text-[var(--color-text-secondary)] scale-90 opacity-50"
          }`}
        >
          <SendHorizontal className="h-4 w-4 ml-0.5" />
        </button>
      </div>
      <div className="text-center mt-2">
        <p className="text-[10px] text-[var(--color-text-secondary)] opacity-40">Enter para enviar, Shift + Enter para quebrar linha</p>
      </div>
    </div>
  );
}