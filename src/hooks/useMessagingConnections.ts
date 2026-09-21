import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { getCrmBackend } from "@/services/crmBackend";
import type { MessagingConnection } from "@/types";

export function useMessagingConnections(enabled = true) {
  const [connections, setConnections] = useState<MessagingConnection[]>([]);
  const [loading, setLoading] = useState(enabled);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    try {
      setLoading(true);
      const response = await getCrmBackend<{ connections?: MessagingConnection[] }>("/api/messaging-connections");
      setConnections(response.connections ?? []);
    } catch (error) {
      console.error("Erro ao carregar conexoes de mensagens:", error);
      toast.error("Nao foi possivel carregar as conexoes");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { void refetch(); }, [refetch]);
  return { connections, loading, refetch };
}
