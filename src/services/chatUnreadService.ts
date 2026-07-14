import { supabase } from "@/integrations/supabase/client";

export type ChatUnreadCount = {
  leadId: string;
  count: number;
};

export async function listChatUnreadCounts(): Promise<ChatUnreadCount[]> {
  const { data, error } = await supabase.rpc("rpc_get_chat_unread_counts");
  if (error) throw error;

  return ((data ?? []) as Array<{ lead_id: string; unread_count: number | string }>).map((item) => ({
    leadId: item.lead_id,
    count: Number(item.unread_count) || 0,
  }));
}

export async function markChatRead(leadId: string) {
  const { error } = await supabase.rpc("rpc_mark_chat_read", { p_lead_id: leadId });
  if (error) throw error;
}
