import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { PipelineStage, LeadStatus } from "@/types";

interface StageModalProps {
  isOpen: boolean;
  onClose: () => void;
  stage?: PipelineStage;
}

const colorPalette = [
  { name: "Azul", value: "#3b82f6" },
  { name: "Amarelo", value: "#f59e0b" },
  { name: "Verde", value: "#10b981" },
  { name: "Vermelho", value: "#ef4444" },
  { name: "Roxo", value: "#8b5cf6" },
  { name: "Rosa", value: "#d946ef" },
  { name: "Laranja", value: "#f97316" },
  { name: "Ciano", value: "#06b6d4" },
  { name: "Cinza", value: "#64748b" },
];

export function StageModal({ isOpen, onClose, stage }: StageModalProps) {
  const { createStage, updateStage } = usePipelineStages();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    color: colorPalette[0].value,
    category: "Aberto" as LeadStatus,
  });

  const isEditing = !!stage;

  useEffect(() => {
    if (isOpen) {
      if (isEditing && stage) {
        setFormData({
          name: stage.name,
          color: stage.color,
          category: stage.category,
        });
      } else {
        setFormData({
          name: "",
          color: colorPalette[0].value,
          category: "Aberto" as LeadStatus,
        });
      }
    }
  }, [isOpen, isEditing, stage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setLoading(true);
    try {
      if (isEditing && stage) {
        await updateStage(stage.id, {
          name: formData.name,
          color: formData.color,
          category: formData.category,
        });
      } else {
        await createStage({
          name: formData.name,
          color: formData.color,
          category: formData.category,
        });
      }
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar Etapa" : "Nova Etapa"}</DialogTitle>
          <DialogDescription>
            Defina apenas nome, status e cor da etapa.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Nome da Etapa</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ex: Em Negociacao"
              required
            />
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
            <div className="grid grid-cols-5 gap-2 pb-2">
              {colorPalette.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, color: c.value })}
                  className={`w-10 h-10 rounded-full transition-all flex items-center justify-center ${
                    formData.color === c.value ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-110" : "hover:scale-105"
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>

            <div className="flex items-center gap-2 mt-2">
              <span className="text-sm text-muted-foreground">Ou cor customizada:</span>
              <input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-12 h-10 p-1 cursor-pointer border rounded-md"
              />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || !formData.name.trim()}>
              {loading ? "Salvando..." : "Salvar Etapa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
