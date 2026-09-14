import { deleteCrmBackend, getCrmBackend, patchCrmBackend, postCrmBackend } from "@/services/crmBackend";
import type {
  InternalChatUser,
  InternalConversation,
  InternalMentionDraft,
  InternalMentionableLead,
  InternalMessage,
  InternalUploadIntent,
} from "@/types/internalChat";
import type { ChatAttachmentKind } from "@/types/chat";

export async function listInternalConversations(includeArchived = false) {
  const response = await getCrmBackend<{ conversations: InternalConversation[] }>(
    `/api/chat/internal/conversations${includeArchived ? "?includeArchived=true" : ""}`,
  );
  return response.conversations ?? [];
}

export async function createInternalConversation(input: {
  kind: "direct" | "group";
  name?: string | null;
  memberIds: string[];
}) {
  return postCrmBackend<{ success: true; conversationId: string }>("/api/chat/internal/conversations", input);
}

export async function listInternalMessages(conversationId: string, before?: string | null) {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  return getCrmBackend<{ messages: InternalMessage[]; hasMore: boolean; nextCursor: string | null }>(
    `/api/chat/internal/conversations/${encodeURIComponent(conversationId)}/messages${query}`,
  );
}

export async function sendInternalMessage(conversationId: string, input: {
  content: string;
  clientMessageId: string;
  replyToMessageId?: string | null;
  mentions?: InternalMentionDraft[];
  attachmentId?: string | null;
}) {
  return postCrmBackend<{ success: true; messageId: string }>(
    `/api/chat/internal/conversations/${encodeURIComponent(conversationId)}/messages`,
    input,
  );
}

export async function createInternalAttachmentUploadUrl(conversationId: string, input: {
  fileName: string;
  mimeType: string;
  fileSize: number;
  kind: ChatAttachmentKind;
}) {
  return postCrmBackend<InternalUploadIntent>(
    `/api/chat/internal/conversations/${encodeURIComponent(conversationId)}/attachments/upload-url`,
    input,
  );
}

export async function markInternalConversationRead(conversationId: string) {
  return postCrmBackend<{ success: true }>(
    `/api/chat/internal/conversations/${encodeURIComponent(conversationId)}/read`,
    {},
  );
}

export async function listInternalChatUsers(search = "") {
  const response = await getCrmBackend<{ users: InternalChatUser[] }>(
    `/api/chat/internal/users${search ? `?search=${encodeURIComponent(search)}` : ""}`,
  );
  return response.users ?? [];
}

export async function searchInternalMentionableLeads(search: string) {
  const response = await getCrmBackend<{ leads: InternalMentionableLead[] }>(
    `/api/chat/internal/leads?search=${encodeURIComponent(search)}`,
  );
  return response.leads ?? [];
}

export async function updateInternalConversation(conversationId: string, input: { name?: string; archived?: boolean }) {
  return patchCrmBackend<{ success: true }>(
    `/api/chat/internal/conversations/${encodeURIComponent(conversationId)}`,
    input,
  );
}

export async function addInternalConversationMember(conversationId: string, userId: string, isAdmin = false) {
  return postCrmBackend<{ success: true }>(
    `/api/chat/internal/conversations/${encodeURIComponent(conversationId)}/members`,
    { userId, isAdmin },
  );
}

export async function updateInternalConversationMember(
  conversationId: string,
  userId: string,
  input: { isAdmin?: boolean; isActive?: boolean },
) {
  return patchCrmBackend<{ success: true }>(
    `/api/chat/internal/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`,
    input,
  );
}

export async function removeInternalConversationMember(conversationId: string, userId: string) {
  return deleteCrmBackend<{ success: true }>(
    `/api/chat/internal/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`,
  );
}
