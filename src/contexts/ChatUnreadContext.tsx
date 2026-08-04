import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { createRealtimeChannelName } from "@/lib/realtime";
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
  const refetchPromiseRef = useRef<Promise<void> | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const refetch = useCallback((): Promise<void> => {
    if (!session) {
      setByLead({});
      return Promise.resolve();
    }

    if (refetchPromiseRef.current) {
      return refetchPromiseRef.current;
    }

    const request = listChatUnreadCounts()
      .then((counts) => {
        setByLead(Object.fromEntries(counts.map((item) => [item.leadId, item.count])));
      })
      .finally(() => {
        if (refetchPromiseRef.current === request) {
          refetchPromiseRef.current = null;
        }
      });

    refetchPromiseRef.current = request;
    return request;
  }, [session]);

  const refreshNow = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    return refetch();
  }, [refetch]);

  const scheduleRefetch = useCallback(() => {
    if (refreshTimerRef.current !== null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refetch().catch((error) => console.error("Nao foi possivel atualizar os contadores", error));
    }, 100);
  }, [refetch]);

  const markRead = useCallback(async (leadId: string) => {
    if (!session || document.visibilityState !== "visible") return;
    setByLead((current) => ({ ...current, [leadId]: 0 }));
    try {
      await markChatRead(leadId);
      await refreshNow();
    } catch (error) {
      await refreshNow();
      console.error("Nao foi possivel sincronizar a leitura da conversa", error);
    }
  }, [refreshNow, session]);

  useEffect(() => {
    if (!session) return;
    scheduleRefetch();

    const channel = supabase
      .channel(createRealtimeChannelName(`chat-unread-${session.user.id}`))
      .on("postgres_changes", { event: "INSERT", schema: "crm", table: "message_history" }, scheduleRefetch)
      .on("postgres_changes", { event: "*", schema: "crm", table: "chat_read_states" }, scheduleRefetch)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") scheduleRefetch();
      });

    const handleResume = () => {
      if (document.visibilityState === "visible") scheduleRefetch();
    };
    window.addEventListener("focus", handleResume);
    document.addEventListener("visibilitychange", handleResume);

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      window.removeEventListener("focus", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
      void supabase.removeChannel(channel);
    };
  }, [scheduleRefetch, session]);

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
