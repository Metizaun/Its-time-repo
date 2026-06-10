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
    <div className="w-full border-t border-[var(--border-default)] bg-[var(--color-surface-1)] px-5 py-4">
      <div className="relative flex items-end gap-2 rounded-[20px] border border-[var(--border-input)] bg-[var(--color-surface-2)] px-4 py-2 shadow-inset transition-all duration-200 focus-within:border-[var(--border-focus)] focus-within:shadow-focus">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite sua mensagem..."
          disabled={disabled || isLoading}
          rows={1}
          className="min-h-[24px] max-h-[150px] w-full resize-none border-0 bg-transparent px-1 py-3 text-sm text-[var(--color-gray-700)] shadow-none placeholder:text-[var(--color-gray-500)] focus:outline-none focus:ring-0"
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={`rounded-full w-9 h-9 shrink-0 mb-1 flex items-center justify-center transition-all duration-200 ${
            canSend 
              ? "scale-100 bg-[var(--color-primary-500)] text-[var(--color-surface-1)] opacity-100 shadow-primary hover:bg-[var(--color-primary-600)]"
              : "scale-90 bg-[var(--color-bg-muted)] text-[var(--color-gray-400)] opacity-50"
          }`}
        >
          <SendHorizontal className="h-4 w-4 ml-0.5" />
        </button>
      </div>
    </div>
  );
}
