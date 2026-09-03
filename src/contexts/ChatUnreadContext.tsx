import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { createRealtimeChannelName } from "@/lib/realtime";
import {
  listChatUnreadCounts,
  listInternalChatUnreadCounts,
  markChatRead,
  markInternalChatRead,
} from "@/services/chatUnreadService";

type ChatUnreadContextValue = {
  total: number;
  leadTotal: number;
  internalTotal: number;
  byLead: Record<string, number>;
  byInternalConversation: Record<string, number>;
  markRead: (leadId: string) => Promise<void>;
  markInternalRead: (conversationId: string) => Promise<void>;
  refetch: () => Promise<void>;
  refetchInternal: () => Promise<void>;
};

const ChatUnreadContext = createContext<ChatUnreadContextValue | null>(null);
const APP_TITLE = "Crm Its time";

export function ChatUnreadProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [byLead, setByLead] = useState<Record<string, number>>({});
  const [byInternalConversation, setByInternalConversation] = useState<Record<string, number>>({});
  const refetchPromiseRef = useRef<Promise<void> | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const internalRefetchPromiseRef = useRef<Promise<void> | null>(null);

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

  const refetchInternal = useCallback((): Promise<void> => {
    if (!session) {
      setByInternalConversation({});
      return Promise.resolve();
    }
    if (internalRefetchPromiseRef.current) return internalRefetchPromiseRef.current;
    const request = listInternalChatUnreadCounts()
      .then((counts) => {
        setByInternalConversation(Object.fromEntries(counts.map((item) => [item.conversationId, item.count])));
      })
      .finally(() => {
        if (internalRefetchPromiseRef.current === request) internalRefetchPromiseRef.current = null;
      });
    internalRefetchPromiseRef.current = request;
    return request;
  }, [session]);

  const refreshNow = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    return Promise.all([refetch(), refetchInternal()]).then(() => undefined);
  }, [refetch, refetchInternal]);

  const scheduleRefetch = useCallback(() => {
    if (refreshTimerRef.current !== null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void Promise.all([refetch(), refetchInternal()])
        .catch((error) => console.error("Nao foi possivel atualizar os contadores", error));
    }, 100);
  }, [refetch, refetchInternal]);

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

  const markInternalRead = useCallback(async (conversationId: string) => {
    if (!session || document.visibilityState !== "visible") return;
    setByInternalConversation((current) => ({ ...current, [conversationId]: 0 }));
    try {
      await markInternalChatRead(conversationId);
      await refetchInternal();
    } catch (error) {
      await refetchInternal();
      console.error("Nao foi possivel sincronizar a leitura interna", error);
    }
  }, [refetchInternal, session]);

  useEffect(() => {
    if (!session) return;
    scheduleRefetch();

    const channel = supabase
      .channel(createRealtimeChannelName(`chat-unread-${session.user.id}`))
      .on("postgres_changes", { event: "INSERT", schema: "crm", table: "message_history" }, scheduleRefetch)
      .on("postgres_changes", { event: "*", schema: "crm", table: "chat_read_states" }, scheduleRefetch)
      .on("postgres_changes", { event: "INSERT", schema: "crm", table: "internal_messages" }, scheduleRefetch)
      .on("postgres_changes", { event: "*", schema: "crm", table: "internal_conversation_members" }, scheduleRefetch)
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

  const leadTotal = useMemo(() => Object.values(byLead).reduce((sum, count) => sum + count, 0), [byLead]);
  const internalTotal = useMemo(
    () => Object.values(byInternalConversation).reduce((sum, count) => sum + count, 0),
    [byInternalConversation],
  );
  const total = leadTotal + internalTotal;

  useEffect(() => {
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) ${APP_TITLE}` : APP_TITLE;
    return () => {
      document.title = APP_TITLE;
    };
  }, [total]);

  const value = useMemo(() => ({
    total,
    leadTotal,
    internalTotal,
    byLead,
    byInternalConversation,
    markRead,
    markInternalRead,
    refetch,
    refetchInternal,
  }), [
    byInternalConversation,
    byLead,
    internalTotal,
    leadTotal,
    markInternalRead,
    markRead,
    refetch,
    refetchInternal,
    total,
  ]);
  return <ChatUnreadContext.Provider value={value}>{children}</ChatUnreadContext.Provider>;
}

export function useChatUnread() {
  const context = useContext(ChatUnreadContext);
  if (!context) throw new Error("useChatUnread must be used within ChatUnreadProvider");
  return context;
}
