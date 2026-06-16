export type ChatAttachmentKind = "image" | "audio" | "document";

export interface ChatAttachment {
  id: string;
  kind: ChatAttachmentKind;
  mimeType: string;
  fileName: string | null;
  fileSize: number | null;
  url: string | null;
  expiresAt: string | null;
  storageDeletedAt: string | null;
}

export interface ChatMessage {
  id: string;
  lead_id: string;
  content: string;
  direction: string;
  direction_code: number;
  sent_at: string;
  lead_name: string;
  sender_name: string | null;
  provider_status?: string | null;
  attachments: ChatAttachment[];
}

export interface ChatSendAttachment {
  messageId: string;
  attachmentId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  kind: ChatAttachmentKind;
}

export interface ChatSendPayload {
  content: string;
  instanceName?: string | null;
  attachment?: ChatSendAttachment | null;
}

export interface ChatUploadIntent {
  success: boolean;
  bucket: string;
  storagePath: string;
  messageId: string;
  attachmentId: string;
  uploadUrl: string;
  uploadToken: string;
  intentExpiresAt: string;
  maxFileSize: number;
  mimeType: string;
  kind: ChatAttachmentKind;
}

export interface ChatComposerAttachment {
  file: File;
  kind: ChatAttachmentKind;
}

export interface ChatComposerPayload {
  content: string;
  attachment?: ChatComposerAttachment | null;
}
