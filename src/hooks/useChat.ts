import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { sendToWebhook } from "@/services/webhookService";

export interface ChatMessage {
  id: string;
  lead_id: string;
  content: string;
  direction: string;
  direction_code: number;
  sent_at: string;
  lead_name: string;
  sender_name: string | null;
}

export function useChat(leadId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMessages = async () => {
    if (!leadId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("rpc_get_chat", {
        p_lead_id: leadId,
      });

      if (error) throw error;
      setMessages(data || []);
    } catch (error: any) {
      console.error("Erro ao carregar mensagens:", error);
      toast.error("Erro ao carregar chat", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (
    content: string,
    _leadPhone?: string,
    instanceName?: string | null
  ) => {
    if (!leadId || !content.trim()) return;

    const tempMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      lead_id: leadId,
      content: content.trim(),
      direction: "outbound",
      direction_code: 2,
      sent_at: new Date().toISOString(),
      lead_name: "",
      sender_name: "Voce",
    };

    setMessages((prev) => [...prev, tempMessage]);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error("Sessao expirada. Faca login novamente para enviar mensagens.");
      }

      await sendToWebhook({
        accessToken,
        leadId,
        message: content.trim(),
        instanceName: instanceName || null,
      });

      setTimeout(async () => {
        const { data } = await supabase.rpc("rpc_get_chat", {
          p_lead_id: leadId,
        });

        if (data) {
          setMessages(data);
        }
      }, 500);
    } catch (error: any) {
      setMessages((prev) => prev.filter((message) => message.id !== tempMessage.id));

      console.error("Erro ao enviar mensagem:", error);
      toast.error("Erro ao enviar mensagem", {
        description: error.message,
      });
    }
  };

  useEffect(() => {
    if (!leadId) {
      setMessages([]);
      return;
    }

    fetchMessages();

    const channel = supabase
      .channel(`chat-${leadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "crm",
          table: "message_history",
          filter: `lead_id=eq.${leadId}`,
        },
        async (payload) => {
          console.log("Realtime detectou nova mensagem:", payload);

          const newMessage = payload.new as { direction?: string };
          if (newMessage.direction === "inbound" || newMessage.direction === "outbound") {
            const { data } = await supabase.rpc("rpc_get_chat", {
              p_lead_id: leadId,
            });

            if (data) {
              setMessages(data);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leadId]);

  return { messages, loading, sendMessage, refetch: fetchMessages };
}
