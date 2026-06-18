import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CreateProjectFromScrapeDialogProps = {
  open: boolean;
  saving: boolean;
  hasScrapeContext: boolean;
  competitorUsername: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (projectName: string) => Promise<void>;
};

export function CreateProjectFromScrapeDialog({
  open,
  saving,
  hasScrapeContext,
  competitorUsername,
  onOpenChange,
  onSubmit,
}: CreateProjectFromScrapeDialogProps) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open) {
      setName("");
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!name.trim() || !hasScrapeContext) {
      return;
    }

    await onSubmit(name.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Novo projeto
          </DialogTitle>
          <DialogDescription>
            O concorrente será definido automaticamente com base no último scrape desta sessão.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="project-name-input">Nome</Label>
            <Input
              id="project-name-input"
              autoFocus
              placeholder="Ex.: Benchmark Reels Março"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={saving}
            />
          </div>

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Concorrente do scrape:{" "}
            <span className="font-medium text-foreground">
              {competitorUsername ? `@${competitorUsername}` : "não identificado"}
            </span>
          </div>

          {!hasScrapeContext ? (
            <p className="text-xs text-destructive">
              Faça um scrape com resultados antes de criar um projeto.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={saving || !hasScrapeContext || !name.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Criar e salvar seleção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

