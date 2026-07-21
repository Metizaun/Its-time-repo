export type ChatAttachmentKind = "image" | "audio" | "document";
export type ChatSystemKind = "handoff_transition" | "handoff_note" | "handoff_complete";
export type ChatProvider = "evolution" | "meta" | "gupshup";

export interface ChatSendPolicy {
  provider: ChatProvider;
  mode: "freeform" | "template_required";
  lastInboundAt: string | null;
  windowExpiresAt: string | null;
  evaluatedAt: string;
  remainingMs: number | null;
}

export interface ChatQuickReplyOption {
  id: string | null;
  title: string;
}

export type ChatQuickReply =
  | {
      kind: "options";
      options: ChatQuickReplyOption[];
    }
  | {
      kind: "selection";
      selectedOption: ChatQuickReplyOption;
      replyToMessageId: string | null;
    };

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
  source_type: string;
  system_kind: ChatSystemKind | null;
  provider_status?: string | null;
  quick_reply: ChatQuickReply | null;
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
  mimeType: string;
}

export interface ChatComposerPayload {
  content: string;
  attachment?: ChatComposerAttachment | null;
}
