import { ExternalLink, Phone, Reply } from "lucide-react";

import type { ChatAttachment, ChatTemplateButton, ChatTemplateCard } from "@/types/chat";
import { MessageAttachment } from "./MessageAttachment";

interface TemplateCardDisplayProps {
  card: ChatTemplateCard;
  attachments: ChatAttachment[];
  isOutbound: boolean;
}

const BUTTON_ICON = {
  url: ExternalLink,
  quick_reply: Reply,
  call: Phone,
} satisfies Record<ChatTemplateButton["kind"], typeof ExternalLink>;

export function TemplateCardDisplay({ card, attachments, isOutbound }: TemplateCardDisplayProps) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm">
      {attachments.length > 0 && (
        <div className="flex flex-col gap-2 border-b border-[var(--border-subtle)] p-2">
          {attachments.map((attachment) => (
            <MessageAttachment key={attachment.id} attachment={attachment} isOutbound={isOutbound} />
          ))}
        </div>
      )}

      <div className="space-y-2 px-4 py-3">
        {card.title && (
          <p className="text-sm font-semibold text-[var(--color-gray-800)]">{card.title}</p>
        )}
        {card.body && (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--color-gray-700)]">
            {card.body}
          </p>
        )}
        {card.footer && (
          <p className="text-xs leading-relaxed text-[var(--color-gray-500)]">{card.footer}</p>
        )}
        {card.mediaDegraded && (
          <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-gray-500)]">
            Prévia da imagem
          </p>
        )}
      </div>

      {card.buttons.length > 0 && (
        <div aria-label="Ações enviadas no template" className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-default)]">
          {card.buttons.map((button, index) => {
            const Icon = BUTTON_ICON[button.kind];
            return (
              <button
                aria-label={`${button.text} (ação exibida no WhatsApp)`}
                className="flex min-h-10 w-full cursor-default items-center justify-center gap-2 bg-[var(--color-surface-1)] px-4 py-2 text-sm font-medium text-[var(--color-primary-600)] disabled:opacity-100"
                disabled
                key={`${button.kind}-${button.text}-${index}`}
                type="button"
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
                <span>{button.text}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
