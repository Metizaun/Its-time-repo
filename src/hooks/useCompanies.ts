import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getCrmBackend, patchCrmBackend, postCrmBackend } from "@/services/crmBackend";

export type Company = {
  id: string;
  cnpj: string;
  legalName: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string;
  city: string;
  state: string;
  postalCode: string | null;
  timezone: string;
  searchAliases: string[];
  isActive: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CompanyInput = {
  cnpj: string;
  legalName: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  timezone: string;
  searchAliases: string[];
  isActive: boolean;
};

type CompaniesPayload = { companies: Company[] };

export function useCompanies(enabled = true) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const payload = await getCrmBackend<CompaniesPayload>("/api/admin/companies");
      setCompanies(payload.companies ?? []);
    } catch (error) {
      toast.error("Erro ao carregar empresas", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveCompany = useCallback(
    async (input: CompanyInput, companyId?: string) => {
      try {
        setSaving(true);
        if (companyId) {
          await patchCrmBackend(`/api/admin/companies/${encodeURIComponent(companyId)}`, input);
          toast.success("Empresa atualizada");
        } else {
          await postCrmBackend("/api/admin/companies", input);
          toast.success("Empresa criada");
        }
        await load();
        return true;
      } catch (error) {
        toast.error(companyId ? "Erro ao atualizar empresa" : "Erro ao criar empresa", {
          description: error instanceof Error ? error.message : "Tente novamente.",
        });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  return useMemo(
    () => ({ companies, loading, saving, reload: load, saveCompany }),
    [companies, load, loading, saveCompany, saving],
  );
}
