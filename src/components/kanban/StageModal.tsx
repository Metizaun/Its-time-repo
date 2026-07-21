import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { PipelineStage, LeadStatus } from "@/types";
import { CircleHelp, Plus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface StageModalProps {
  isOpen: boolean;
  onClose: () => void;
  stage?: PipelineStage;
  pipelineId?: string | null;
}

const colorPalette = [
  { name: "Azul", value: "#3b82f6" },
  { name: "Cinza", value: "#64748b" },
  { name: "Ciano", value: "#06b6d4" },
  { name: "Verde", value: "#10b981" },
  { name: "Laranja", value: "#f97316" },
  { name: "Vermelho", value: "#ef4444" },
  { name: "Roxo", value: "#8b5cf6" },
];

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(value: string[]) {
  return value.join("\n");
}

export function StageModal({ isOpen, onClose, stage, pipelineId }: StageModalProps) {
  const targetPipelineId = pipelineId ?? stage?.pipeline_id ?? null;
  const { stages, createStage, updateStage, designateAttendanceStage } = usePipelineStages(targetPipelineId);
  const [loading, setLoading] = useState(false);
  const [confirmTransferOpen, setConfirmTransferOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    color: colorPalette[0].value,
    category: "Aberto" as LeadStatus,
    classifier_description: "",
    classifier_positive_signals: "",
    classifier_negative_signals: "",
    classifier_examples: "",
    receivesInbound: false,
  });

  const isEditing = !!stage;
  const isAttendanceSelected = Boolean(stage?.isAttendanceStage || formData.receivesInbound);

  useEffect(() => {
    if (isOpen) {
      if (isEditing && stage) {
        setFormData({
          name: stage.name,
          color: stage.color,
          category: stage.category,
          classifier_description: stage.classifier_description,
          classifier_positive_signals: joinLines(stage.classifier_positive_signals),
          classifier_negative_signals: joinLines(stage.classifier_negative_signals),
          classifier_examples: joinLines(stage.classifier_examples),
          receivesInbound: stage.isAttendanceStage,
        });
      } else {
        setFormData({
          name: "",
          color: colorPalette[0].value,
          category: "Aberto" as LeadStatus,
          classifier_description: "",
          classifier_positive_signals: "",
          classifier_negative_signals: "",
          classifier_examples: "",
          receivesInbound: false,
        });
      }
    }
  }, [isOpen, isEditing, stage]);

  const saveStage = async () => {
    if (!formData.name.trim()) return;

    setLoading(true);
    try {
      if (isEditing && stage) {
        const { error } = await updateStage(stage.id, {
          name: formData.name,
          color: formData.color,
          category: formData.category,
          classifier_description: formData.classifier_description,
          classifier_positive_signals: splitLines(formData.classifier_positive_signals),
          classifier_negative_signals: splitLines(formData.classifier_negative_signals),
          classifier_examples: splitLines(formData.classifier_examples),
        });
        if (error) return;
        if (formData.receivesInbound && !stage.isAttendanceStage && targetPipelineId) {
          const designation = await designateAttendanceStage(targetPipelineId, stage.id);
          if (designation.error) return;
        }
      } else {
        const { data, error } = await createStage({
          name: formData.name,
          color: formData.color,
          category: formData.category,
          pipeline_id: targetPipelineId,
          classifier_description: formData.classifier_description,
          classifier_positive_signals: splitLines(formData.classifier_positive_signals),
          classifier_negative_signals: splitLines(formData.classifier_negative_signals),
          classifier_examples: splitLines(formData.classifier_examples),
        });
        if (error || !data) return;
        if (formData.receivesInbound && targetPipelineId) {
          const designation = await designateAttendanceStage(targetPipelineId, String(data.id));
          if (designation.error) return;
        }
      }
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const currentAttendance = stages.find((currentStage) => currentStage.isAttendanceStage);
    const transfersAttendance = formData.receivesInbound && currentAttendance?.id !== stage?.id;
    if (transfersAttendance) {
      setConfirmTransferOpen(true);
      return;
    }
    void saveStage();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="pipeline-dialog max-h-[92vh] overflow-y-auto p-0 backdrop-blur sm:max-w-xl">
        <DialogHeader className="border-b border-[var(--color-border-subtle)] px-5 pb-4 pt-5">
          <DialogTitle>{isEditing ? "Editar Etapa" : "Nova Etapa"}</DialogTitle>
          <DialogDescription>
            Defina como esta coluna será usada no pipeline.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 pb-5 pt-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Nome da Etapa</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ex: Em Negociacao"
              required
            />
          </div>

          <div className="stage-attendance-setting">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="attendance-stage" className="text-sm font-medium">Atendimento</Label>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="stage-attendance-help"
                      aria-label="O que significa Atendimento?"
                    >
                      <CircleHelp aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64 text-center">
                    {stage?.isAttendanceStage
                      ? "Esta é a etapa de atendimento. Para trocar, ative Atendimento em outra etapa."
                      : "Ao ativar, esta etapa do funil será definida como a etapa de atendimento."}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="stage-attendance-control">
              <Switch
                id="attendance-stage"
                checked={isAttendanceSelected}
                disabled={stage?.isAttendanceStage || loading}
                onCheckedChange={(checked) => setFormData((current) => ({
                  ...current,
                  receivesInbound: checked,
                }))}
                aria-label="Definir como etapa de atendimento"
              />
              <span>{isAttendanceSelected ? "Ligado" : "Desligado"}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="stage_status" className="text-sm font-medium">Status</Label>
            <Select
              value={formData.category}
              onValueChange={(value) => setFormData({ ...formData, category: value as LeadStatus })}
            >
              <SelectTrigger id="stage_status">
                <SelectValue placeholder="Selecione o status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Aberto">Aberto</SelectItem>
                <SelectItem value="Ganho">Ganho</SelectItem>
                <SelectItem value="Perdido">Perdido</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Cor</Label>
            <div className="stage-color-picker" role="group" aria-label="Cor da etapa">
              {colorPalette.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, color: c.value })}
                  className={`stage-color-picker__swatch ${
                    formData.color === c.value ? "stage-color-picker__swatch--selected" : ""
                  }`}
                  aria-pressed={formData.color === c.value}
                  aria-label={c.name}
                  title={c.name}
                >
                  <span style={{ backgroundColor: c.value }} />
                </button>
              ))}
              <label className="stage-color-picker__custom" title="Escolher outra cor">
                <Plus aria-hidden="true" />
                <input
                  type="color"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="stage-color-picker__input"
                  aria-label="Escolher outra cor"
                />
              </label>
            </div>
          </div>

          <div className="stage-guidance">
            <div>
              <p className="stage-guidance__title">Orientações da etapa</p>
              <p className="stage-guidance__description">Opcional. Use palavras simples para ajudar na organização dos leads.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Contexto</Label>
              <Textarea
                value={formData.classifier_description}
                onChange={(e) => setFormData({ ...formData, classifier_description: e.target.value })}
                placeholder="O que costuma acontecer nesta etapa?"
                className="stage-guidance__textarea"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Quando usar</Label>
                <Textarea
                  value={formData.classifier_positive_signals}
                  onChange={(e) => setFormData({ ...formData, classifier_positive_signals: e.target.value })}
                  placeholder="Um exemplo por linha"
                  className="stage-guidance__textarea"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Quando evitar</Label>
                <Textarea
                  value={formData.classifier_negative_signals}
                  onChange={(e) => setFormData({ ...formData, classifier_negative_signals: e.target.value })}
                  placeholder="Um exemplo por linha"
                  className="stage-guidance__textarea"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Exemplos</Label>
                <Textarea
                  value={formData.classifier_examples}
                  onChange={(e) => setFormData({ ...formData, classifier_examples: e.target.value })}
                  placeholder="Um exemplo por linha"
                  className="stage-guidance__textarea"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 border-t border-[var(--color-border-subtle)] pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || !formData.name.trim()}>
              {loading ? "Salvando..." : "Salvar Etapa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <AlertDialog open={confirmTransferOpen} onOpenChange={setConfirmTransferOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transferir a etapa de Atendimento?</AlertDialogTitle>
            <AlertDialogDescription>
              Novas mensagens passarao a encaminhar os leads para “{formData.name.trim()}”. A etapa atual permanecera no pipeline como uma coluna comum.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void saveStage()}>Transferir e salvar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
