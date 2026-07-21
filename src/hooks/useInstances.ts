import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getCrmBackend } from "@/services/crmBackend";

export interface Instance {
  instancia: string;
  color: string | null;
  aces_id: number;
  provider: "evolution" | "meta" | "gupshup";
  status?: string | null;
  setup_status?: "pending_qr" | "connected" | "expired" | "cancelled" | null;
  created_by?: string | null;
}

export function useInstances() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInstances = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { instances: nextInstances } = await getCrmBackend<{ instances: Instance[] }>("/api/crm/instances");
      setInstances(nextInstances ?? []);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Tente novamente.";
      console.error("Erro ao carregar instancias:", error);
      setError(message);
      setInstances([]);
      toast.error("Erro ao carregar instancias", { description: message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  return { instances, loading, error, refetch: fetchInstances };
}
