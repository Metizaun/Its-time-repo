import { Beaker, Bot, Clock3, Play, Sparkles } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAnchorEventLabel, type AutomationExecution, type AutomationPreviewTreeNode } from "@/lib/automation";
import type { Lead } from "@/hooks/useLeads";

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function PreviewTree({ node }: { node: AutomationPreviewTreeNode }) {
  return (
    <div className="space-y-3 rounded-2xl border bg-background/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={node.matched ? "default" : "outline"}>{node.matched ? "Match" : "Falhou"}</Badge>
        <p className="text-sm font-medium">{node.label}</p>
      </div>

      {typeof node.expected !== "undefined" || typeof node.actual !== "undefined" ? (
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="rounded-xl border px-3 py-2">
            <span className="font-medium text-foreground">Esperado:</span> {String(node.expected)}
          </div>
          <div className="rounded-xl border px-3 py-2">
            <span className="font-medium text-foreground">Atual:</span> {String(node.actual)}
          </div>
        </div>
      ) : null}

      {node.children && node.children.length > 0 ? (
        <div className="space-y-3 border-l pl-4">
          {node.children.map((child, index) => (
            <PreviewTree key={`${child.label}-${index}`} node={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface AutomationSimulationPanelProps {
  funnelId: string | null;
  leads: Lead[];
  selectedLeadId: string;
  onSelectedLeadIdChange: (value: string) => void;
  onRunPreview: () => void | Promise<void>;
  previewLoading: boolean;
  previewResult: {
    anchor_at: string | null;
    anchor_event: "stage_entered_at" | "last_outbound" | "last_inbound";
    entry_rule: AutomationPreviewTreeNode;
    exit_rule: AutomationPreviewTreeNode;
    steps: Array<{
      id: string;
      label: string;
      delay_minutes: number;
      scheduled_at: string | null;
      rule: AutomationPreviewTreeNode | null;
    }>;
  } | null;
  executions: AutomationExecution[];
  executionsLoading: boolean;
}

export function AutomationSimulationPanel({
  funnelId,
  leads,
  selectedLeadId,
  onSelectedLeadIdChange,
  onRunPreview,
  previewLoading,
  previewResult,
  executions,
  executionsLoading,
}: AutomationSimulationPanelProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="space-y-4 rounded-[24px] border bg-card/70 p-5">
          <div>
            <h3 className="flex items-center gap-2 font-semibold">
              <Beaker className="h-4 w-4" />
              Simulacao
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Rode a regra contra um lead real para ver por que a jornada entra, pausa ou sai.
            </p>
          </div>

          {!funnelId ? (
            <Alert>
              <AlertTitle>Salve a automacao primeiro</AlertTitle>
              <AlertDescription>
                A simulacao precisa de uma jornada persistida para consultar o preview no backend.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Lead para simular</label>
                <Select value={selectedLeadId} onValueChange={onSelectedLeadIdChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um lead" />
                  </SelectTrigger>
                  <SelectContent>
                    {leads.map((lead) => (
                      <SelectItem key={lead.id} value={lead.id}>
                        {lead.lead_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={onRunPreview}
                disabled={!selectedLeadId || previewLoading}
                className="w-full"
              >
                <Play className="h-4 w-4" />
                {previewLoading ? "Simulando..." : "Rodar simulacao"}
              </Button>

              <div className="rounded-2xl border border-dashed px-4 py-4 text-xs text-muted-foreground">
                O preview usa as mesmas regras do motor SQL para entrada, saida e validacao das mensagens.
              </div>
            </>
          )}
        </div>

        <div className="space-y-4 rounded-[24px] border bg-card/70 p-5">
          <div>
            <h3 className="flex items-center gap-2 font-semibold">
              <Sparkles className="h-4 w-4" />
              Resultado
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Entenda a ancora usada, os grupos logicos avaliados e o horario previsto de cada mensagem.
            </p>
          </div>

          {previewLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-32 w-full rounded-2xl" />
            </div>
          ) : !previewResult ? (
            <div className="rounded-2xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
              Rode a simulacao para visualizar a arvore de decisao da jornada.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{formatAnchorEventLabel(previewResult.anchor_event)}</Badge>
                <Badge variant="outline">
                  Ancora: {previewResult.anchor_at ? formatDateTime(previewResult.anchor_at) : "indisponivel"}
                </Badge>
              </div>

              <PreviewTree node={previewResult.entry_rule} />
              <PreviewTree node={previewResult.exit_rule} />

              <div className="space-y-3 rounded-2xl border bg-background/50 p-4">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4" />
                  <p className="text-sm font-medium">Mensagens previstas</p>
                </div>

                {previewResult.steps.length === 0 ? (
                  <div className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">
                    Nenhuma mensagem cadastrada nesta jornada.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {previewResult.steps.map((step) => (
                      <div key={step.id} className="rounded-xl border p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{step.label}</p>
                          <Badge variant="outline">{step.delay_minutes} min</Badge>
                          <Badge variant="outline">{formatDateTime(step.scheduled_at)}</Badge>
                        </div>

                        {step.rule ? (
                          <div className="mt-3">
                            <PreviewTree node={step.rule} />
                          </div>
                        ) : (
                          <p className="mt-3 text-xs text-muted-foreground">Sem validacao extra antes do envio.</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 rounded-[24px] border bg-card/70 p-5">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Bot className="h-4 w-4" />
            Ultimas execucoes
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Auditoria rapida do que o worker ja agendou ou processou para esta jornada.
          </p>
        </div>

        {executionsLoading ? (
          <Skeleton className="h-48 w-full rounded-2xl" />
        ) : executions.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
            Nenhuma execucao recente encontrada.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Agenda</TableHead>
                <TableHead>Envio</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {executions.map((execution) => (
                <TableRow key={execution.id}>
                  <TableCell>{execution.lead_name_snapshot || execution.lead_id}</TableCell>
                  <TableCell>
                    <Badge variant={execution.status === "sent" ? "default" : "outline"}>{execution.status}</Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(execution.scheduled_at)}</TableCell>
                  <TableCell>{formatDateTime(execution.sent_at)}</TableCell>
                  <TableCell className="max-w-[260px] truncate">
                    {execution.completed_reason || execution.last_error || "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
