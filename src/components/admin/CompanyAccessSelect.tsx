import { useMemo, useState } from "react";
import { Building2, ChevronsUpDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AdminCompany,
  CompanyAccessMembership,
  getCompanyAccessKey,
} from "@/hooks/useCompanyAccess";
import { formatCnpj } from "@/lib/cnpj";

type CompanyAccessSelectProps = {
  userId: string;
  userName: string;
  companies: AdminCompany[];
  memberships: CompanyAccessMembership[];
  loading: boolean;
  savingKeys: Set<string>;
  onToggle: (input: {
    companyId: string;
    crmUserId: string;
    enabled: boolean;
  }) => Promise<void>;
};

export function CompanyAccessSelect({
  userId,
  userName,
  companies,
  memberships,
  loading,
  savingKeys,
  onToggle,
}: CompanyAccessSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedCompanies = useMemo(
    () =>
      new Set(
        memberships
          .filter((membership) => membership.crm_user_id === userId && membership.is_active)
          .map((membership) => membership.empresa_id),
      ),
    [memberships, userId],
  );

  const selectedNames = companies
    .filter((company) => selectedCompanies.has(company.id))
    .map((company) => company.name);

  const triggerLabel = loading
    ? "Carregando..."
    : companies.length === 0
      ? "Nenhuma empresa"
      : selectedNames.length === 0
        ? "Selecionar empresas"
        : selectedNames.length === 1
          ? selectedNames[0]
          : `${selectedNames.length} empresas`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`Empresas de ${userName}`}
          disabled={loading || companies.length === 0}
          className="w-56 justify-between border-[var(--border-input)] bg-[var(--color-surface-1)] px-3 font-normal text-[var(--color-gray-700)] shadow-inset hover:translate-y-0 hover:bg-[var(--color-surface-2)] hover:shadow-inset"
        >
          <span className="truncate">{triggerLabel}</span>
          {loading ? (
            <Loader2 className="animate-spin text-[var(--color-gray-500)]" />
          ) : (
            <ChevronsUpDown className="text-[var(--color-gray-500)]" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Buscar empresa ou CNPJ" />
          <CommandList>
            <CommandEmpty>Nenhuma empresa encontrada.</CommandEmpty>
            <CommandGroup>
              {companies.map((company) => {
                const checked = selectedCompanies.has(company.id);
                const saving = savingKeys.has(getCompanyAccessKey(userId, company.id));
                return (
                  <CommandItem
                    key={company.id}
                    value={`${company.name} ${company.cnpj} ${company.city} ${company.state}`}
                    disabled={saving}
                    onSelect={() =>
                      void onToggle({
                        companyId: company.id,
                        crmUserId: userId,
                        enabled: !checked,
                      })
                    }
                    className="gap-2 data-[selected=true]:bg-[var(--color-bg-subtle)] data-[selected=true]:text-[var(--color-gray-900)]"
                  >
                    <Checkbox
                      checked={checked}
                      tabIndex={-1}
                      aria-hidden="true"
                      className="pointer-events-none"
                    />
                    <Building2 className="text-[var(--color-gray-500)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{company.name}</span>
                      <span className="block truncate font-mono text-xs text-[var(--color-gray-500)]">
                        {formatCnpj(company.cnpj)} · {company.city}/{company.state}
                      </span>
                    </span>
                    {saving ? (
                      <Loader2 className="animate-spin text-[var(--color-gray-500)]" />
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
