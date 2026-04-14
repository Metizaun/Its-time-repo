import { useEffect, useMemo, useState } from "react";
import { Clock3, MessageSquarePlus, Save, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";

import {
  type AutomationFunnel,
  type AutomationStep,
  useAutomation,
} from "@/hooks/useAutomation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { type Instance } from "@/hooks/useInstances";
import { type PipelineStage } from "@/types";

import { formatDelayLabel, getMessagePreview, sortStepsForDisplay } from "@/components/automation/automation-utils";

type FunnelFormState = {
  id: string | null;
  name: string;
  trigger_stage_id: string;
  instance_name: string;
  is_active: boolean;
};

type StepTimingMode = "entry" | "after";

type StepFormState = {
  id: string | null;
  label: string;
  timing_mode: StepTimingMode;
  delay_minutes: string;
  message_template: string;
  is_active: boolean;
};

const INITIAL_FUNNEL_FORM: FunnelFormState = {
  id: null,
  name: "",
  trigger_stage_id: "",
  instance_name: "",
  is_active: true,
};

const INITIAL_STEP_FORM: StepFormState = {
  id: null,
  label: "",
  timing_mode: "entry",
  delay_minutes: "5",
  message_template: "",
  is_active: true,
};

interface AutomationMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  funnel: AutomationFunnel | null;
  steps: AutomationStep[];
  stages: PipelineStage[];
  instances: Instance[];
  preselectedStageId: string | null;
  preselectedInstanceName: string | null;
  onSelectFunnel: (funnelId: string | null) => void;
  createFunnel: ReturnType<typeof useAutomation>["createFunnel"];
  updateFunnel: ReturnType<typeof useAutomation>["updateFunnel"];
  deleteFunnel: ReturnType<typeof useAutomation>["deleteFunnel"];
  createStep: ReturnType<typeof useAutomation>["createStep"];
  updateStep: ReturnType<typeof useAutomation>["updateStep"];
  deleteStep: ReturnType<typeof useAutomation>["deleteStep"];
}

