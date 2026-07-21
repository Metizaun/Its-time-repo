import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  createAttachmentUploadUrl,
  getTemplateRequiredPolicyFromError,
  listChatMessages,
  sendManualMessage,
} from "@/services/chatService";
import type { ChatComposerPayload, ChatMessage, ChatSendPolicy } from "@/types/chat";

export type { ChatMessage } from "@/types/chat";

export function useChat(leadId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sendPolicy, setSendPolicy] = useState<ChatSendPolicy | null>(null);
  const [loading, setLoading] = useState(false);
  const activeLeadIdRef = useRef(leadId);
  activeLeadIdRef.current = leadId;

  const fetchMessages = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!leadId) return;

    if (!options.silent) setLoading(true);
    try {
      const result = await listChatMessages(leadId);
      if (activeLeadIdRef.current !== leadId) return;
      setMessages(result.messages);
      setSendPolicy(result.sendPolicy);
    } catch (error: unknown) {
      console.error("Erro ao carregar mensagens:", error);
      toast.error("Erro ao carregar chat", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      if (!options.silent && activeLeadIdRef.current === leadId) setLoading(false);
    }
  }, [leadId]);

  const sendMessage = async (
    payload: ChatComposerPayload,
    _leadPhone?: string,
    instanceName?: string | null
  ) => {
    if (!leadId) return;

    const content = payload.content.trim();
    const attachment = payload.attachment ?? null;
    if (!content && !attachment) return;

    const shouldUseOptimisticText = !attachment;
    const tempMessage: ChatMessage | null = shouldUseOptimisticText
        ? {
            id: `temp-${Date.now()}`,
            lead_id: leadId,
            content,
            direction: "outbound",
            direction_code: 2,
            sent_at: new Date().toISOString(),
            lead_name: "",
            sender_name: "Voce",
            source_type: "human",
            system_kind: null,
            provider_status: null,
            quick_reply: null,
            attachments: [],
          }
      : null;

    if (tempMessage) {
      setMessages((prev) => [...prev, tempMessage]);
    }

    try {
      if (attachment) {
        const mimeType = attachment.mimeType;
        const uploadIntent = await createAttachmentUploadUrl({
          leadId,
          instanceName: instanceName || null,
          fileName: attachment.file.name,
          mimeType,
          fileSize: attachment.file.size,
          kind: attachment.kind,
        });

        const { error: uploadError } = await supabase.storage
          .from(uploadIntent.bucket)
          .uploadToSignedUrl(uploadIntent.storagePath, uploadIntent.uploadToken, attachment.file, {
            contentType: mimeType,
            upsert: false,
          });

        if (uploadError) {
          throw uploadError;
        }

        await sendManualMessage(leadId, {
          content,
          instanceName: instanceName || null,
          attachment: {
            messageId: uploadIntent.messageId,
            attachmentId: uploadIntent.attachmentId,
            storagePath: uploadIntent.storagePath,
            fileName: attachment.file.name,
            mimeType: uploadIntent.mimeType,
            fileSize: attachment.file.size,
            kind: uploadIntent.kind,
          },
        });
      } else {
        await sendManualMessage(leadId, {
          content,
          instanceName: instanceName || null,
        });
      }

      await fetchMessages();
    } catch (error: unknown) {
      if (tempMessage) {
        setMessages((prev) => prev.filter((message) => message.id !== tempMessage.id));
      }

      const blockedPolicy = getTemplateRequiredPolicyFromError(error);
      if (blockedPolicy) {
        setSendPolicy(blockedPolicy);
      }

      console.error("Erro ao enviar mensagem:", error);
      toast.error("Erro ao enviar mensagem", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
      throw error;
    }
  };

  useEffect(() => {
    if (!leadId) {
      setMessages([]);
      setSendPolicy(null);
      setLoading(false);
      return;
    }

    setSendPolicy(null);
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
            await fetchMessages({ silent: true });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "crm",
          table: "message_attachments",
          filter: `lead_id=eq.${leadId}`,
        },
        async (payload) => {
          console.log("Realtime detectou novo anexo de mensagem:", payload);
          await fetchMessages({ silent: true });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "crm",
          table: "message_attachments",
          filter: `lead_id=eq.${leadId}`,
        },
        async (payload) => {
          console.log("Realtime detectou atualizacao de anexo de mensagem:", payload);
          await fetchMessages({ silent: true });
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void fetchMessages({ silent: true });
      });

    const handleResume = () => {
      if (document.visibilityState === "visible") void fetchMessages({ silent: true });
    };
    window.addEventListener("focus", handleResume);
    document.addEventListener("visibilitychange", handleResume);

    return () => {
      window.removeEventListener("focus", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
      void supabase.removeChannel(channel);
    };
  }, [fetchMessages, leadId]);

  useEffect(() => {
    if (
      sendPolicy?.provider !== "gupshup" ||
      sendPolicy.mode !== "freeform" ||
      sendPolicy.remainingMs === null
    ) {
      return;
    }

    const delayMs = Math.max(0, sendPolicy.remainingMs) + 25;
    const timeoutId = window.setTimeout(() => {
      setSendPolicy((current) =>
        current?.provider === "gupshup"
          ? { ...current, mode: "template_required", remainingMs: 0 }
          : current
      );
      void fetchMessages({ silent: true });
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [fetchMessages, sendPolicy]);

  return { messages, sendPolicy, loading, sendMessage, refetch: fetchMessages };
}
