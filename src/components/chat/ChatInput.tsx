import { ChangeEvent, KeyboardEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Music2,
  Paperclip,
  SendHorizontal,
  X,
} from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_MAX_FILE_SIZE,
  formatFileSize,
  normalizeMimeType,
  resolveChatAttachmentKind,
} from "@/services/chatService";
import type { ChatAttachmentKind, ChatComposerPayload } from "@/types/chat";
import { cn } from "@/lib/utils";

const VOICE_WAVEFORM_BARS = [
  8, 12, 6, 16, 10, 18, 7, 13, 9, 20, 11, 15, 6, 12, 8, 17, 10, 14, 7, 19, 11, 16, 8, 13,
  6, 18, 12, 15, 9, 20, 10, 14,
];
const VOICE_WAVEFORM_BAR_COUNT = VOICE_WAVEFORM_BARS.length;

interface ChatInputProps {
  onSend: (payload: ChatComposerPayload) => Promise<void>;
  disabled?: boolean;
}

type SelectedAttachment = {
  file: File;
  kind: ChatAttachmentKind;
  mimeType: string;
  previewUrl: string | null;
  source: "file" | "audio";
};

interface ToolButtonProps {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

interface RoundActionButtonProps extends ToolButtonProps {
  muted?: boolean;
}

function formatRecorderTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.max(0, totalSeconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${seconds}`;
}

async function createAudioWaveformBars(file: File) {
  if (typeof window === "undefined") {
    return VOICE_WAVEFORM_BARS;
  }

  const AudioContextConstructor =
    window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return VOICE_WAVEFORM_BARS;
  }

  const audioContext = new AudioContextConstructor();

  try {
    const audioBuffer = await audioContext.decodeAudioData(await file.arrayBuffer());
    const samples = audioBuffer.getChannelData(0);
    const samplesPerBar = Math.max(1, Math.floor(samples.length / VOICE_WAVEFORM_BAR_COUNT));

    const rawBars = Array.from({ length: VOICE_WAVEFORM_BAR_COUNT }, (_, index) => {
      const start = index * samplesPerBar;
      const end = Math.min(samples.length, start + samplesPerBar);
      const step = Math.max(1, Math.floor((end - start) / 300));
      let sum = 0;
      let count = 0;

      for (let sampleIndex = start; sampleIndex < end; sampleIndex += step) {
        sum += samples[sampleIndex] ** 2;
        count += 1;
      }

      return count > 0 ? Math.sqrt(sum / count) : 0;
    });

    const maxAmplitude = Math.max(...rawBars, 0.01);

    return rawBars.map((amplitude) => Math.round(6 + (amplitude / maxAmplitude) * 18));
  } catch {
    return VOICE_WAVEFORM_BARS;
  } finally {
    void audioContext.close();
  }
}

function ToolButton({ label, disabled, onClick, children }: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="chat-tool-button focus-ring"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function RoundActionButton({ label, disabled, muted, onClick, children }: RoundActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-200 disabled:cursor-not-allowed focus-ring",
            muted || disabled
              ? "scale-90 bg-[var(--color-bg-muted)] text-[var(--color-gray-400)] opacity-50 shadow-none"
              : "scale-100 bg-[var(--color-primary-500)] text-[var(--color-surface-1)] opacity-100 shadow-primary hover:bg-[var(--color-primary-600)]"
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function getAttachmentIcon(kind: ChatAttachmentKind) {
  if (kind === "image") {
    return <ImageIcon className="h-5 w-5" />;
  }

  if (kind === "audio") {
    return <Music2 className="h-5 w-5" />;
  }

  return <FileText className="h-5 w-5" />;
}

function VoiceWaveform({
  active = false,
  bars = VOICE_WAVEFORM_BARS,
  label,
  onClick,
  live = false,
  playing = false,
  progress = 0,
}: {
  active?: boolean;
  bars?: number[];
  label?: string;
  onClick?: () => void;
  live?: boolean;
  playing?: boolean;
  progress?: number;
}) {
  const safeProgress = Math.min(1, Math.max(0, progress));
  const playedCount = Math.round(safeProgress * bars.length);
  const cursorIndex = Math.min(Math.max(playedCount, 0), bars.length - 1);
  const className = cn(
    "chat-voice-waveform",
    active && "chat-voice-waveform--active",
    live && "chat-voice-waveform--live",
    onClick && "chat-voice-waveform--button",
    playing && "chat-voice-waveform--playing"
  );
  const content = bars.map((height, index) => (
    <span
      key={`${height}-${index}`}
      className={cn(
        "chat-voice-waveform__bar",
        live && "chat-voice-waveform__bar--live",
        onClick && index < playedCount && "chat-voice-waveform__bar--played",
        playing && index === cursorIndex && "chat-voice-waveform__bar--cursor"
      )}
      style={{
        height,
        animationDelay: `${index * 45}ms`,
      }}
    />
  ));

  if (onClick) {
    return (
      <button type="button" aria-label={label} onClick={onClick} className={className}>
        {content}
      </button>
    );
  }

  return (
    <span className={className} aria-hidden="true">
      {content}
    </span>
  );
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<SelectedAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [audioPreviewBars, setAudioPreviewBars] = useState(VOICE_WAVEFORM_BARS);
  const [audioPreviewCurrentTime, setAudioPreviewCurrentTime] = useState(0);
  const [audioPreviewDuration, setAudioPreviewDuration] = useState(0);
  const [isAudioPreviewPlaying, setIsAudioPreviewPlaying] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioPreviewRef = useRef<HTMLAudioElement>(null);
  const audioProgressFrameRef = useRef<number | null>(null);
  const audioRecorder = useAudioRecorder();

  const stopAudioPreviewTicker = useCallback(() => {
    if (audioProgressFrameRef.current) {
      window.cancelAnimationFrame(audioProgressFrameRef.current);
      audioProgressFrameRef.current = null;
    }
  }, []);

  const startAudioPreviewTicker = useCallback(() => {
    stopAudioPreviewTicker();

    const tick = () => {
      const audio = audioPreviewRef.current;

      if (!audio || audio.paused) {
        audioProgressFrameRef.current = null;
        return;
      }

      setAudioPreviewCurrentTime(audio.currentTime);

      if (Number.isFinite(audio.duration)) {
        setAudioPreviewDuration(audio.duration);
      }

      audioProgressFrameRef.current = window.requestAnimationFrame(tick);
    };

    audioProgressFrameRef.current = window.requestAnimationFrame(tick);
  }, [stopAudioPreviewTicker]);

  const revokeFilePreview = useCallback((attachment: SelectedAttachment | null) => {
    if (attachment?.source === "file" && attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }, []);

  const clearSelectedAttachment = useCallback((clearAudio = true) => {
    audioPreviewRef.current?.pause();
    stopAudioPreviewTicker();
    setAudioPreviewCurrentTime(0);
    setAudioPreviewDuration(0);
    setIsAudioPreviewPlaying(false);

    setSelectedAttachment((current) => {
      revokeFilePreview(current);
      return null;
    });

    if (clearAudio) {
      audioRecorder.clearRecording();
    }

    setAttachmentError(null);
  }, [audioRecorder, revokeFilePreview, stopAudioPreviewTicker]);

  const handleSend = async () => {
    const trimmedMessage = message.trim();
    if ((!trimmedMessage && !selectedAttachment) || isSending || disabled || audioRecorder.status === "recording") {
      return;
    }

    setIsSending(true);
    setAttachmentError(null);

    try {
      await onSend({
        content: trimmedMessage,
        attachment: selectedAttachment
          ? {
              file: selectedAttachment.file,
              kind: selectedAttachment.kind,
            }
          : null,
      });

      setMessage("");
      clearSelectedAttachment();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } catch (error) {
      const description = error instanceof Error ? error.message : "Nao foi possivel enviar a mensagem.";
      setAttachmentError(description);
    } finally {
      setIsSending(false);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 10);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    const mimeType = normalizeMimeType(file.type);
    const kind = resolveChatAttachmentKind(mimeType);

    if (!kind) {
      setAttachmentError("Tipo de arquivo nao permitido para o chat.");
      return;
    }

    if (file.size > CHAT_ATTACHMENT_MAX_FILE_SIZE) {
      setAttachmentError("Arquivo acima do limite de 100 MB.");
      return;
    }

    clearSelectedAttachment();
    const previewUrl = kind === "image" || kind === "audio" ? URL.createObjectURL(file) : null;
    setSelectedAttachment({
      file,
      kind,
      mimeType,
      previewUrl,
      source: "file",
    });
  };

  const handleStartRecording = async () => {
    clearSelectedAttachment();
    await audioRecorder.startRecording();
  };

  useEffect(() => {
    const recording = audioRecorder.recording;
    if (!recording) {
      return;
    }

    setSelectedAttachment((current) => {
      revokeFilePreview(current);
      return {
        file: recording.file,
        kind: "audio",
        mimeType: recording.mimeType,
        previewUrl: recording.url,
        source: "audio",
      };
    });
  }, [audioRecorder.recording, revokeFilePreview]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [message]);

  useEffect(() => {
    return () => {
      revokeFilePreview(selectedAttachment);
    };
  }, [revokeFilePreview, selectedAttachment]);

  const canSend = Boolean(message.trim() || selectedAttachment) && !isSending && !disabled && audioRecorder.status !== "recording";
  const displayedError = attachmentError || audioRecorder.error;
  const selectedAudioAttachment = selectedAttachment?.kind === "audio" ? selectedAttachment : null;
  const selectedVisualAttachment = selectedAttachment?.kind === "audio" ? null : selectedAttachment;
  const isRecordingAudio = audioRecorder.status === "recording";
  const showSendButton = Boolean(message.trim() || selectedAttachment);
  const audioPreviewProgress = audioPreviewDuration > 0 ? audioPreviewCurrentTime / audioPreviewDuration : 0;
  const audioPreviewSeconds = Math.round(
    isAudioPreviewPlaying ? audioPreviewCurrentTime : audioPreviewDuration || audioRecorder.elapsedSeconds
  );

  const handleToggleAudioPreview = useCallback(async () => {
    const audio = audioPreviewRef.current;

    if (!audio || !selectedAudioAttachment?.previewUrl) {
      return;
    }

    if (!audio.paused) {
      audio.pause();
      stopAudioPreviewTicker();
      setIsAudioPreviewPlaying(false);
      setAudioPreviewCurrentTime(audio.currentTime);
      return;
    }

    if (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration) {
      audio.currentTime = 0;
      setAudioPreviewCurrentTime(0);
    }

    try {
      await audio.play();
      setIsAudioPreviewPlaying(true);
      startAudioPreviewTicker();
    } catch {
      setAttachmentError("Nao foi possivel reproduzir o audio gravado.");
    }
  }, [selectedAudioAttachment?.previewUrl, startAudioPreviewTicker, stopAudioPreviewTicker]);

  useEffect(() => {
    stopAudioPreviewTicker();
    setAudioPreviewBars(VOICE_WAVEFORM_BARS);
    setAudioPreviewCurrentTime(0);
    setAudioPreviewDuration(0);
    setIsAudioPreviewPlaying(false);

    const audio = audioPreviewRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    if (!selectedAudioAttachment) {
      return;
    }

    let cancelled = false;

    void createAudioWaveformBars(selectedAudioAttachment.file).then((bars) => {
      if (!cancelled) {
        setAudioPreviewBars(bars);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedAudioAttachment, stopAudioPreviewTicker]);

  useEffect(() => {
    return () => {
      stopAudioPreviewTicker();
    };
  }, [stopAudioPreviewTicker]);

  return (
    <div className="w-full border-t border-[var(--border-default)] bg-[var(--color-surface-1)] px-4 py-3 md:px-5 md:py-4">
      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        accept={CHAT_ATTACHMENT_ACCEPT.join(",")}
        onChange={handleFileChange}
      />

      <div className="mx-auto flex w-full flex-col gap-3">
        {displayedError && (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-3 py-2 text-xs font-medium text-[var(--color-error-600)]">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">{displayedError}</span>
            {selectedAttachment && (
              <button
                type="button"
                className="rounded-full px-2 py-1 text-[var(--color-error-600)] hover:bg-[var(--color-surface-overlay)]"
                onClick={() => void handleSend()}
                disabled={isSending}
              >
                Tentar de novo
              </button>
            )}
          </div>
        )}

        {selectedVisualAttachment && (
          <div className="chat-attachment-tile flex items-center gap-3 px-3 py-2">
            {selectedVisualAttachment.kind === "image" && selectedVisualAttachment.previewUrl ? (
              <img
                src={selectedVisualAttachment.previewUrl}
                alt={selectedVisualAttachment.file.name}
                className="h-12 w-12 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-50)] text-[var(--color-primary-500)] shadow-sm">
                {getAttachmentIcon(selectedVisualAttachment.kind)}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--color-gray-800)]">
                {selectedVisualAttachment.file.name}
              </p>
              <p className="text-xs text-[var(--color-gray-500)]">{formatFileSize(selectedVisualAttachment.file.size)}</p>
            </div>

            {isSending && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--color-primary-500)]" />}
            <ToolButton label="Remover anexo" disabled={isSending} onClick={() => clearSelectedAttachment()}>
              <X className="h-4 w-4" />
            </ToolButton>
          </div>
        )}

        <div className="relative flex items-end gap-2 rounded-[var(--radius-2xl)] border border-[var(--border-input)] bg-[var(--color-surface-2)] px-2 py-2 shadow-inset transition-all duration-200 focus-within:border-[var(--border-focus)] focus-within:shadow-focus md:px-3">
          <ToolButton
            label="Anexar arquivo"
            disabled={disabled || isSending || isRecordingAudio}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </ToolButton>

          {isRecordingAudio ? (
            <div className="chat-voice-inline" role="status" aria-live="polite">
              <Mic className="h-4 w-4 shrink-0 text-[var(--color-error-500)]" />
              <VoiceWaveform bars={audioRecorder.liveWaveformBars} live />
              <span className="font-mono text-xs font-semibold text-[var(--color-gray-600)]">
                {formatRecorderTime(audioRecorder.elapsedSeconds)}
              </span>
            </div>
          ) : selectedAudioAttachment ? (
            <div className="chat-voice-inline">
              <Mic className="h-4 w-4 shrink-0 text-[var(--color-primary-500)]" />
              <VoiceWaveform
                bars={audioPreviewBars}
                label={isAudioPreviewPlaying ? "Pausar audio gravado" : "Reproduzir audio gravado"}
                onClick={() => void handleToggleAudioPreview()}
                playing={isAudioPreviewPlaying}
                progress={audioPreviewProgress}
              />
              <span className="min-w-fit text-xs font-semibold text-[var(--color-gray-600)]">
                {formatRecorderTime(Math.max(0, audioPreviewSeconds))}
              </span>
              {selectedAudioAttachment.previewUrl && (
                <audio
                  ref={audioPreviewRef}
                  src={selectedAudioAttachment.previewUrl}
                  preload="metadata"
                  className="sr-only"
                  onLoadedMetadata={(event) => {
                    const duration = event.currentTarget.duration;
                    setAudioPreviewDuration(Number.isFinite(duration) ? duration : 0);
                  }}
                  onTimeUpdate={(event) => {
                    setAudioPreviewCurrentTime(event.currentTarget.currentTime);
                  }}
                  onPlay={startAudioPreviewTicker}
                  onPause={(event) => {
                    stopAudioPreviewTicker();
                    setIsAudioPreviewPlaying(false);
                    setAudioPreviewCurrentTime(event.currentTarget.currentTime);
                  }}
                  onEnded={(event) => {
                    stopAudioPreviewTicker();
                    setIsAudioPreviewPlaying(false);
                    event.currentTarget.currentTime = 0;
                    setAudioPreviewCurrentTime(0);
                  }}
                />
              )}
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite sua mensagem..."
              disabled={disabled || isSending}
              rows={1}
              className="min-h-[24px] max-h-[150px] w-full resize-none border-0 bg-transparent px-1 py-3 text-sm text-[var(--color-gray-700)] shadow-none placeholder:text-[var(--color-gray-500)] focus:outline-none focus:ring-0"
            />
          )}

          {(isRecordingAudio || selectedAudioAttachment) && (
            <ToolButton
              label={isRecordingAudio ? "Cancelar gravacao" : "Remover audio"}
              disabled={isSending}
              onClick={isRecordingAudio ? audioRecorder.cancelRecording : () => clearSelectedAttachment()}
            >
              <X className="h-4 w-4" />
            </ToolButton>
          )}

          {isRecordingAudio ? (
            <RoundActionButton label="Concluir gravacao" onClick={audioRecorder.stopRecording}>
              <Check className="h-4 w-4" />
            </RoundActionButton>
          ) : showSendButton ? (
            <RoundActionButton label="Enviar mensagem" disabled={!canSend} muted={!canSend} onClick={() => void handleSend()}>
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="ml-0.5 h-4 w-4" />}
            </RoundActionButton>
          ) : (
            <RoundActionButton
              label={audioRecorder.isSupported ? "Gravar audio" : "Gravacao indisponivel"}
              disabled={disabled || isSending || !audioRecorder.isSupported}
              onClick={() => void handleStartRecording()}
            >
              <Mic className="h-4 w-4" />
            </RoundActionButton>
          )}
        </div>
      </div>
    </div>
  );
}
