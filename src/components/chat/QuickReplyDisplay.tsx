import type { ChatQuickReplyOption } from "@/types/chat";

interface QuickReplyOptionsProps {
  options: ChatQuickReplyOption[];
}

interface QuickReplyQuoteProps {
  content: string;
}

export function QuickReplyOptions({ options }: QuickReplyOptionsProps) {
  return (
    <div
      aria-label="Opções de resposta enviadas"
      className="mt-1.5 flex flex-col gap-1.5"
      role="list"
    >
      {options.map((option, index) => (
        <div
          className="flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--color-surface-1)] px-4 py-2 text-center text-sm font-medium leading-snug text-[var(--color-primary-600)] shadow-sm"
          key={option.id ?? `${option.title}-${index}`}
          role="listitem"
        >
          {option.title}
        </div>
      ))}
    </div>
  );
}

export function QuickReplyQuote({ content }: QuickReplyQuoteProps) {
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--color-surface-2)]">
      <div className="border-l-2 border-[var(--color-primary-500)] px-3 py-2">
        <p className="font-mono text-[10px] font-medium uppercase tracking-wide text-[var(--color-primary-600)]">
          Mensagem enviada
        </p>
        <p className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-[var(--color-gray-600)]">
          {content}
        </p>
      </div>
    </div>
  );
}
