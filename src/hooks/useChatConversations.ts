import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { listChatConversations } from "@/services/chatService";
import type { ChatConversation } from "@/types/chat";

export function useChatConversations() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async ({ showLoading = true }: { showLoading?: boolean } = {}) => {
    try {
      if (showLoading) setLoading(true);
      setConversations(await listChatConversations());
    } catch (error) {
      console.error("Erro ao carregar conversas:", error);
      toast.error("Erro ao carregar conversas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);
  return { conversations, loading, refetch };
}
