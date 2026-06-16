import { getCrmBackend, postCrmBackend } from "@/services/crmBackend";
import type {
  ChatAttachment,
  ChatAttachmentKind,
  ChatMessage,
  ChatSendPayload,
  ChatUploadIntent,
} from "@/types/chat";

export const CHAT_ATTACHMENT_MAX_FILE_SIZE = 104_857_600;

export const CHAT_ATTACHMENT_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/webm",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
] as const;

const IMAGE_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const AUDIO_MIME_TYPES = new Set<string>([
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/webm",
]);

const DOCUMENT_MIME_TYPES = new Set<string>([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
]);

type BackendChatAttachment = {
  id: string;
  kind: ChatAttachmentKind;
  mimeType: string;
  fileName: string | null;
  fileSize: number | null;
  downloadUrl: string | null;
  expiresAt: string | null;
  storageDeletedAt: string | null;
};

type BackendChatMessage = {
  id: string;
  leadId: string;
  content: string;
  direction: string;
  directionCode: number;
  sentAt: string;
  leadName: string;
  senderName: string | null;
  providerStatus?: string | null;
  attachments?: BackendChatAttachment[];
};

type ListChatMessagesResponse = {
  success: boolean;
  messages?: BackendChatMessage[];
};

type CreateAttachmentUploadUrlParams = {
  leadId: string;
  instanceName?: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  kind: ChatAttachmentKind;
};

export function normalizeMimeType(mimeType: string | null | undefined) {
  return String(mimeType ?? "").split(";")[0].trim().toLowerCase();
}

export function resolveChatAttachmentKind(mimeType: string | null | undefined): ChatAttachmentKind | null {
  const normalized = normalizeMimeType(mimeType);

  if (IMAGE_MIME_TYPES.has(normalized)) {
    return "image";
  }

  if (AUDIO_MIME_TYPES.has(normalized)) {
    return "audio";
  }

  if (DOCUMENT_MIME_TYPES.has(normalized)) {
    return "document";
  }

  return null;
}

export function formatFileSize(fileSize: number | null | undefined) {
  if (!fileSize || fileSize <= 0) {
    return "Tamanho indisponivel";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = fileSize;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function normalizeAttachment(attachment: BackendChatAttachment): ChatAttachment {
  return {
    id: attachment.id,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    fileName: attachment.fileName,
    fileSize: attachment.fileSize,
    url: attachment.downloadUrl,
    expiresAt: attachment.expiresAt,
    storageDeletedAt: attachment.storageDeletedAt,
  };
}

function normalizeMessage(message: BackendChatMessage): ChatMessage {
  return {
    id: message.id,
    lead_id: message.leadId,
    content: message.content ?? "",
    direction: message.direction,
    direction_code: message.directionCode,
    sent_at: message.sentAt,
    lead_name: message.leadName,
    sender_name: message.senderName,
    provider_status: message.providerStatus ?? null,
    attachments: (message.attachments ?? []).map(normalizeAttachment),
  };
}

export async function listChatMessages(leadId: string) {
  const response = await getCrmBackend<ListChatMessagesResponse>(
    `/api/chat/leads/${encodeURIComponent(leadId)}/messages`
  );

  return (response.messages ?? []).map(normalizeMessage);
}

export async function createAttachmentUploadUrl(params: CreateAttachmentUploadUrlParams) {
  return postCrmBackend<ChatUploadIntent>("/api/chat/attachments/upload-url", params);
}

export async function sendManualMessage(leadId: string, payload: ChatSendPayload) {
  return postCrmBackend<{ success: boolean; messageId?: string; attachmentId?: string }>("/api/chat/send-manual", {
    leadId,
    content: payload.content,
    instanceName: payload.instanceName ?? null,
    attachment: payload.attachment ?? null,
  });
}
