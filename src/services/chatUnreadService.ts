import { supabase } from "@/integrations/supabase/client";

export type ChatUnreadCount = {
  conversationId: string;
  count: number;
};

export async function listChatUnreadCounts(): Promise<ChatUnreadCount[]> {
  const { data, error } = await supabase.rpc("rpc_get_customer_conversation_unread_counts");
  if (error) throw error;

  return ((data ?? []) as Array<{ conversation_id: string; unread_count: number | string }>).map((item) => ({
    conversationId: item.conversation_id,
    count: Number(item.unread_count) || 0,
  }));
}

export async function markChatRead(conversationId: string) {
  const { error } = await supabase.rpc("rpc_mark_customer_conversation_read", { p_conversation_id: conversationId });
  if (error) throw error;
}

export type InternalChatUnreadCount = {
  conversationId: string;
  count: number;
};

export async function listInternalChatUnreadCounts(): Promise<InternalChatUnreadCount[]> {
  const { data, error } = await supabase.rpc("rpc_get_internal_unread_counts");
  if (error) throw error;
  return ((data ?? []) as Array<{ conversation_id: string; unread_count: number | string }>).map((item) => ({
    conversationId: item.conversation_id,
    count: Number(item.unread_count) || 0,
  }));
}

export async function markInternalChatRead(conversationId: string) {
  const { error } = await supabase.rpc("rpc_mark_internal_conversation_read", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}
