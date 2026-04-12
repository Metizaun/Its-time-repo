import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Bot,
  Clock3,
  GripVertical,
  History,
  Plus,
  Save,
  Settings2,
  Trash2,
  Workflow,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { useInstances } from "@/hooks/useInstances";
import {
  AutomationExecution,
  AutomationFunnel,
  AutomationStep,
  useAutomation,
} from "@/hooks/useAutomation";
import { toast } from "sonner";

type FunnelFormState = {
  id: string | null;
  name: string;
  trigger_stage_id: string;
  instance_name: string;
  is_active: boolean;
};

type StepFormState = {
  id: string | null;
  label: string;
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
  delay_minutes: "60",
  message_template: "",
  is_active: true,
};

function statusVariant(status: AutomationExecution["status"]): "default" | "secondary" | "outline" | "destructive" {
  if (status === "sent") return "default";
  if (status === "failed") return "destructive";
  if (status === "cancelled") return "outline";
  return "secondary";
}

function formatRelativeDate(value: string | null) {
  if (!value) return "—";
  return formatDistanceToNowStrict(new Date(value), {
    addSuffix: true,
    locale: ptBR,
  });
}

export default function Automacao() {
  const { userRole } = useAuth();
  const automationEnabled = userRole === "ADMIN";
  const { stages, loading: loadingStages } = usePipelineStages();
  const { instances, loading: loadingInstances } = useInstances();
  const {
    funnels,
    steps,
    executions,
    stepCounts,
    loadingFunnels,
    loadingSteps,
    loadingExecutions,
    fetchSteps,
    fetchExecutions,
    createFunnel,
    updateFunnel,
    deleteFunnel,
    createStep,
    updateStep,
    deleteStep,
    reorderSteps,
  } = useAutomation(automationEnabled);

  const [selectedFunnelId, setSelectedFunnelId] = useState<string | null>(null);
  const [funnelForm, setFunnelForm] = useState<FunnelFormState>(INITIAL_FUNNEL_FORM);
  const [stepForm, setStepForm] = useState<StepFormState>(INITIAL_STEP_FORM);
  const [isCreatingFunnel, setIsCreatingFunnel] = useState(false);
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);
  const [savingFunnel, setSavingFunnel] = useState(false);
  const [savingStep, setSavingStep] = useState(false);

  const selectedFunnel = useMemo(
    () => funnels.find((funnel) => funnel.id === selectedFunnelId) || null,
    [funnels, selectedFunnelId]
  );

  useEffect(() => {
    if (!selectedFunnelId && funnels.length > 0 && !isCreatingFunnel) {
      setSelectedFunnelId(funnels[0].id);
      return;
    }

    if (selectedFunnelId && !funnels.some((funnel) => funnel.id === selectedFunnelId)) {
      setSelectedFunnelId(funnels[0]?.id ?? null);
    }
  }, [funnels, isCreatingFunnel, selectedFunnelId]);

  useEffect(() => {
    if (!selectedFunnel) {
      if (!isCreatingFunnel) {
        setFunnelForm(INITIAL_FUNNEL_FORM);
      }
      setStepForm(INITIAL_STEP_FORM);
      return;
    }

    setIsCreatingFunnel(false);
    setFunnelForm({
      id: selectedFunnel.id,
      name: selectedFunnel.name,
      trigger_stage_id: selectedFunnel.trigger_stage_id,
      instance_name: selectedFunnel.instance_name,
      is_active: selectedFunnel.is_active,
    });

    fetchSteps(selectedFunnel.id);
    fetchExecutions(selectedFunnel.id);
    setStepForm(INITIAL_STEP_FORM);
  }, [fetchExecutions, fetchSteps, isCreatingFunnel, selectedFunnel]);

  if (userRole !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  const handleNewFunnel = () => {
    setIsCreatingFunnel(true);
    setSelectedFunnelId(null);
    setFunnelForm({
      ...INITIAL_FUNNEL_FORM,
      trigger_stage_id: stages[0]?.id ?? "",
      instance_name: instances[0]?.instancia ?? "",
    });
    setStepForm(INITIAL_STEP_FORM);
  };

  const handleSaveFunnel = async () => {
    if (!funnelForm.name.trim()) {
      toast.error("Informe um nome para o funil");
      return;
    }

    if (!funnelForm.trigger_stage_id) {
      toast.error("Selecione a etapa gatilho");
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

      setIsCreatingFunnel(false);
      setSelectedFunnelId(saved.id);
    } catch (error: any) {
      console.error("Erro ao salvar funil:", error);
      toast.error("Erro ao salvar funil", { description: error.message });
    } finally {
      setSavingFunnel(false);
    }
  };

  const handleDeleteFunnel = async () => {
    if (!selectedFunnel) return;

    const confirmed = window.confirm(`Remover o funil "${selectedFunnel.name}"?`);
    if (!confirmed) return;

    try {
      await deleteFunnel(selectedFunnel.id);
      setIsCreatingFunnel(false);
      setSelectedFunnelId(null);
      setFunnelForm(INITIAL_FUNNEL_FORM);
      setStepForm(INITIAL_STEP_FORM);
    } catch (error: any) {
      console.error("Erro ao remover funil:", error);
      toast.error("Erro ao remover funil", { description: error.message });
    }
  };

  const handleSaveStep = async () => {
    if (!selectedFunnel) {
      toast.error("Salve o funil antes de criar disparos");
      return;
    }

    if (!stepForm.label.trim()) {
      toast.error("Informe um rótulo para o disparo");
      return;
    }

    if (!stepForm.message_template.trim()) {
      toast.error("Escreva a mensagem do disparo");
      return;
    }

    const delay = Number(stepForm.delay_minutes);
    if (Number.isNaN(delay) || delay < 0) {
      toast.error("Delay inválido");
      return;
    }

    try {
      setSavingStep(true);

      const payload = {
        label: stepForm.label.trim(),
        delay_minutes: delay,
        message_template: stepForm.message_template.trim(),
        is_active: stepForm.is_active,
      };

      if (stepForm.id) {
        await updateStep(stepForm.id, selectedFunnel.id, payload);
      } else {
        await createStep(selectedFunnel.id, payload);
      }

      setStepForm(INITIAL_STEP_FORM);
    } catch (error: any) {
      console.error("Erro ao salvar disparo:", error);
      toast.error("Erro ao salvar disparo", { description: error.message });
    } finally {
      setSavingStep(false);
    }
  };

  const handleEditStep = (step: AutomationStep) => {
    setStepForm({
      id: step.id,
      label: step.label,
      delay_minutes: String(step.delay_minutes),
      message_template: step.message_template,
      is_active: step.is_active,
    });
  };

  const handleDeleteStep = async (step: AutomationStep) => {
    if (!selectedFunnel) return;
    const confirmed = window.confirm(`Remover o disparo "${step.label}"?`);
    if (!confirmed) return;

    try {
      await deleteStep(step.id, selectedFunnel.id);
      if (stepForm.id === step.id) {
        setStepForm(INITIAL_STEP_FORM);
      }
    } catch (error: any) {
      console.error("Erro ao remover disparo:", error);
      toast.error("Erro ao remover disparo", { description: error.message });
    }
  };

  const handleStepDrop = async (targetStepId: string) => {
    if (!draggedStepId || !selectedFunnel || draggedStepId === targetStepId) return;

    const sourceIndex = steps.findIndex((step) => step.id === draggedStepId);
    const targetIndex = steps.findIndex((step) => step.id === targetStepId);

    if (sourceIndex === -1 || targetIndex === -1) return;

    const reordered = [...steps];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    await reorderSteps(
      selectedFunnel.id,
      reordered.map((step, index) => ({ ...step, position: index }))
    );
    setDraggedStepId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Workflow className="w-8 h-8" />
            Automação
          </h1>
          <p className="text-muted-foreground mt-1">
            Follow-up automático por entrada em etapa. A V1 usa a instância escolhida no funil.
          </p>
        </div>

        <Button onClick={handleNewFunnel}>
          <Plus className="w-4 h-4 mr-2" />
          Novo funil
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6 items-start">
        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                <Bot className="w-4 h-4" />
                Funis
              </h2>
              <p className="text-sm text-muted-foreground">Escolha o número que vai disparar a mensagem.</p>
            </div>
          </div>

          <Separator />

          {loadingFunnels ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : funnels.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Nenhum funil criado ainda.
            </div>
          ) : (
            <div className="space-y-3">
              {funnels.map((funnel) => {
                const stage = stages.find((item) => item.id === funnel.trigger_stage_id);
                const isSelected = funnel.id === selectedFunnelId;

                return (
                  <button
                    key={funnel.id}
                    type="button"
                    onClick={() => {
                      setIsCreatingFunnel(false);
                      setSelectedFunnelId(funnel.id);
                    }}
                    className={`w-full rounded-lg border p-4 text-left transition-colors ${
                      isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{funnel.name}</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Etapa: {stage?.name ?? "Etapa não encontrada"}
                        </p>
                      </div>
                      <Badge variant={funnel.is_active ? "default" : "outline"}>
                        {funnel.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{stepCounts[funnel.id] || 0} disparos</span>
                      <span>•</span>
                      <span>{funnel.instance_name}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold flex items-center gap-2">
                  <Settings2 className="w-4 h-4" />
                  {funnelForm.id ? "Editar funil" : "Novo funil"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Escolha a etapa gatilho e o número que vai enviar os follow-ups.
                </p>
              </div>

              {selectedFunnel && (
                <Button variant="outline" onClick={handleDeleteFunnel}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Remover
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="funnel-name">Nome do funil</Label>
                <Input
                  id="funnel-name"
                  value={funnelForm.name}
                  onChange={(event) => setFunnelForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Ex: Follow-up Atendimento"
                />
              </div>

              <div className="space-y-2">
                <Label>Etapa gatilho</Label>
                <Select
                  value={funnelForm.trigger_stage_id}
                  onValueChange={(value) => setFunnelForm((prev) => ({ ...prev, trigger_stage_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a etapa" />
                  </SelectTrigger>
                  <SelectContent>
                    {loadingStages ? (
                      <SelectItem value="loading" disabled>Carregando...</SelectItem>
                    ) : (
                      stages.map((stage) => (
                        <SelectItem key={stage.id} value={stage.id}>
                          {stage.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Instância de envio</Label>
                <Select
                  value={funnelForm.instance_name}
                  onValueChange={(value) => setFunnelForm((prev) => ({ ...prev, instance_name: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a instância" />
                  </SelectTrigger>
                  <SelectContent>
                    {loadingInstances ? (
                      <SelectItem value="loading" disabled>Carregando...</SelectItem>
                    ) : instances.length === 0 ? (
                      <SelectItem value="empty" disabled>Nenhuma instância conectada</SelectItem>
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

              <div className="flex items-center justify-between rounded-lg border px-4 py-3 md:col-span-2">
                <div>
                  <p className="font-medium">Funil ativo</p>
                  <p className="text-sm text-muted-foreground">
                    Se desligar, execuções pendentes desse funil serão canceladas.
                  </p>
                </div>
                <Switch
                  checked={funnelForm.is_active}
                  onCheckedChange={(checked) => setFunnelForm((prev) => ({ ...prev, is_active: checked }))}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSaveFunnel} disabled={savingFunnel || loadingStages || loadingInstances}>
                <Save className="w-4 h-4 mr-2" />
                {savingFunnel ? "Salvando..." : funnelForm.id ? "Salvar alterações" : "Criar funil"}
              </Button>
            </div>
          </Card>

          <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold flex items-center gap-2">
                    <Clock3 className="w-4 h-4" />
                    Disparos do funil
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Reordene com drag and drop nativo. O delay sempre conta da entrada na etapa.
                  </p>
                </div>
              </div>

              {!selectedFunnel ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Crie ou selecione um funil para configurar os disparos.
                </div>
              ) : loadingSteps ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : steps.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Nenhum disparo configurado ainda.
                </div>
              ) : (
                <div className="space-y-3">
                  {steps.map((step) => (
                    <div
                      key={step.id}
                      draggable
                      onDragStart={() => setDraggedStepId(step.id)}
                      onDragEnd={() => setDraggedStepId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => handleStepDrop(step.id)}
                      className="rounded-lg border p-4 bg-card hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <GripVertical className="w-4 h-4 mt-1 text-muted-foreground" />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium">{step.label}</p>
                              <Badge variant={step.is_active ? "default" : "outline"}>
                                {step.is_active ? "Ativo" : "Inativo"}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {step.delay_minutes} min após entrar na etapa
                            </p>
                            <p className="text-sm mt-3 whitespace-pre-wrap">
                              {step.message_template}
                            </p>
                          </div>
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
            </Card>

            <Card className="p-6 space-y-4">
              <div>
                <h2 className="font-semibold">{stepForm.id ? "Editar disparo" : "Novo disparo"}</h2>
                <p className="text-sm text-muted-foreground">
                  Variáveis disponíveis: {"{nome}"}, {"{telefone}"}, {"{cidade}"}, {"{status}"}.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="step-label">Rótulo</Label>
                <Input
                  id="step-label"
                  value={stepForm.label}
                  onChange={(event) => setStepForm((prev) => ({ ...prev, label: event.target.value }))}
                  placeholder="Ex: Follow-up 1h"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="step-delay">Delay em minutos</Label>
                <Input
                  id="step-delay"
                  type="number"
                  min={0}
                  value={stepForm.delay_minutes}
                  onChange={(event) => setStepForm((prev) => ({ ...prev, delay_minutes: event.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="step-template">Mensagem</Label>
                <Textarea
                  id="step-template"
                  rows={8}
                  value={stepForm.message_template}
                  onChange={(event) => setStepForm((prev) => ({ ...prev, message_template: event.target.value }))}
                  placeholder="Oi {nome}, passando para continuar seu atendimento."
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                <div>
                  <p className="font-medium">Disparo ativo</p>
                  <p className="text-sm text-muted-foreground">Se desligar, pendências desse disparo serão canceladas.</p>
                </div>
                <Switch
                  checked={stepForm.is_active}
                  onCheckedChange={(checked) => setStepForm((prev) => ({ ...prev, is_active: checked }))}
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                {stepForm.id && (
                  <Button variant="outline" onClick={() => setStepForm(INITIAL_STEP_FORM)}>
                    Cancelar edição
                  </Button>
                )}
                <Button onClick={handleSaveStep} disabled={savingStep || !selectedFunnel}>
                  <Save className="w-4 h-4 mr-2" />
                  {savingStep ? "Salvando..." : stepForm.id ? "Salvar disparo" : "Criar disparo"}
                </Button>
              </div>
            </Card>
          </div>

          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4" />
              <div>
                <h2 className="font-semibold">Execuções recentes</h2>
                <p className="text-sm text-muted-foreground">Últimos 50 disparos do funil selecionado.</p>
              </div>
            </div>

            {!selectedFunnel ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Selecione um funil para acompanhar o histórico.
              </div>
            ) : loadingExecutions ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : executions.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Ainda não há execuções registradas para este funil.
              </div>
            ) : (
              <div className="space-y-3">
                {executions.map((execution) => (
                  <div key={execution.id} className="rounded-lg border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">{execution.step_label_snapshot || "Disparo"}</p>
                          <Badge variant={statusVariant(execution.status)}>{execution.status}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {execution.lead_name_snapshot || "Lead sem nome"} • {execution.phone_snapshot || "Sem telefone"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Instância: {execution.instance_snapshot || "Não definida"}
                        </p>
                        {execution.rendered_message && (
                          <p className="text-sm whitespace-pre-wrap">{execution.rendered_message}</p>
                        )}
                        {execution.last_error && (
                          <p className="text-sm text-destructive">{execution.last_error}</p>
                        )}
                      </div>

                      <div className="text-sm text-muted-foreground space-y-1 min-w-[180px]">
                        <p>Agendado: {formatRelativeDate(execution.scheduled_at)}</p>
                        <p>Enviado: {formatRelativeDate(execution.sent_at)}</p>
                        <p>Cancelado: {formatRelativeDate(execution.cancelled_at)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
