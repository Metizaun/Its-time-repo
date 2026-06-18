import { useMemo } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { CreateDraftContent, CreateMessageType } from "@/components/Create/types";

interface CreateCanvasProps {
  messageType: CreateMessageType;
  draft: CreateDraftContent;
  onDraftChange: (nextDraft: CreateDraftContent) => void;
  onSaveTemplate: () => void;
}

export function CreateCanvas({ messageType, draft, onDraftChange, onSaveTemplate }: CreateCanvasProps) {
  const { toast } = useToast();

  const canvasLabel = useMemo(() => {
    if (messageType === "email") return "Editor de e-mail";
    if (messageType === "whatsapp") return "Editor de WhatsApp";
    return "Editor de redes sociais";
  }, [messageType]);

  const handleCopy = async () => {
    const payload =
      messageType === "email"
        ? `Assunto: ${draft.subject || "(sem assunto)"}\n\n${draft.body || ""}`
        : draft.body || "";

    if (!payload.trim()) {
      toast({
        title: "Nada para copiar",
        description: "Preencha o conteudo antes de copiar.",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(payload);
      toast({
        title: "Conteudo copiado",
        description: "O texto foi enviado para a area de transferencia.",
      });
    } catch {
      toast({
        title: "Falha ao copiar",
        description: "Nao foi possivel copiar o conteudo automaticamente.",
        variant: "destructive",
      });
    }
  };

  return (
    <section className="flex min-h-0 flex-col rounded-lg border bg-muted/30 p-4 shadow-sm lg:p-6">
      <Card className="mx-auto flex w-full max-w-4xl flex-1 flex-col border bg-card">
        <CardHeader className="flex flex-row items-center justify-between border-b py-4">
          <div>
            <CardTitle className="text-base">{canvasLabel}</CardTitle>
            <p className="text-xs text-muted-foreground">Conteudo livre e 100% editavel no canvas.</p>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={handleCopy} aria-label="Copiar conteudo">
            <Copy className="h-4 w-4" />
          </Button>
        </CardHeader>

        <CardContent className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          {messageType === "email" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="canvas-email-subject">Titulo do e-mail</Label>
                <Input
                  id="canvas-email-subject"
                  value={draft.subject}
                  onChange={(event) => onDraftChange({ ...draft, subject: event.target.value })}
                  placeholder="Digite o assunto do e-mail"
                />
              </div>

              <div className="flex flex-1 flex-col space-y-2">
                <Label htmlFor="canvas-email-body">Corpo do e-mail</Label>
                <Textarea
                  id="canvas-email-body"
                  value={draft.body}
                  onChange={(event) => onDraftChange({ ...draft, body: event.target.value })}
                  placeholder="Escreva o corpo da mensagem..."
                  className="min-h-[340px] flex-1"
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col space-y-2">
              <Label htmlFor="canvas-message-body">Mensagem</Label>
              <Textarea
                id="canvas-message-body"
                value={draft.body}
                onChange={(event) => onDraftChange({ ...draft, body: event.target.value })}
                placeholder="Escreva o texto principal da mensagem..."
                className="min-h-[420px] flex-1"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex justify-end">
        <Button type="button" variant="outline" onClick={onSaveTemplate} className="gap-2">
          <Check className="h-4 w-4" />
          Salvar template
        </Button>
      </div>
    </section>
  );
}

