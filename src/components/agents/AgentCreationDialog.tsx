import { useEffect, useState } from "react";
import {
  AudioLines,
  Bot,
  Files,
  Loader2,
  Route,
  ScanFace,
  ScanLine,
  Wallet,
  Wrench,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  listAgentTemplates,
  type AgentTemplate,
  type AgentTemplateTool,
} from "@/services/agentToolsService";

type AgentCreationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: AgentTemplate | null) => void;
};

const TOOL_ICONS = {
  ai_audio: AudioLines,
  forwarding: Route,
  send_media: Files,
  rb_billing: Wallet,
  prescription_analyst: ScanLine,
  visagism: ScanFace,
} as const;

function TemplateTool({ tool }: { tool: AgentTemplateTool }) {
  const Icon = TOOL_ICONS[tool.key as keyof typeof TOOL_ICONS] ?? Wrench;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-bg-subtle)] px-2.5 py-1 font-mono text-[11px] font-medium text-[var(--color-gray-600)]">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {tool.name}
    </span>
  );
}

export function AgentCreationDialog({ open, onOpenChange, onSelect }: AgentCreationDialogProps) {
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let active = true;
    setLoading(true);
    setError(null);

    listAgentTemplates()
      .then((items) => {
        if (active) setTemplates(items);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Nao foi possivel carregar os templates.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Criar agente</DialogTitle>
          <DialogDescription>
            Comece com uma estrutura pronta ou monte o agente do seu jeito.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="templates" className="mt-2">
          <TabsList className="grid w-full grid-cols-2 bg-[var(--color-bg-subtle)]">
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="blank">Em branco</TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="mt-5">
            {loading ? (
              <div className="flex min-h-48 items-center justify-center text-[var(--color-gray-500)]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Carregando templates
              </div>
            ) : error ? (
              <div className="rounded-[var(--radius-xl)] border border-[var(--color-error-border)] bg-[var(--color-error-50)] p-5">
                <p className="text-sm font-semibold text-[var(--color-error-600)]">Templates indisponiveis</p>
                <p className="mt-1 text-sm text-[var(--color-gray-600)]">{error}</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {templates.map((template) => (
                  <article
                    key={`${template.key}:${template.version}`}
                    className="flex min-h-64 flex-col rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-5 shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-mono text-xs font-medium uppercase tracking-wider text-[var(--color-primary-600)]">
                          {template.niche ?? "Template"}
                        </p>
                        <h3 className="mt-2 text-lg font-bold text-[var(--color-gray-900)]">
                          {template.name}
                        </h3>
                      </div>
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-lg)] bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm">
                        <Bot className="h-5 w-5" aria-hidden="true" />
                      </div>
                    </div>

                    <p className="mt-3 text-sm leading-relaxed text-[var(--color-gray-600)]">
                      {template.description}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2" aria-label="Tools incluidas">
                      {template.tools.map((tool) => (
                        <TemplateTool key={tool.key} tool={tool} />
                      ))}
                    </div>

                    <Button className="mt-auto w-full" onClick={() => onSelect(template)}>
                      Usar template
                    </Button>
                  </article>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="blank" className="mt-5">
            <div className="flex min-h-64 flex-col items-center justify-center rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-8 text-center shadow-sm">
              <div className="grid h-14 w-14 place-items-center rounded-[var(--radius-xl)] bg-[var(--color-bg-subtle)] text-[var(--color-gray-600)] shadow-sm">
                <Bot className="h-6 w-6" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-bold text-[var(--color-gray-900)]">Agente em branco</h3>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--color-gray-600)]">
                Configure personalidade e instrucoes agora. As Tools podem ser adicionadas depois.
              </p>
              <Button className="mt-6" onClick={() => onSelect(null)}>
                Criar em branco
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
