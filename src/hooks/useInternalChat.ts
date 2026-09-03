import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useChatUnread } from "@/contexts/ChatUnreadContext";
import { supabase } from "@/integrations/supabase/client";
import { createRealtimeChannelName } from "@/lib/realtime";
import {
  createInternalAttachmentUploadUrl,
  listInternalMessages,
  sendInternalMessage,
} from "@/services/internalChatService";
import type { ChatComposerPayload } from "@/types/chat";
import type { InternalMessage } from "@/types/internalChat";

function optimisticPreview(content: string) {
  return content
    .replace(/@\[all\]/g, "@all")
    .replace(/@\[user:[0-9a-f-]{36}\]/gi, "@usuario")
    .replace(/#\[lead:[0-9a-f-]{36}\]/gi, "#lead");
}

export function useInternalChat(conversationId: string | null) {
  const { user, profileName } = useAuth();
  const { markInternalRead, refetchInternal } = useChatUnread();
  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [loading, setLoading] = useState(Boolean(conversationId));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async (showLoading = false) => {
    if (!conversationId) {
      setMessages([]);
      setHasMore(false);
      setNextCursor(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    if (showLoading) setLoading(true);
    try {
      const result = await listInternalMessages(conversationId);
      if (requestId !== requestIdRef.current) return;
      setMessages(result.messages);
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [conversationId]);

  const loadOlder = useCallback(async () => {
    if (!conversationId || !hasMore || !nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await listInternalMessages(conversationId, nextCursor);
      setMessages((current) => {
        const existing = new Set(current.map((message) => message.id));
        return [...result.messages.filter((message) => !existing.has(message.id)), ...current];
      });
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, hasMore, loadingOlder, nextCursor]);

  const sendMessage = useCallback(async (payload: ChatComposerPayload, replyToMessageId?: string | null) => {
    if (!conversationId) throw new Error("Selecione uma conversa do Time");
    const clientMessageId = crypto.randomUUID();
    const optimisticId = `optimistic-${clientMessageId}`;
    const optimisticText = optimisticPreview(payload.content) || (payload.attachment ? "Enviando anexo..." : "");
    const optimistic: InternalMessage = {
      id: optimisticId,
      conversationId,
      authorId: user?.id ?? "current",
      authorName: profileName ?? "Voce",
      isOwn: true,
      content: payload.content,
      segments: [{ type: "text", text: optimisticText }],
      replyTo: null,
      attachments: [],
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      optimistic: true,
    };
    setMessages((current) => [...current, optimistic]);

    try {
      let attachmentId: string | null = null;
      if (payload.attachment) {
        const attachment = payload.attachment;
        const uploadIntent = await createInternalAttachmentUploadUrl(conversationId, {
          fileName: attachment.file.name,
          mimeType: attachment.mimeType,
          fileSize: attachment.file.size,
          kind: attachment.kind,
        });
        const { error: uploadError } = await supabase.storage
          .from(uploadIntent.bucket)
          .uploadToSignedUrl(uploadIntent.storagePath, uploadIntent.uploadToken, attachment.file, {
            contentType: attachment.mimeType,
            upsert: false,
          });
        if (uploadError) throw uploadError;
        attachmentId = uploadIntent.attachmentId;
      }

      await sendInternalMessage(conversationId, {
        content: payload.content,
        clientMessageId,
        replyToMessageId: replyToMessageId ?? null,
        mentions: payload.mentions,
        attachmentId,
      });
      await Promise.all([refetch(false), refetchInternal()]);
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      throw error;
    }
  }, [conversationId, profileName, refetch, refetchInternal, user?.id]);

  useEffect(() => {
    void refetch(true);
  }, [refetch]);

  useEffect(() => {
    if (!conversationId) return;
    const scheduleRefresh = () => {
      void Promise.all([refetch(false), refetchInternal()]);
    };
    const channel = supabase
      .channel(createRealtimeChannelName(`internal-chat-${conversationId}`))
      .on("postgres_changes", { event: "*", schema: "crm", table: "internal_messages", filter: `conversation_id=eq.${conversationId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "crm", table: "internal_message_mentions", filter: `conversation_id=eq.${conversationId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "crm", table: "internal_message_attachments", filter: `conversation_id=eq.${conversationId}` }, scheduleRefresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, refetch, refetchInternal]);

  useEffect(() => {
    if (!conversationId || document.visibilityState !== "visible") return;
    void markInternalRead(conversationId);
  }, [conversationId, markInternalRead, messages.length]);

  useEffect(() => {
    if (!conversationId) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void markInternalRead(conversationId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [conversationId, markInternalRead]);

  return { messages, loading, loadingOlder, hasMore, loadOlder, sendMessage, refetch };
}
