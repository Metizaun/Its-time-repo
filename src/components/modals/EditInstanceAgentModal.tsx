import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import {
  PROMPT_GUIDANCE_SECTIONS,
  PROMPT_QUALITY_CHECKLIST,
  buildManagedAgentPrompt,
  parseManagedAgentPrompt,
} from "@/lib/aiPrompt";
import { listAgents, updateAgentPrompt, type AgentSummary } from "@/services/agentService";
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
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

interface EditInstanceAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceName: string | null;
}

export function EditInstanceAgentModal({
  open,
  onOpenChange,
  instanceName,
}: EditInstanceAgentModalProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [tone, setTone] = useState("");
  const [promptBody, setPromptBody] = useState("");

  const canSave = useMemo(() => {
    return Boolean(agent && promptBody.trim() && !saving);
  }, [agent, promptBody, saving]);

  useEffect(() => {
    if (!open || !instanceName) {
      return;
    }

    let active = true;

    const loadAgent = async () => {
      try {
        if (!session?.access_token) {
          throw new Error("Sessão expirada. Faça login novamente.");
        }

        setLoading(true);
        setError(null);
        setAgent(null);

        const result = await listAgents({
          accessToken: session.access_token,
        });

        if (!active) return;

        const matchedAgent = result.agents.find((item) => item.instanceName === instanceName) || null;
        setAgent(matchedAgent);

        if (matchedAgent) {
          const parsed = parseManagedAgentPrompt(matchedAgent.systemPrompt);
          setTone(parsed.tone);
          setPromptBody(parsed.promptBody);
        } else {
          setTone("");
          setPromptBody("");
        }
      } catch (loadError: any) {
        if (!active) return;
        setError(loadError.message || "Não foi possível carregar o agente da instância.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadAgent().catch(() => {
      // erro tratado localmente
    });

    return () => {
      active = false;
    };
  }, [instanceName, open, session?.access_token]);

  const handleSave = async () => {
    if (!agent) {
      return;
    }

    if (!promptBody.trim()) {
      toast.error("Escreva o prompt principal do agente");
      return;
    }

    try {
      if (!session?.access_token) {
        throw new Error("Sessão expirada. Faça login novamente.");
      }

      setSaving(true);

      const systemPrompt = buildManagedAgentPrompt({
        tone,
        promptBody,
      });

      const result = await updateAgentPrompt({
        accessToken: session.access_token,
        agentId: agent.id,
        systemPrompt,
      });

      setAgent(result.agent);
      toast.success("Configuração da IA atualizada");
      onOpenChange(false);
    } catch (saveError: any) {
      toast.error("Erro ao salvar configuração da IA", {
        description: saveError.message,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5" />
            Configurar IA da instância
          </DialogTitle>
          <DialogDescription>
            {instanceName
              ? `Ajuste o tom e o prompt operacional da instância ${instanceName}.`
              : "Selecione uma instância para configurar a IA."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="px-6 pb-6">
            {loading ? (
              <div className="space-y-4 pt-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-72 w-full" />
              </div>
            ) : (
              <div className="space-y-4 pt-2">
                {error && (
                  <Alert variant="destructive">
                    <AlertTitle>Falha ao carregar o agente</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {!error && !agent && (
                  <Alert>
                    <Sparkles className="h-4 w-4" />
                    <AlertTitle>Nenhum agente vinculado a esta instância</AlertTitle>
                    <AlertDescription>
                      Nesta etapa o modal só edita agentes já existentes. Se ainda não houver agente para esta
                      instância, primeiro faça o vínculo no backend de IA.
                    </AlertDescription>
                  </Alert>
                )}

                {agent && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={agent.isActive ? "default" : "outline"}>
                        {agent.isActive ? "Agente ativo" : "Agente inativo"}
                      </Badge>
                      <Badge variant="outline">{agent.model || "Modelo não definido"}</Badge>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="agent-tone">Tom da marca</Label>
                      <Textarea
                        id="agent-tone"
                        rows={4}
                        value={tone}
                        onChange={(event) => setTone(event.target.value)}
                        placeholder="Ex: confiante, acolhedor, direto e consultivo."
                      />
                      <p className="text-xs text-muted-foreground">
                        O tom é gerenciado pela plataforma e será anexado ao `system_prompt` salvo no agente.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="agent-prompt">Prompt operacional</Label>
                      <Textarea
                        id="agent-prompt"
                        rows={18}
                        value={promptBody}
                        onChange={(event) => setPromptBody(event.target.value)}
                        placeholder="Descreva regras, fluxos, objeções, contexto do negócio e comportamento esperado da IA."
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="border-t px-6 pb-6 pt-6 lg:border-l lg:border-t-0 bg-muted/20">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold">Guia de qualidade</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Referência derivada de `Project/IA/Prompt.md` para manter consistência de prompt.
                </p>
              </div>

              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Checklist antes de salvar</AlertTitle>
                <AlertDescription>
                  <ul className="space-y-2">
                    {PROMPT_QUALITY_CHECKLIST.map((item) => (
                      <li key={item} className="leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>

              <Separator />

              <div className="space-y-3">
                {PROMPT_GUIDANCE_SECTIONS.map((section) => (
                  <div key={section.title} className="rounded-lg border bg-background/70 p-4">
                    <p className="font-medium text-sm">{section.title}</p>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      {section.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Salvar IA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
