import type { InternalConversation } from "@/types/internalChat";

export function getInternalConversationName(conversation: InternalConversation) {
  if (conversation.kind === "group") return conversation.name || "Grupo sem nome";
  return conversation.members.find((member) => !member.isCurrentUser)?.name ?? "Conversa direta";
}
