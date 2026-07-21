import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { deleteCrmBackend, getCrmBackend, postCrmBackend } from "@/services/crmBackend";

export type AdminInstance = {
  instancia: string;
  color: string | null;
};

export type InstanceAccessMembership = {
  id: string;
  instance_name: string;
  crm_user_id: string;
  access_level: "viewer" | "editor" | "admin";
  is_active: boolean;
};

type InstanceAccessPayload = {
  instances: AdminInstance[];
  memberships: InstanceAccessMembership[];
};

type ToggleInstanceAccessInput = {
  instanceName: string;
  crmUserId: string;
  enabled: boolean;
};

const accessKey = (crmUserId: string, instanceName: string) => `${crmUserId}:${instanceName}`;

export function useInstanceAccess(enabled = true) {
  const [instances, setInstances] = useState<AdminInstance[]>([]);
  const [memberships, setMemberships] = useState<InstanceAccessMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const payload = await getCrmBackend<InstanceAccessPayload>("/api/admin/instance-access");
      setInstances(payload.instances ?? []);
      setMemberships(payload.memberships ?? []);
    } catch (error) {
      toast.error("Erro ao carregar acessos", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleInstanceAccess = useCallback(
    async ({ instanceName, crmUserId, enabled }: ToggleInstanceAccessInput) => {
      const key = accessKey(crmUserId, instanceName);
      setSavingKeys((current) => new Set(current).add(key));

      try {
        if (enabled) {
          const { membership } = await postCrmBackend<{ membership: InstanceAccessMembership }>(
            "/api/admin/instance-access",
            { instanceName, crmUserId }
          );

          setMemberships((current) => [
            ...current.filter(
              (item) => item.crm_user_id !== crmUserId || item.instance_name !== instanceName
            ),
            membership,
          ]);
          return;
        }

        await deleteCrmBackend(
          `/api/admin/instance-access/${encodeURIComponent(instanceName)}/${encodeURIComponent(crmUserId)}`
        );
        setMemberships((current) =>
          current.filter(
            (item) => item.crm_user_id !== crmUserId || item.instance_name !== instanceName
          )
        );
      } catch (error) {
        toast.error(enabled ? "Erro ao liberar instância" : "Erro ao remover instância", {
          description: error instanceof Error ? error.message : "Tente novamente.",
        });
      } finally {
        setSavingKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    []
  );

  return {
    instances,
    memberships,
    loading,
    savingKeys,
    reload: load,
    toggleInstanceAccess,
  };
}

export function getInstanceAccessKey(crmUserId: string, instanceName: string) {
  return accessKey(crmUserId, instanceName);
}