export function AutomationMessageModal({
  open,
  onOpenChange,
  funnel,
  steps,
  stages,
  instances,
  preselectedStageId,
  preselectedInstanceName,
  onSelectFunnel,
  createFunnel,
  updateFunnel,
  deleteFunnel,
  createStep,
  updateStep,
  deleteStep,
}: AutomationMessageModalProps) {
  const [funnelForm, setFunnelForm] = useState<FunnelFormState>(INITIAL_FUNNEL_FORM);
  const [stepForm, setStepForm] = useState<StepFormState>(INITIAL_STEP_FORM);
  const [savingFunnel, setSavingFunnel] = useState(false);
  const [savingStep, setSavingStep] = useState(false);

  const orderedSteps = useMemo(() => sortStepsForDisplay(steps), [steps]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (funnel) {
      setFunnelForm({
        id: funnel.id,
        name: funnel.name,
        trigger_stage_id: funnel.trigger_stage_id,
        instance_name: funnel.instance_name,
        is_active: funnel.is_active,
      });
    } else {
      setFunnelForm({
        ...INITIAL_FUNNEL_FORM,
        trigger_stage_id: preselectedStageId || stages[0]?.id || "",
        instance_name: preselectedInstanceName || "",
      });
    }

    setStepForm(INITIAL_STEP_FORM);
  }, [funnel, open, preselectedInstanceName, preselectedStageId, stages]);

  const handleSaveFunnel = async () => {
    if (!funnelForm.name.trim()) {
      toast.error("Informe um nome para a automação");
      return;
    }

    if (!funnelForm.trigger_stage_id) {
      toast.error("Selecione a etapa do pipeline");
      return;
    }

    if (!funnelForm.instance_name) {
      toast.error("Selecione a instância de envio");
      return;
    }

    try {
      setSavingFunnel(true);

      let saved: AutomationFunnel;
      if (funnelForm.id) {
        saved = await updateFunnel(funnelForm.id, {
          name: funnelForm.name.trim(),
          trigger_stage_id: funnelForm.trigger_stage_id,
          instance_name: funnelForm.instance_name,
          is_active: funnelForm.is_active,
        });
      } else {
        saved = await createFunnel({
          name: funnelForm.name.trim(),
          trigger_stage_id: funnelForm.trigger_stage_id,
          instance_name: funnelForm.instance_name,
          is_active: funnelForm.is_active,
        });
      }

      onSelectFunnel(saved.id);
    } catch (error: any) {
      toast.error("Erro ao salvar automação", { description: error.message });
    } finally {
      setSavingFunnel(false);
    }
  };

  const handleDeleteFunnel = async () => {
    if (!funnel) {
      return;
    }

    const confirmed = window.confirm(`Remover a automação "${funnel.name}"?`);
    if (!confirmed) return;

    try {
      await deleteFunnel(funnel.id);
      onSelectFunnel(null);
      onOpenChange(false);
    } catch (error: any) {
      toast.error("Erro ao remover automação", { description: error.message });
    }
  };

  const handleSaveStep = async () => {
    const currentFunnelId = funnelForm.id || funnel?.id || null;

    if (!currentFunnelId) {
      toast.error("Salve a automação antes de criar mensagens");
      return;
    }

    if (!stepForm.label.trim()) {
      toast.error("Informe um rótulo para a mensagem");
      return;
    }

    if (!stepForm.message_template.trim()) {
      toast.error("Escreva a mensagem automática");
      return;
    }

    const parsedDelay = Number(stepForm.delay_minutes);
    if (stepForm.timing_mode === "after" && (Number.isNaN(parsedDelay) || parsedDelay <= 0)) {
      toast.error("O envio depois de entrar no funil exige um valor positivo");
      return;
    }

    if (stepForm.timing_mode === "after" && parsedDelay < 0) {
      toast.error("Não é possível usar tempo negativo");
      return;
    }

    const finalDelay = stepForm.timing_mode === "entry" ? 0 : parsedDelay;

    try {
      setSavingStep(true);

      const payload = {
        label: stepForm.label.trim(),
        delay_minutes: finalDelay,
        message_template: stepForm.message_template.trim(),
        is_active: stepForm.is_active,
      };

      if (stepForm.id) {
        await updateStep(stepForm.id, currentFunnelId, payload);
      } else {
        await createStep(currentFunnelId, payload);
      }

      setStepForm(INITIAL_STEP_FORM);
    } catch (error: any) {
      toast.error("Erro ao salvar mensagem", { description: error.message });
    } finally {
      setSavingStep(false);
    }
  };

  const handleEditStep = (step: AutomationStep) => {
    setStepForm({
      id: step.id,
      label: step.label,
      timing_mode: step.delay_minutes === 0 ? "entry" : "after",
      delay_minutes: step.delay_minutes === 0 ? "5" : String(step.delay_minutes),
      message_template: step.message_template,
      is_active: step.is_active,
    });
  };

  const handleDeleteStep = async (step: AutomationStep) => {
    const currentFunnelId = funnelForm.id || funnel?.id || null;
    if (!currentFunnelId) {
      return;
    }

    const confirmed = window.confirm(`Remover a mensagem "${step.label}"?`);
    if (!confirmed) return;

    try {
      await deleteStep(step.id, currentFunnelId);
      if (stepForm.id === step.id) {
        setStepForm(INITIAL_STEP_FORM);
      }
    } catch (error: any) {
      toast.error("Erro ao remover mensagem", { description: error.message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Workflow className="w-5 h-5" />
            {funnelForm.id ? "Editar automação" : "Nova automação"}
          </DialogTitle>
          <DialogDescription>
            Organize mensagens automáticas por etapa do pipeline sem sair da visão Kanban.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-0 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="border-b px-6 pb-6 xl:border-b-0 xl:border-r">
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="automation-name">Nome da automação</Label>
                <Input
                  id="automation-name"
                  value={funnelForm.name}
                  onChange={(event) => setFunnelForm((previous) => ({ ...previous, name: event.target.value }))}
                  placeholder="Ex: Reativação de lead frio"
                />
              </div>

              <div className="space-y-2">
                <Label>Etapa do pipeline</Label>
                <Select
                  value={funnelForm.trigger_stage_id}
                  onValueChange={(value) =>
                    setFunnelForm((previous) => ({ ...previous, trigger_stage_id: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a etapa" />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Instância de envio</Label>
                <Select
                  value={funnelForm.instance_name}
                  onValueChange={(value) =>
                    setFunnelForm((previous) => ({ ...previous, instance_name: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a instância" />
                  </SelectTrigger>
                  <SelectContent>
                    {instances.length === 0 ? (
                      <SelectItem value="empty" disabled>
                        Nenhuma instância disponível
                      </SelectItem>
                    ) : (
                      instances.map((instance) => (
                        <SelectItem key={instance.instancia} value={instance.instancia}>
                          {instance.instancia}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between rounded-xl border px-4 py-3">
                <div>
                  <p className="font-medium">Automação ativa</p>
                  <p className="text-sm text-muted-foreground">
                    Ao desligar, novos disparos desse funil deixam de ser programados.
                  </p>
                </div>
                <Switch
                  checked={funnelForm.is_active}
                  onCheckedChange={(checked) =>
                    setFunnelForm((previous) => ({ ...previous, is_active: checked }))
                  }
                />
              </div>

              <Alert>
                <AlertTitle>Uso futuro com tags</AlertTitle>
                <AlertDescription>
                  Esta estrutura permite múltiplas automações na mesma etapa para uso futuro com tags. Tags não
                  fazem parte desta implementação.
                </AlertDescription>
              </Alert>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSaveFunnel} disabled={savingFunnel} className="flex-1">
                  {savingFunnel ? <Save className="w-4 h-4 mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                  {savingFunnel ? "Salvando..." : funnelForm.id ? "Salvar automação" : "Criar automação"}
                </Button>

                {funnelForm.id && (
                  <Button variant="outline" onClick={handleDeleteFunnel}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Remover
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="px-6 pb-6">
            <div className="grid gap-6 pt-2 2xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold flex items-center gap-2">
                      <Clock3 className="w-4 h-4" />
                      Mensagens da automação
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      A ordem exibida segue o tempo de envio: entrada no funil primeiro, depois os atrasos positivos.
                    </p>
                  </div>
                </div>

                <Separator />

                {!funnelForm.id ? (
                  <div className="rounded-2xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
                    Salve a automação para começar a cadastrar mensagens.
                  </div>
                ) : orderedSteps.length === 0 ? (
                  <div className="rounded-2xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
                    Nenhuma mensagem cadastrada ainda.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {orderedSteps.map((step) => (
                      <div key={step.id} className="rounded-2xl border bg-card/95 p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium">{step.label}</p>
                              <Badge variant="secondary">{formatDelayLabel(step.delay_minutes)}</Badge>
                              <Badge variant={step.is_active ? "default" : "outline"}>
                                {step.is_active ? "Ativa" : "Pausada"}
                              </Badge>
                            </div>
                            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                              {getMessagePreview(step.message_template, 180)}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleEditStep(step)}>
                              Editar
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleDeleteStep(step)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
                <div>
                  <h3 className="font-semibold flex items-center gap-2">
                    <MessageSquarePlus className="w-4 h-4" />
                    {stepForm.id ? "Editar mensagem" : "Nova mensagem"}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Use `Na entrada do funil` para disparo imediato ou `Depois de` para atraso positivo em minutos.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="step-label">Rótulo</Label>
                  <Input
                    id="step-label"
                    value={stepForm.label}
                    onChange={(event) => setStepForm((previous) => ({ ...previous, label: event.target.value }))}
                    placeholder="Ex: Follow-up 5 minutos"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Quando</Label>
                  <Select
                    value={stepForm.timing_mode}
                    onValueChange={(value: StepTimingMode) =>
                      setStepForm((previous) => ({ ...previous, timing_mode: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="entry">Na entrada do funil</SelectItem>
                      <SelectItem value="after">Depois de</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="step-delay">Tempo em minutos</Label>
                  <Input
                    id="step-delay"
                    type="number"
                    min={stepForm.timing_mode === "entry" ? 0 : 1}
                    value={stepForm.timing_mode === "entry" ? 0 : stepForm.delay_minutes}
                    disabled={stepForm.timing_mode === "entry"}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      if (nextValue.startsWith("-")) {
                        return;
                      }
                      setStepForm((previous) => ({ ...previous, delay_minutes: nextValue }));
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="step-message">Mensagem</Label>
                  <Textarea
                    id="step-message"
                    rows={10}
                    value={stepForm.message_template}
                    onChange={(event) =>
                      setStepForm((previous) => ({ ...previous, message_template: event.target.value }))
                    }
                    placeholder="Oi {nome}, seguimos por aqui caso você queira continuar seu atendimento."
                  />
                </div>

                <div className="flex items-center justify-between rounded-xl border bg-background px-4 py-3">
                  <div>
                    <p className="font-medium">Mensagem ativa</p>
                    <p className="text-sm text-muted-foreground">
                      Mensagens pausadas permanecem cadastradas, mas não geram novos disparos.
                    </p>
                  </div>
                  <Switch
                    checked={stepForm.is_active}
                    onCheckedChange={(checked) =>
                      setStepForm((previous) => ({ ...previous, is_active: checked }))
                    }
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  {stepForm.id && (
                    <Button variant="outline" onClick={() => setStepForm(INITIAL_STEP_FORM)}>
                      Cancelar edição
                    </Button>
                  )}
                  <Button onClick={handleSaveStep} disabled={!funnelForm.id || savingStep}>
                    <Save className="w-4 h-4 mr-2" />
                    {savingStep ? "Salvando..." : stepForm.id ? "Salvar mensagem" : "Adicionar mensagem"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
