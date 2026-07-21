import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";

interface PipelineModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; description: string }) => Promise<boolean>;
}

export function PipelineModal({ open, onOpenChange, onCreate }: PipelineModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
    }
  }, [open]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const created = await onCreate({ name: name.trim(), description: description.trim() });
      if (created) onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pipeline-dialog sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Novo pipeline</DialogTitle>
          <DialogDescription>
            A classificacao automatica e a etapa Em atendimento ja serao criadas ativas.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="pipeline-name">Nome</Label>
            <Input
              id="pipeline-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex: Vendas consultivas"
              autoFocus
              maxLength={120}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pipeline-description">Descricao</Label>
            <Textarea
              id="pipeline-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Contexto curto para a equipe"
              className="min-h-24 resize-none"
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? "Criando..." : "Criar pipeline"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
