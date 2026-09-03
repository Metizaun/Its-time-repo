import type { ChatAttachmentKind, ChatComposerAttachment } from "@/types/chat";

export type InternalConversationKind = "direct" | "group";
export type InternalMentionType = "user" | "all" | "lead";

export interface InternalConversationMember {
  userId: string;
  isCurrentUser: boolean;
  name: string;
  email: string;
  role: "ADMIN" | "VENDEDOR";
  isAdmin: boolean;
}

export interface InternalConversation {
  id: string;
  kind: InternalConversationKind;
  name: string | null;
  createdBy: string;
  archivedAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  currentUserIsAdmin: boolean;
  canRead: boolean;
  members: InternalConversationMember[];
  unreadCount: number;
  lastMessage: {
    id: string;
    authorId: string;
    authorName: string;
    preview: string;
    createdAt: string;
  } | null;
}

export type InternalMessageSegment =
  | { type: "text"; text: string }
  | { type: "all"; text: string }
  | { type: "user"; text: string; userId: string }
  | { type: "lead"; text: string; accessible: boolean; leadId?: string };

export interface InternalMessageAttachment {
  id: string;
  kind: ChatAttachmentKind;
  mimeType: string;
  fileName: string | null;
  fileSize: number | null;
  downloadUrl: string | null;
  storageDeletedAt: string | null;
}

export interface InternalMessage {
  id: string;
  conversationId: string;
  authorId: string;
  authorName: string;
  isOwn: boolean;
  content: string;
  segments: InternalMessageSegment[];
  replyTo: { id: string; authorName: string; preview: string } | null;
  attachments: InternalMessageAttachment[];
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  optimistic?: boolean;
  failed?: boolean;
}

export interface InternalMentionDraft {
  type: InternalMentionType;
  userId?: string | null;
  leadId?: string | null;
  start: number;
  length: number;
}

export interface InternalComposerPayload {
  content: string;
  mentions?: InternalMentionDraft[];
  attachment?: ChatComposerAttachment | null;
}

export interface InternalChatUser {
  id: string;
  auth_user_id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "VENDEDOR";
}

export interface InternalMentionableLead {
  id: string;
  name: string;
}

export interface InternalUploadIntent {
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
