import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { deleteCrmBackend, getCrmBackend, postCrmBackend } from "@/services/crmBackend";

export type AdminCompany = {
  id: string;
  cnpj: string;
  name: string;
  city: string;
  state: string;
  is_active: boolean;
};

export type CompanyAccessMembership = {
  id: string;
  empresa_id: string;
  crm_user_id: string;
  is_active: boolean;
};

type CompanyAccessPayload = {
  companies: AdminCompany[];
  memberships: CompanyAccessMembership[];
};

const accessKey = (crmUserId: string, companyId: string) => `${crmUserId}:${companyId}`;

export function useCompanyAccess(enabled = true) {
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [memberships, setMemberships] = useState<CompanyAccessMembership[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const payload = await getCrmBackend<CompanyAccessPayload>("/api/admin/company-access");
      setCompanies(payload.companies ?? []);
      setMemberships(payload.memberships ?? []);
    } catch (error) {
      toast.error("Erro ao carregar acessos de empresa", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleCompanyAccess = useCallback(
    async ({ companyId, crmUserId, enabled: shouldEnable }: {
      companyId: string;
      crmUserId: string;
      enabled: boolean;
    }) => {
      const key = accessKey(crmUserId, companyId);
      setSavingKeys((current) => new Set(current).add(key));

      try {
        if (shouldEnable) {
          const { membership } = await postCrmBackend<{
            membership: CompanyAccessMembership;
          }>("/api/admin/company-access", { companyId, crmUserId });
          setMemberships((current) => [
            ...current.filter(
              (item) => item.crm_user_id !== crmUserId || item.empresa_id !== companyId,
            ),
            membership,
          ]);
        } else {
          await deleteCrmBackend(
            `/api/admin/company-access/${encodeURIComponent(companyId)}/${encodeURIComponent(crmUserId)}`,
          );
          setMemberships((current) =>
            current.filter(
              (item) => item.crm_user_id !== crmUserId || item.empresa_id !== companyId,
            ),
          );
        }
      } catch (error) {
        toast.error(shouldEnable ? "Erro ao liberar empresa" : "Erro ao remover empresa", {
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
    [],
  );

  return {
    companies,
    memberships,
    loading,
    savingKeys,
    reload: load,
    toggleCompanyAccess,
  };
}

export function getCompanyAccessKey(crmUserId: string, companyId: string) {
  return accessKey(crmUserId, companyId);
}
