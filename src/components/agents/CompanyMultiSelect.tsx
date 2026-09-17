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
import { formatCnpj } from "@/lib/cnpj";

type CompanyOption = {
  id: string;
  name: string;
  cnpj: string;
  city: string;
  state: string;
};

type CompanyMultiSelectProps = {
  companies: CompanyOption[];
  loading: boolean;
  disabled?: boolean;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

export function CompanyMultiSelect({ companies, loading, disabled, selectedIds, onChange }: CompanyMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const selectedNames = companies
    .filter((company) => selected.has(company.id))
    .map((company) => company.name);

  const triggerLabel = loading
    ? "Carregando..."
    : companies.length === 0
      ? "Nenhuma empresa cadastrada"
      : selectedNames.length === 0
        ? "Nenhuma empresa selecionada"
        : selectedNames.length === 1
          ? selectedNames[0]
          : `${selectedNames.length} empresas`;

  function toggle(companyId: string) {
    const next = new Set(selected);
    if (next.has(companyId)) {
      next.delete(companyId);
    } else {
      next.add(companyId);
    }
    onChange([...next]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Empresas visiveis para este agente"
          disabled={disabled || loading || companies.length === 0}
          className="w-full justify-between border-[var(--border-input)] bg-[var(--color-surface-1)] px-3 font-normal text-[var(--color-gray-700)] shadow-inset hover:translate-y-0 hover:bg-[var(--color-surface-2)] hover:shadow-inset sm:w-72"
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
                const checked = selected.has(company.id);
                return (
                  <CommandItem
                    key={company.id}
                    value={`${company.name} ${company.cnpj} ${company.city} ${company.state}`}
                    onSelect={() => toggle(company.id)}
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
