import { useState, useMemo, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { PipelineStage } from "@/types";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface DeleteStageModalProps {
  isOpen: boolean;
  onClose: () => void;
  stage?: PipelineStage;
}

export function DeleteStageModal({ isOpen, onClose, stage }: DeleteStageModalProps) {
  const { stages, deleteStage } = usePipelineStages();
  const [loading, setLoading] = useState(false);
  const [checkingCount, setCheckingCount] = useState(false);
  const [stageLeadsCount, setStageLeadsCount] = useState(0);
  const [destinationStageId, setDestinationStageId] = useState<string>("");

  const hasLeads = stageLeadsCount > 0;

  const availableDestinations = useMemo(() => {
    if (!stage) return [];
    return stages.filter((s) => s.id !== stage.id);
  }, [stages, stage]);

  const fetchStageLeadCount = useCallback(async (stageId: string) => {
    setCheckingCount(true);
    try {
      const { count, error } = await supabase
        .from("leads")
        .select("id", { head: true, count: "exact" })
        .eq("stage_id", stageId)
        .eq("view", true);

      if (error) throw error;
      const nextCount = count || 0;
      setStageLeadsCount(nextCount);
      return nextCount;
    } catch (error: any) {
      console.error("Erro ao contar leads da etapa:", error);
      toast.error("Erro ao verificar leads da etapa", { description: error.message });
      setStageLeadsCount(0);
      return 0;
    } finally {
      setCheckingCount(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !stage?.id) {
      setStageLeadsCount(0);
      setDestinationStageId("");
      return;
    }

    setDestinationStageId("");
    fetchStageLeadCount(stage.id);
  }, [isOpen, stage?.id, fetchStageLeadCount]);

  const isLocked = useMemo(() => {
    if (!stage) return false;
    if (stage.category === "Aberto") return false;

    const countOfThisCategory = stages.filter((s) => s.category === stage.category).length;
    return countOfThisCategory <= 1;
  }, [stages, stage]);

  const handleDelete = async () => {
    if (!stage) return;

    const latestCount = await fetchStageLeadCount(stage.id);
    const latestHasLeads = latestCount > 0;

    if (isLocked && latestHasLeads) {
      toast.error(`Nao e possivel excluir a ultima etapa de categoria "${stage.category}" enquanto houver leads nela.`);
      return;
    }

    if (latestHasLeads && !destinationStageId) {
      toast.error("Selecione uma etapa de destino para os leads existentes.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await deleteStage(stage.id, latestHasLeads ? destinationStageId : undefined);
      if (error) return;
      onClose();
    } finally {
      setLoading(false);
    }
  };

  if (!stage) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-destructive flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Excluir Etapa: {stage.name}
          </DialogTitle>
          <DialogDescription>
            {isLocked && stage.category !== "Aberto"
              ? "Esta acao esta bloqueada."
              : "Atencao: a exclusao de etapas pode afetar metricas e historico."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isLocked && stage.category !== "Aberto" ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Nao e possivel excluir</AlertTitle>
              <AlertDescription>
                Esta e a unica etapa do tipo <strong>{stage.category}</strong>. O sistema exige que exista pelo menos uma etapa desse tipo para manter a logica de conversao.
                <br />
                <br />
                Se precisar, edite esta etapa ou crie uma nova antes de excluir esta.
              </AlertDescription>
            </Alert>
          ) : checkingCount ? (
            <p>Verificando leads desta etapa...</p>
          ) : !hasLeads ? (
            <p>
              Esta etapa nao possui nenhum lead no momento.
              Tem certeza que deseja exclui-la permanentemente?
            </p>
          ) : (
            <div className="space-y-4">
              <Alert>
                <ArrowRight className="h-4 w-4" />
                <AlertTitle>Acao necessaria</AlertTitle>
                <AlertDescription>
                  Esta etapa possui <strong>{stageLeadsCount} leads</strong> no momento.
                  Para exclui-la de forma segura, voce deve transferir esses leads para outra etapa do funil.
                </AlertDescription>
              </Alert>

              <div className="space-y-2 mt-4">
                <label className="text-sm font-medium">Mover leads para a etapa:</label>
                <Select value={destinationStageId} onValueChange={setDestinationStageId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a etapa de destino..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableDestinations.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.category})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={loading || checkingCount || isLocked || (hasLeads && !destinationStageId)}
          >
            {loading ? "Excluindo..." : "Excluir Etapa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
