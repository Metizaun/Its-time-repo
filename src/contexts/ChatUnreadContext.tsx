import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { listChatUnreadCounts, markChatRead } from "@/services/chatUnreadService";

type ChatUnreadContextValue = {
  total: number;
  byLead: Record<string, number>;
  markRead: (leadId: string) => Promise<void>;
  refetch: () => Promise<void>;
};

const ChatUnreadContext = createContext<ChatUnreadContextValue | null>(null);
const APP_TITLE = "Crm Its time";

export function ChatUnreadProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [byLead, setByLead] = useState<Record<string, number>>({});

  const refetch = useCallback(async () => {
    if (!session) {
      setByLead({});
      return;
    }

    const counts = await listChatUnreadCounts();
    setByLead(Object.fromEntries(counts.map((item) => [item.leadId, item.count])));
  }, [session]);

  const markRead = useCallback(async (leadId: string) => {
    if (!session || document.visibilityState !== "visible") return;
    setByLead((current) => ({ ...current, [leadId]: 0 }));
    try {
      await markChatRead(leadId);
      await refetch();
    } catch (error) {
      await refetch();
      console.error("Nao foi possivel sincronizar a leitura da conversa", error);
    }
  }, [refetch, session]);

  useEffect(() => {
    if (!session) return;
    const refreshSilently = () => void refetch().catch((error) => console.error("Nao foi possivel atualizar os contadores", error));
    refreshSilently();

    const channel = supabase
      .channel(`chat-unread-${session.user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "crm", table: "message_history" }, refreshSilently)
      .on("postgres_changes", { event: "*", schema: "crm", table: "chat_read_states" }, refreshSilently)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refreshSilently();
      });

    const handleResume = () => {
      if (document.visibilityState === "visible") refreshSilently();
    };
    window.addEventListener("focus", handleResume);
    document.addEventListener("visibilitychange", handleResume);

    return () => {
      window.removeEventListener("focus", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
      void supabase.removeChannel(channel);
    };
  }, [refetch, session]);

  const total = useMemo(() => Object.values(byLead).reduce((sum, count) => sum + count, 0), [byLead]);

  useEffect(() => {
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) ${APP_TITLE}` : APP_TITLE;
    return () => {
      document.title = APP_TITLE;
    };
  }, [total]);

  const value = useMemo(() => ({ total, byLead, markRead, refetch }), [byLead, markRead, refetch, total]);
  return <ChatUnreadContext.Provider value={value}>{children}</ChatUnreadContext.Provider>;
}

export function useChatUnread() {
  const context = useContext(ChatUnreadContext);
  if (!context) throw new Error("useChatUnread must be used within ChatUnreadProvider");
  return context;
}
