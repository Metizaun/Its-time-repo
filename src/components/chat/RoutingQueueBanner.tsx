import { Building2, Loader2, UserCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { RoutingQueueItem } from "@/services/routingQueueService";

export function RoutingQueueBanner({
  item,
  busy,
  onClaim,
}: {
  item: RoutingQueueItem;
  busy: boolean;
  onClaim: () => void;
}) {
  const waiting = item.status === "waiting";
  return (
    <div
      className="flex shrink-0 flex-col gap-3 border-b border-[var(--color-primary-100)] bg-[var(--color-primary-50)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-1)] text-[var(--color-primary-600)] shadow-sm">
          {waiting ? <Building2 className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {waiting ? "Aguardando atendimento" : `Assumido por ${item.claimedByName ?? "um atendente"}`}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
            {item.companyName ?? "Encaminhamento interno"}
            {item.reason ? ` · ${item.reason}` : ""}
          </p>
        </div>
      </div>
      {waiting && item.canClaim ? (
        <Button
          size="sm"
          onClick={onClaim}
          disabled={busy}
          className="w-full shrink-0 sm:w-auto"
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
          {busy ? "Assumindo..." : "Assumir atendimento"}
        </Button>
      ) : null}
    </div>
  );
}

