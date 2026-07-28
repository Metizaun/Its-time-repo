import { useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { updateAgentTool, type AgentTool } from "@/services/agentToolsService";

type CalendarPermission = "queryAvailability" | "create" | "reschedule" | "cancel";

type CalendarToolConfigPanelProps = {
  agentId: string;
  tool: AgentTool;
  onClose: () => void;
  onChanged: () => void;
};

const PERMISSIONS: Array<{
  key: CalendarPermission;
  title: string;
  description: string;
}> = [
  {
    key: "queryAvailability",
    title: "Consultar disponibilidade",
    description: "Permite apresentar profissionais, dias e horários realmente disponíveis.",
  },
  {
    key: "create",
    title: "Criar agendamentos",
    description: "Permite confirmar um novo atendimento depois da validação final do horário.",
  },
  {
    key: "reschedule",
    title: "Reagendar",
    description: "Permite mover um agendamento existente para outro horário válido.",
  },
  {
    key: "cancel",
    title: "Cancelar",
    description: "Permite cancelar um agendamento existente registrando o motivo.",
  },
];

export function CalendarToolConfigPanel({
  agentId,
  tool,
  onClose,
  onChanged,
}: CalendarToolConfigPanelProps) {
  const [permissions, setPermissions] = useState<Record<CalendarPermission, boolean>>({
    queryAvailability: tool.config.queryAvailability === true,
    create: tool.config.create === true,
    reschedule: tool.config.reschedule === true,
    cancel: tool.config.cancel === true,
  });
  const [saving, setSaving] = useState(false);

  function togglePermission(key: CalendarPermission, enabled: boolean) {
    setPermissions((current) => {
      const next = { ...current, [key]: enabled };
      if (key !== "queryAvailability" && enabled) next.queryAvailability = true;
      if (key === "queryAvailability" && !enabled) {
        next.create = false;
        next.reschedule = false;
        next.cancel = false;
      }
      return next;
    });
  }

  async function save() {
    if (!Object.values(permissions).some(Boolean)) {
      toast.error("Selecione ao menos uma capacidade da Agenda.");
      return;
    }

    setSaving(true);
    try {
      await updateAgentTool(agentId, "calendar", { config: permissions });
      toast.success("Permissões da Agenda salvas.");
      onChanged();
      onClose();
    } catch (error) {
      toast.error("Não foi possível salvar a Agenda", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--color-primary-200)] bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-semibold text-[var(--color-gray-900)]">Permissões da Agenda</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-gray-500)]">
            A consulta usa as regras configuradas no Calendário. Criação, reagendamento e cancelamento também exigem que o agendamento por IA esteja liberado na conta.
          </p>
        </div>
      </div>

      <div className="mt-4 divide-y divide-[var(--border-default)] rounded-[var(--radius-lg)] border border-[var(--border-default)]">
        {PERMISSIONS.map((permission) => (
          <label key={permission.key} className="flex cursor-pointer items-center gap-4 p-3">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-[var(--color-gray-900)]">{permission.title}</span>
              <span className="mt-0.5 block text-xs text-[var(--color-gray-500)]">{permission.description}</span>
            </span>
            <Switch
              checked={permissions[permission.key]}
              onCheckedChange={(enabled) => togglePermission(permission.key, enabled)}
              aria-label={permission.title}
            />
          </label>
        ))}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button type="button" onClick={() => void save()} disabled={saving} className="shadow-primary">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Salvar permissões
        </Button>
      </div>
    </section>
  );
}
