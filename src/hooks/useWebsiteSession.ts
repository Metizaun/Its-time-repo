import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  getWebsiteSessionState,
  handoffWebsiteSessionToWhatsApp,
} from "@/services/websiteWidgetService";

/**
 * Tells the chat whether the visitor is still on the site, so the operator can
 * see where the reply will land and move the conversation to WhatsApp instead.
 */
export function useWebsiteSession(leadId: string | null, customerConversationId: string | null = null) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ["website-session", leadId, customerConversationId],
    queryFn: () => getWebsiteSessionState(leadId as string, customerConversationId),
    enabled: Boolean(leadId && customerConversationId),
    refetchInterval: 15000,
  });

  const handoff = useCallback(async () => {
    if (!leadId) return;
    try {
      setBusy(true);
      await handoffWebsiteSessionToWhatsApp(leadId);
      await queryClient.invalidateQueries({ queryKey: ["website-session", leadId, customerConversationId] });
      toast.success("Conversa movida para o WhatsApp");
    } catch (error) {
      toast.error("Não foi possível mover para o WhatsApp", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [leadId, queryClient]);

  return { live: query.data === true, busy, handoff };
}
