import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Instance {
  instancia: string;
  color: string | null;
  aces_id: number;
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

      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setError("Usuário não autenticado.");
        setInstances([]);
        return;
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, aces_id, role')
        .eq('auth_user_id', user.id)
        .maybeSingle();

      if (userError) {
        console.error("Erro ao buscar user Crm:", userError);
        setError(`Erro ao buscar dados do usuário: ${userError.message}`);
        setInstances([]);
        return;
      }

      if (!userData?.aces_id) {
        console.warn("Usuário sem aces_id vinculado.");
        setError("Seu usuário não possui um ID de organização (aces_id) vinculado.");
        setInstances([]);
        return;
      }

      const { data: instanceData, error: instanceError } = await supabase
        .from('instance')
        .select('instancia, color, aces_id, status, setup_status, created_by')
        .eq('aces_id', userData.aces_id)
        .or('setup_status.is.null,setup_status.neq.cancelled')
        .order('instancia');

      if (instanceError) {
        console.error("Erro ao buscar instâncias:", instanceError);
        throw instanceError;
      }

      const normalizedInstances = (instanceData || []).filter((instance) => {
        if (instance.setup_status === "cancelled") {
          return false;
        }

        const instanceName = instance.instancia.trim().toLowerCase();
        return instance.created_by === userData.id || instanceName === "prospect";
      });

      setInstances(normalizedInstances);
    } catch (error: any) {
      console.error("Erro ao carregar instâncias:", error);
      setError(error.message);
      setInstances([]);
      toast.error("Erro ao carregar instâncias", { description: error.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  return { instances, loading, error, refetch: fetchInstances };
}
