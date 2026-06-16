import { Download, ExternalLink, FileText, ImageOff, Music2 } from "lucide-react";

import { formatFileSize } from "@/services/chatService";
import type { ChatAttachment } from "@/types/chat";
import { cn } from "@/lib/utils";

interface MessageAttachmentProps {
  attachment: ChatAttachment;
  isOutbound: boolean;
}

function isAttachmentUnavailable(attachment: ChatAttachment) {
  if (attachment.storageDeletedAt || !attachment.url) {
    return true;
  }

  if (!attachment.expiresAt) {
    return false;
  }

  return new Date(attachment.expiresAt).getTime() <= Date.now();
}

function getUnavailableLabel(attachment: ChatAttachment) {
  if (attachment.kind === "image") {
    return "Imagem expirada";
  }

  if (attachment.kind === "audio") {
    return "Audio indisponivel";
  }

  return "Documento indisponivel";
}

export function MessageAttachment({ attachment, isOutbound }: MessageAttachmentProps) {
  const unavailable = isAttachmentUnavailable(attachment);
  const fileName = attachment.fileName || "Anexo";
  const meta = formatFileSize(attachment.fileSize);

  if (unavailable) {
    return (
      <div className="chat-attachment-tile flex items-center gap-3 p-3 text-[var(--color-gray-600)]">
        {attachment.kind === "image" ? (
          <ImageOff className="h-5 w-5 shrink-0" />
        ) : attachment.kind === "audio" ? (
          <Music2 className="h-5 w-5 shrink-0" />
        ) : (
          <FileText className="h-5 w-5 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-gray-700)]">{getUnavailableLabel(attachment)}</p>
          <p className="text-xs text-[var(--color-gray-500)]">{fileName}</p>
        </div>
      </div>
    );
  }

  if (attachment.kind === "image") {
    return (
      <a
        href={attachment.url ?? undefined}
        target="_blank"
        rel="noreferrer"
        className="group block overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm focus-ring"
      >
        <img
          src={attachment.url ?? undefined}
          alt={fileName}
          className="max-h-72 w-full max-w-[280px] object-cover transition-transform duration-200 group-hover:scale-[1.01] sm:max-w-[220px] md:max-w-[280px]"
        />
      </a>
    );
  }

  if (attachment.kind === "audio") {
    return (
      <div className="chat-attachment-tile flex min-w-[220px] flex-col gap-2 p-3">
        <div className="flex items-center gap-2 text-[var(--color-gray-700)]">
          <Music2 className="h-4 w-4 shrink-0 text-[var(--color-primary-500)]" />
          <span className="truncate text-xs font-semibold">{fileName}</span>
        </div>
        <audio controls preload="metadata" src={attachment.url ?? undefined} className="h-9 w-full max-w-[280px]" />
      </div>
    );
  }

  return (
    <div className="chat-attachment-tile flex min-w-[220px] items-center gap-3 p-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-50)] text-[var(--color-primary-500)] shadow-sm">
        <FileText className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--color-gray-800)]">{fileName}</p>
        <p className="text-xs text-[var(--color-gray-500)]">{meta}</p>
      </div>
      <a
        href={attachment.url ?? undefined}
        target="_blank"
        rel="noreferrer"
        download={fileName}
        aria-label={`Abrir ${fileName}`}
        className={cn(
          "chat-tool-button h-9 w-9 text-[var(--color-gray-600)] focus-ring",
          isOutbound && "bg-[var(--color-surface-1)]"
        )}
      >
        <ExternalLink className="h-4 w-4" />
        <Download className="sr-only" />
      </a>
    </div>
  );
}
