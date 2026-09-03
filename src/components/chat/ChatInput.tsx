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
import { EmojiPickerPopover } from "@/components/chat/EmojiPickerPopover";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_MAX_FILE_SIZE,
  formatFileSize,
  resolveChatAttachmentKind,
  resolveChatAttachmentMimeType,
} from "@/services/chatService";
import type { ChatAttachmentKind, ChatComposerPayload, ChatMentionSuggestion } from "@/types/chat";
import { cn } from "@/lib/utils";

const VOICE_WAVEFORM_BARS = [
  8, 12, 6, 16, 10, 18, 7, 13, 9, 20, 11, 15, 6, 12, 8, 17, 10, 14, 7, 19, 11, 16, 8, 13,
  6, 18, 12, 15, 9, 20, 10, 14,
];
const VOICE_WAVEFORM_BAR_COUNT = VOICE_WAVEFORM_BARS.length;
const DEFAULT_ATTACHMENT_KINDS: ChatAttachmentKind[] = ["image", "audio", "document"];

interface ChatInputProps {
  onSend: (payload: ChatComposerPayload) => Promise<void>;
  disabled?: boolean;
  allowAttachments?: boolean;
  allowedAttachmentKinds?: ChatAttachmentKind[];
  mentionSearch?: (trigger: "@" | "#", query: string) => Promise<ChatMentionSuggestion[]>;
  replyPreview?: { authorName: string; preview: string } | null;
  onCancelReply?: () => void;
}

type SelectedMention = {
  suggestion: ChatMentionSuggestion;
  label: string;
  start: number;
  end: number;
};

type MentionQuery = {
  trigger: "@" | "#";
  query: string;
  start: number;
  end: number;
};

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

