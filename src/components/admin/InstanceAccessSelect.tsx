import { useMemo, useState } from "react";
import { ChevronsUpDown, Loader2 } from "lucide-react";

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
  AdminInstance,
  getInstanceAccessKey,
  InstanceAccessMembership,
} from "@/hooks/useInstanceAccess";

type InstanceAccessSelectProps = {
  userId: string;
  userName: string;
  instances: AdminInstance[];
  memberships: InstanceAccessMembership[];
  loading: boolean;
  savingKeys: Set<string>;
  onToggle: (input: {
    instanceName: string;
    crmUserId: string;
    enabled: boolean;
  }) => Promise<void>;
};

export function InstanceAccessSelect({
  userId,
  userName,
  instances,
  memberships,
  loading,
  savingKeys,
  onToggle,
}: InstanceAccessSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedInstances = useMemo(
    () =>
      new Set(
        memberships
          .filter((membership) => membership.crm_user_id === userId && membership.is_active)
          .map((membership) => membership.instance_name)
      ),
    [memberships, userId]
  );

  const selectedNames = instances
    .map((instance) => instance.instancia)
    .filter((instanceName) => selectedInstances.has(instanceName));

  const triggerLabel = loading
    ? "Carregando..."
    : instances.length === 0
      ? "Nenhuma instância"
      : selectedNames.length === 0
        ? "Selecionar instâncias"
        : selectedNames.length === 1
          ? selectedNames[0]
          : `${selectedNames.length} instâncias`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`Instâncias de ${userName}`}
          disabled={loading || instances.length === 0}
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
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Buscar instância" />
          <CommandList>
            <CommandEmpty>Nenhuma instância encontrada.</CommandEmpty>
            <CommandGroup>
              {instances.map((instance) => {
                const checked = selectedInstances.has(instance.instancia);
                const saving = savingKeys.has(getInstanceAccessKey(userId, instance.instancia));

                return (
                  <CommandItem
                    key={instance.instancia}
                    value={instance.instancia}
                    disabled={saving}
                    onSelect={() =>
                      void onToggle({
                        instanceName: instance.instancia,
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
                    <span className="min-w-0 flex-1 truncate">{instance.instancia}</span>
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
