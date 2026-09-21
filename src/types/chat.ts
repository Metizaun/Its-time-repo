export type ChatAttachmentKind = "image" | "audio" | "document";
export type ChatSystemKind = "handoff_transition" | "handoff_note" | "handoff_complete";
export type ChatProvider = "evolution" | "meta" | "gupshup" | "instagram" | "website";

export interface ChatConversation {
  id: string;
  leadId: string;
  connectionId: string;
  interactionMode: "ai" | "human";
  status: "active" | "archived";
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastMessagePreview: string | null;
  createdAt: string;
  lead: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    source: string | null;
    stageId: string | null;
    ownerId: string | null;
    status: string | null;
  };
  connection: {
    id: string;
    channelType: "whatsapp" | "instagram" | "website" | "legacy";
    provider: ChatProvider | "legacy";
    displayName: string;
    instanceName: string | null;
    capability: "manual_only" | "full" | "disabled";
    status: string;
  };
}

export interface ChatSendPolicy {
  provider: ChatProvider;
  mode: "freeform" | "human_agent" | "template_required" | "closed";
  supportsAttachments: boolean;
  supportedAttachmentKinds: ChatAttachmentKind[];
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

export type ChatTemplateButton = {
  kind: "url" | "quick_reply" | "call";
  text: string;
  target: string | null;
};

export type ChatTemplateCard = {
  templateId: string | null;
  title: string | null;
  body: string;
  footer: string | null;
  buttons: ChatTemplateButton[];
  hasMedia: boolean;
  mediaDegraded: boolean;
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
  instance_name: string | null;
  lead_name: string;
  sender_name: string | null;
  source_type: string;
  system_kind: ChatSystemKind | null;
  provider_status?: string | null;
  quick_reply: ChatQuickReply | null;
  template_card: ChatTemplateCard | null;
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
  conversationId?: string | null;
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
  mentions?: Array<{
    type: "user" | "all" | "lead";
    userId?: string | null;
    leadId?: string | null;
    start: number;
    length: number;
  }>;
}

export interface ChatMentionSuggestion {
  id: string;
  type: "user" | "all" | "lead";
  label: string;
  description?: string;
  userId?: string;
  leadId?: string;
}