export function ChatInput({
  onSend,
  disabled,
  allowAttachments = true,
  allowedAttachmentKinds = DEFAULT_ATTACHMENT_KINDS,
  mentionSearch,
  replyPreview,
  onCancelReply,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<SelectedAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [audioPreviewBars, setAudioPreviewBars] = useState(VOICE_WAVEFORM_BARS);
  const [audioPreviewCurrentTime, setAudioPreviewCurrentTime] = useState(0);
  const [audioPreviewDuration, setAudioPreviewDuration] = useState(0);
  const [isAudioPreviewPlaying, setIsAudioPreviewPlaying] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState<SelectedMention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [mentionSuggestions, setMentionSuggestions] = useState<ChatMentionSuggestion[]>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
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

  const refreshMentionQuery = useCallback((value: string, cursor: number | null) => {
    if (!mentionSearch || cursor === null) {
      setMentionQuery(null);
      return;
    }
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/(^|\s)([@#])([^\s@#]{0,40})$/);
    if (!match) {
      setMentionQuery(null);
      return;
    }
    const trigger = match[2] as "@" | "#";
    setMentionQuery({
      trigger,
      query: match[3],
      start: cursor - match[3].length - 1,
      end: cursor,
    });
  }, [mentionSearch]);

  const applyTextChange = useCallback((nextValue: string, selectionStart: number, selectionEnd: number) => {
    const previousValue = message;
    let prefix = 0;
    while (prefix < previousValue.length && prefix < nextValue.length && previousValue[prefix] === nextValue[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < previousValue.length - prefix &&
      suffix < nextValue.length - prefix &&
      previousValue[previousValue.length - 1 - suffix] === nextValue[nextValue.length - 1 - suffix]
    ) suffix += 1;
    const previousChangeEnd = previousValue.length - suffix;
    const delta = nextValue.length - previousValue.length;
    setSelectedMentions((current) => current.flatMap((mention) => {
      if (mention.end <= prefix) return [mention];
      if (mention.start >= previousChangeEnd) {
        return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
      }
      return [];
    }));
    setMessage(nextValue);
    queueMicrotask(() => refreshMentionQuery(nextValue, selectionEnd));
    if (selectionStart !== selectionEnd) setMentionQuery(null);
  }, [message, refreshMentionQuery]);

  const buildStructuredMessage = useCallback(() => {
    const leadingWhitespace = message.length - message.trimStart().length;
    const trimmed = message.trim();
    const trailingBoundary = leadingWhitespace + trimmed.length;
    const validMentions = selectedMentions
      .filter((mention) =>
        mention.start >= leadingWhitespace &&
        mention.end <= trailingBoundary &&
        message.slice(mention.start, mention.end) === mention.label
      )
      .sort((left, right) => left.start - right.start);
    let sourceCursor = 0;
    let tokenized = "";
    const mentions: NonNullable<ChatComposerPayload["mentions"]> = [];
    for (const mention of validMentions) {
      const start = mention.start - leadingWhitespace;
      const end = mention.end - leadingWhitespace;
      if (start < sourceCursor) continue;
      tokenized += trimmed.slice(sourceCursor, start);
      const suggestion = mention.suggestion;
      const token = suggestion.type === "all"
        ? "@[all]"
        : suggestion.type === "user"
          ? `@[user:${suggestion.userId}]`
          : `#[lead:${suggestion.leadId}]`;
      const tokenStart = Array.from(tokenized).length;
      tokenized += token;
      mentions.push({
        type: suggestion.type,
        userId: suggestion.userId ?? null,
        leadId: suggestion.leadId ?? null,
        start: tokenStart,
        length: Array.from(token).length,
      });
      sourceCursor = end;
    }
    tokenized += trimmed.slice(sourceCursor);
    return { content: tokenized, mentions };
  }, [message, selectedMentions]);

  const handleSend = async () => {
    const structuredMessage = buildStructuredMessage();
    const trimmedMessage = structuredMessage.content.trim();
    if ((!trimmedMessage && !selectedAttachment) || isSending || disabled || audioRecorder.status === "recording") {
      return;
    }

    setIsSending(true);
    setAttachmentError(null);

    try {
      await onSend({
        content: trimmedMessage,
        mentions: structuredMessage.mentions,
        attachment: selectedAttachment
          ? {
              file: selectedAttachment.file,
              kind: selectedAttachment.kind,
              mimeType: selectedAttachment.mimeType,
            }
          : null,
      });

      setMessage("");
      setSelectedMentions([]);
      setMentionQuery(null);
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

  const selectMentionSuggestion = useCallback((suggestion: ChatMentionSuggestion) => {
    if (!mentionQuery) return;
    const label = suggestion.label;
    const nextValue = `${message.slice(0, mentionQuery.start)}${label} ${message.slice(mentionQuery.end)}`;
    const insertedEnd = mentionQuery.start + label.length;
    setMessage(nextValue);
    setSelectedMentions((current) => [
      ...current.filter((mention) => mention.end <= mentionQuery.start || mention.start >= mentionQuery.end),
      { suggestion, label, start: mentionQuery.start, end: insertedEnd },
    ]);
    setMentionQuery(null);
    setMentionSuggestions([]);
    setTimeout(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursor = insertedEnd + 1;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    }, 0);
  }, [mentionQuery, message]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery && mentionSuggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActiveSuggestionIndex((current) => (current + direction + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        selectMentionSuggestion(mentionSuggestions[activeSuggestionIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleEmojiSelect = useCallback((emoji: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? message.length;
    const end = textarea?.selectionEnd ?? start;
    const nextValue = `${message.slice(0, start)}${emoji}${message.slice(end)}`;
    const delta = emoji.length - (end - start);
    setSelectedMentions((current) => current.flatMap((mention) => {
      if (mention.end <= start) return [mention];
      if (mention.start >= end) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
      return [];
    }));
    setMessage(nextValue);
    setMentionQuery(null);
    setTimeout(() => {
      const cursor = start + emoji.length;
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    }, 0);
  }, [message]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    const mimeType = resolveChatAttachmentMimeType(file);
    const kind = resolveChatAttachmentKind(mimeType);

    if (!kind) {
      setAttachmentError("Tipo de arquivo nao permitido para o chat.");
      return;
    }

    if (!allowedAttachmentKinds.includes(kind)) {
      setAttachmentError(kind === "document" ? "Este canal aceita somente foto e audio." : "Este tipo de arquivo nao e permitido neste canal.");
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
    if (!allowedAttachmentKinds.includes("audio")) {
      setAttachmentError("Audio nao e permitido neste canal.");
      return;
    }
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
    if (!mentionSearch || !mentionQuery) {
      setMentionSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void mentionSearch(mentionQuery.trigger, mentionQuery.query)
        .then((suggestions) => {
          if (cancelled) return;
          setMentionSuggestions(suggestions.slice(0, 8));
          setActiveSuggestionIndex(0);
        })
        .catch(() => {
          if (!cancelled) setMentionSuggestions([]);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mentionQuery, mentionSearch]);

  useEffect(() => {
    if (!allowAttachments) {
      audioRecorder.cancelRecording();
      clearSelectedAttachment();
    }
    // A mudanca de canal deve limpar qualquer midia preparada no canal anterior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowAttachments]);

  useEffect(() => {
    if (selectedAttachment && !allowedAttachmentKinds.includes(selectedAttachment.kind)) {
      clearSelectedAttachment();
    }
  }, [allowedAttachmentKinds, clearSelectedAttachment, selectedAttachment]);

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
      {allowAttachments ? (
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          accept={CHAT_ATTACHMENT_ACCEPT.filter((accept) => {
            if (accept.startsWith("image/")) return allowedAttachmentKinds.includes("image");
            if (accept.startsWith("audio/")) return allowedAttachmentKinds.includes("audio");
            return allowedAttachmentKinds.includes("document");
          }).join(",")}
          onChange={handleFileChange}
        />
      ) : null}

      <div className="mx-auto flex w-full flex-col gap-3">
        {replyPreview ? (
          <div className="flex items-center gap-3 rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-2)] px-3 py-2 shadow-sm">
            <div className="min-w-0 flex-1 border-l-2 border-[var(--color-primary-500)] pl-3">
              <p className="truncate text-xs font-semibold text-[var(--color-primary-700)]">{replyPreview.authorName}</p>
              <p className="truncate text-xs text-[var(--color-gray-600)]">{replyPreview.preview}</p>
            </div>
            <ToolButton label="Cancelar resposta" onClick={() => onCancelReply?.()}>
              <X className="h-4 w-4" />
            </ToolButton>
          </div>
        ) : null}

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
          {allowAttachments ? (
            <ToolButton
              label="Anexar arquivo"
              disabled={disabled || isSending || isRecordingAudio}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
            </ToolButton>
          ) : null}

          {!isRecordingAudio && !selectedAudioAttachment ? (
            <EmojiPickerPopover
              disabled={disabled || isSending}
              onSelect={handleEmojiSelect}
            />
          ) : null}

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
              id="chat-message-input"
              ref={textareaRef}
              value={message}
              onChange={(event) => applyTextChange(
                event.target.value,
                event.target.selectionStart,
                event.target.selectionEnd,
              )}
              onKeyDown={handleKeyDown}
              onClick={(event) => refreshMentionQuery(message, event.currentTarget.selectionStart)}
              onKeyUp={(event) => {
                if (!event.key.startsWith("Arrow") || mentionSuggestions.length > 0) return;
                refreshMentionQuery(message, event.currentTarget.selectionStart);
              }}
              aria-autocomplete={mentionSearch ? "list" : undefined}
              aria-haspopup={mentionSearch ? "listbox" : undefined}
              aria-expanded={mentionSearch ? Boolean(mentionQuery && mentionSuggestions.length > 0) : undefined}
              aria-controls={mentionQuery && mentionSuggestions.length > 0 ? "chat-mention-suggestions" : undefined}
              aria-activedescendant={mentionQuery && mentionSuggestions.length > 0
                ? `chat-mention-suggestion-${activeSuggestionIndex}`
                : undefined}
              placeholder="Digite sua mensagem..."
              disabled={disabled || isSending}
              rows={1}
              className="min-h-[24px] max-h-[150px] w-full resize-none border-0 bg-transparent px-1 py-3 text-sm text-[var(--color-gray-700)] shadow-none placeholder:text-[var(--color-gray-500)] focus:outline-none focus:ring-0"
            />
          )}

          {mentionQuery && mentionSuggestions.length > 0 && !isRecordingAudio && !selectedAudioAttachment ? (
            <div
              id="chat-mention-suggestions"
              role="listbox"
              aria-label={mentionQuery.trigger === "@" ? "Mencionar pessoa" : "Mencionar lead"}
              className="absolute bottom-[calc(100%+8px)] left-2 z-50 max-h-64 w-[min(320px,calc(100vw-32px))] overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-1.5 shadow-md"
            >
              {mentionSuggestions.map((suggestion, index) => (
                <button
                  id={`chat-mention-suggestion-${index}`}
                  key={suggestion.id}
                  type="button"
                  role="option"
                  aria-selected={index === activeSuggestionIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectMentionSuggestion(suggestion)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[var(--radius-lg)] px-3 py-2 text-left transition-colors focus-ring",
                    index === activeSuggestionIndex
                      ? "bg-[var(--color-primary-50)]"
                      : "hover:bg-[var(--color-bg-subtle)]",
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-sm font-semibold text-[var(--color-gray-700)]">
                    {suggestion.type === "all" ? "@" : suggestion.label.replace(/^[@#]/, "").charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--color-gray-800)]">{suggestion.label}</span>
                    {suggestion.description ? (
                      <span className="block truncate text-xs text-[var(--color-gray-500)]">{suggestion.description}</span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

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
          ) : allowAttachments && allowedAttachmentKinds.includes("audio") ? (
            <RoundActionButton
              label={audioRecorder.isSupported ? "Gravar audio" : "Gravacao indisponivel"}
              disabled={disabled || isSending || !audioRecorder.isSupported}
              onClick={() => void handleStartRecording()}
            >
              <Mic className="h-4 w-4" />
            </RoundActionButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}
