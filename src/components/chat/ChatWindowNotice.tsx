import { Clock3, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ChatWindowNoticeProps {
  canManageAutomations: boolean;
  onOpenAutomations: () => void;
}

export function ChatWindowNotice({
  canManageAutomations,
  onOpenAutomations,
}: ChatWindowNoticeProps) {
  return (
    <div className="border-t border-[var(--border-default)] bg-[var(--color-surface-1)] px-3 py-3 sm:px-4">
      <div
        role="status"
        className="flex flex-col gap-3 rounded-[var(--radius-xl)] border border-[var(--color-warning-border)] bg-[var(--color-warning-50)] px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-warning-bg)] text-[var(--color-warning-600)]">
            <Clock3 className="h-4 w-4" aria-hidden="true" />
          </div>

          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--color-gray-900)]">
              Janela de atendimento encerrada
            </p>
            <p className="mt-1 text-sm text-[var(--color-gray-600)]">
              {canManageAutomations
                ? "Para iniciar uma nova conversa, envie um template aprovado pela área de Automações."
                : "Para iniciar uma nova conversa, solicite a um administrador o envio de um template aprovado."}
            </p>
          </div>
        </div>

        {canManageAutomations ? (
          <Button
            className="w-full shrink-0 sm:w-auto"
            onClick={onOpenAutomations}
          >
            <Workflow className="mr-2 h-4 w-4" aria-hidden="true" />
            Ir para Automações
          </Button>
        ) : null}
      </div>
    </div>
  );
}
