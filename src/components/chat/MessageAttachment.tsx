import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText, ImageOff, Music2, Pause, Play } from "lucide-react";

import { formatFileSize } from "@/services/chatService";
import type { ChatAttachment } from "@/types/chat";
import { cn } from "@/lib/utils";

interface MessageAttachmentProps {
  attachment: ChatAttachment;
  isOutbound: boolean;
  timestamp?: string;
  compact?: boolean;
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

const AUDIO_WAVEFORM_BARS = [
  8, 13, 7, 18, 11, 22, 9, 16, 12, 25, 10, 19, 8, 14, 21, 11,
  17, 7, 23, 13, 19, 9, 15, 24, 11, 18, 8, 13, 21, 10, 16, 12,
  20, 8, 14, 23, 11, 18, 7, 15, 21, 10, 17, 9, 13, 22, 11, 16,
];

function formatAudioTime(totalSeconds: number) {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = (safeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function AudioMessagePlayer({ attachment, isOutbound, timestamp }: MessageAttachmentProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setHasError(false);

    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [attachment.url]);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || hasError) return;

    if (audio.paused) {
      if (duration > 0 && audio.currentTime >= duration) {
        audio.currentTime = 0;
        setCurrentTime(0);
      }

      try {
        await audio.play();
      } catch {
        setHasError(true);
        setIsPlaying(false);
      }
      return;
    }

    audio.pause();
  }, [duration, hasError]);

  const handleSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(event.target.value);
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(nextTime)) return;

    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, []);

  return (
    <div
      className={cn(
        "chat-audio-player",
        isOutbound ? "chat-audio-player--outbound" : "chat-audio-player--inbound",
        hasError && "chat-audio-player--error",
      )}
      title={attachment.fileName ?? "Mensagem de audio"}
    >
      <button
        type="button"
        className="chat-audio-player__play focus-ring"
        onClick={() => void togglePlayback()}
        disabled={hasError}
        aria-label={isPlaying ? "Pausar audio" : "Reproduzir audio"}
      >
        {isPlaying ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4" fill="currentColor" />}
      </button>

      <div className="chat-audio-player__body">
        <div className="chat-audio-player__waveform" aria-hidden="true">
          {AUDIO_WAVEFORM_BARS.map((height, index) => (
            <span
              key={`${height}-${index}`}
              className={cn("chat-audio-player__bar", index / AUDIO_WAVEFORM_BARS.length <= progress && "chat-audio-player__bar--played")}
              style={{ height: `${height}px` }}
            />
          ))}
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.01}
            value={Math.min(currentTime, duration || 1)}
            onChange={handleSeek}
            disabled={hasError || duration <= 0}
            className="chat-audio-player__range"
            aria-label="Posicao do audio"
            aria-valuetext={`${formatAudioTime(currentTime)} de ${formatAudioTime(duration)}`}
          />
        </div>
        <div className="chat-audio-player__meta">
          <span>{formatAudioTime(duration)}</span>
          {timestamp ? <time dateTime={timestamp}>{timestamp}</time> : null}
          {isPlaying ? <span className="sr-only">Reproduzindo {formatAudioTime(currentTime)}</span> : null}
        </div>
      </div>

      <audio
        ref={audioRef}
        preload="metadata"
        src={attachment.url ?? undefined}
        className="sr-only"
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
        onError={() => {
          setHasError(true);
          setIsPlaying(false);
        }}
      />
    </div>
  );
}

export function MessageAttachment({ attachment, isOutbound, timestamp, compact = false }: MessageAttachmentProps) {
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
      <div className={cn("chat-image-attachment", compact && "chat-image-attachment--compact")}>
        <a
          href={attachment.url ?? undefined}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "group block overflow-hidden focus-ring",
            compact
              ? "bg-transparent"
              : "rounded-xl border border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm",
          )}
        >
          <img
            src={attachment.url ?? undefined}
            alt={fileName}
            className="block max-h-72 w-full max-w-[280px] object-cover transition-transform duration-200 group-hover:scale-[1.01] sm:max-w-[220px] md:max-w-[280px]"
          />
        </a>
        {compact && timestamp ? <time className="chat-image-attachment__meta" dateTime={timestamp}>{timestamp}</time> : null}
      </div>
    );
  }

  if (attachment.kind === "audio") {
    return <AudioMessagePlayer attachment={attachment} isOutbound={isOutbound} timestamp={timestamp} />;
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
