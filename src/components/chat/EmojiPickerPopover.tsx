import { lazy, Suspense, useState } from "react";
import { Loader2, Smile } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const EmojiPickerPanel = lazy(() => import("@/components/chat/EmojiPickerPanel"));

export function EmojiPickerPopover({
  disabled,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Inserir emoji"
          disabled={disabled}
          className="chat-tool-button focus-ring"
        >
          <Smile className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={12}
        className="w-auto overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-0 shadow-modal"
        aria-label="Seletor de emojis"
      >
        <Suspense
          fallback={(
            <div className="flex h-[420px] w-[min(350px,calc(100vw-24px))] items-center justify-center" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--color-primary-500)]" />
              <span className="sr-only">Carregando emojis</span>
            </div>
          )}
        >
          <EmojiPickerPanel
            onSelect={(emoji) => {
              onSelect(emoji);
            }}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
