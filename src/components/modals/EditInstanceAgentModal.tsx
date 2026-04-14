import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import {
  PROMPT_GUIDANCE_INTRO,
  PROMPT_GUIDANCE_SECTIONS,
  buildManagedAgentPrompt,
  parseManagedAgentPrompt,
} from "@/lib/aiPrompt";
import { createAgent, listAgents, updateAgentPrompt, type AgentSummary } from "@/services/agentService";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

interface EditInstanceAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceName: string | null;
  instanceOptions: string[];
}

export function EditInstanceAgentModal({
  open,
  onOpenChange,
  instanceName,
  instanceOptions,
}: EditInstanceAgentModalProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [targetInstanceName, setTargetInstanceName] = useState<string | null>(instanceName);
  const [agentName, setAgentName] = useState("");
  const [tone, setTone] = useState("");
  const [promptBody, setPromptBody] = useState("");

  useEffect(() => {
    if (open) {
      return;
    }

    setLoading(false);
    setCreatingAgent(false);
    setSavingPrompt(false);
    setError(null);
    setAgent(null);
    setTargetInstanceName(instanceName);
    setAgentName("");
    setTone("");
    setPromptBody("");
  }, [instanceName, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (instanceName && instanceOptions.includes(instanceName)) {
      setTargetInstanceName(instanceName);
      return;
    }

    setTargetInstanceName((current) => {
      if (current && instanceOptions.includes(current)) {
        return current;
      }

      return instanceOptions[0] ?? null;
    });
  }, [instanceName, instanceOptions, open]);

  useEffect(() => {
    if (!open || !targetInstanceName) {
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

        const matchedAgent =
          result.agents.find((item) => item.instanceName === targetInstanceName) || null;

        setAgent(matchedAgent);

        if (matchedAgent) {
          const parsed = parseManagedAgentPrompt(matchedAgent.systemPrompt);
          setAgentName(matchedAgent.name || `Agente ${targetInstanceName}`);
          setTone(parsed.tone);
          setPromptBody(parsed.promptBody);
        } else {
          setAgentName(`Agente ${targetInstanceName}`);
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
  }, [open, session?.access_token, targetInstanceName]);

  const canCreateAgent = useMemo(() => {
    return Boolean(targetInstanceName && agentName.trim() && !creatingAgent && !loading && !agent);
  }, [agent, agentName, creatingAgent, loading, targetInstanceName]);

  const canSavePrompt = useMemo(() => {
    return Boolean(agent && promptBody.trim() && !savingPrompt);
  }, [agent, promptBody, savingPrompt]);

  const handleCreateAgent = async () => {
    if (!targetInstanceName) {
      toast.error("Selecione uma instância");
      return;
    }

    if (!agentName.trim()) {
      toast.error("Defina o nome do agente");
      return;
    }

    try {
      if (!session?.access_token) {
        throw new Error("Sessão expirada. Faça login novamente.");
      }

      setCreatingAgent(true);
      setError(null);

      const result = await createAgent({
        accessToken: session.access_token,
        name: agentName.trim(),
        instanceName: targetInstanceName,
      });

      setAgent(result.agent);
      setAgentName(result.agent.name || agentName.trim());
      setPromptBody("");
      toast.success("Agente criado e vinculado à instância");
    } catch (createError: any) {
      toast.error("Erro ao criar agente", {
        description: createError.message,
      });
    } finally {
      setCreatingAgent(false);
    }
  };

  const handleSavePrompt = async () => {
    if (!agent) {
      return;
    }

    if (!promptBody.trim()) {
      toast.error("Preencha o prompt do agente");
      return;
    }

    try {
      if (!session?.access_token) {
        throw new Error("Sessão expirada. Faça login novamente.");
      }

      setSavingPrompt(true);

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
      setSavingPrompt(false);
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
            Crie o agente vinculado à instância e, em seguida, configure o prompt operacional.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="px-6 pb-6">
            {loading ? (
              <div className="space-y-4 pt-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-80 w-full" />
              </div>
            ) : (
              <div className="space-y-6 pt-2">
                {error && (
                  <Alert variant="destructive">
                    <AlertTitle>Falha ao carregar o agente</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="rounded-xl border p-4 space-y-4">
                  <div className="space-y-1">
                    <h3 className="font-semibold">1. Criar agente</h3>
                    <p className="text-sm text-muted-foreground">
                      Todo agente nasce vinculado a uma instância. Sem esse vínculo, a configuração não é liberada.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="agent-instance">Instância</Label>
                    {instanceOptions.length > 0 ? (
                      <Select
                        value={targetInstanceName ?? undefined}
                        onValueChange={(value) => setTargetInstanceName(value)}
                      >
                        <SelectTrigger id="agent-instance">
                          <SelectValue placeholder="Selecione uma instância" />
                        </SelectTrigger>
                        <SelectContent>
                          {instanceOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Alert>
                        <Sparkles className="h-4 w-4" />
                        <AlertTitle>Nenhuma instância disponível</AlertTitle>
                        <AlertDescription>
                          Cadastre uma instância antes de configurar o agente de IA.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="agent-name">Nome do agente</Label>
                    <Input
                      id="agent-name"
                      value={agentName}
                      onChange={(event) => setAgentName(event.target.value)}
                      placeholder="Ex: Clara, Bento, Consultor Prime"
                      disabled={Boolean(agent)}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {agent ? (
                      <>
                        <Badge variant={agent.isActive ? "default" : "outline"}>
                          {agent.isActive ? "Agente ativo" : "Agente inativo"}
                        </Badge>
                        <Badge variant="outline">{agent.name || "Agente criado"}</Badge>
                        <Badge variant="outline">{agent.instanceName}</Badge>
                      </>
                    ) : targetInstanceName ? (
                      <Badge variant="secondary">Instância pronta para vincular</Badge>
                    ) : null}
                  </div>

                  {!error && !agent && targetInstanceName && (
                    <Alert>
                      <Sparkles className="h-4 w-4" />
                      <AlertTitle>Nenhum agente vinculado a esta instância</AlertTitle>
                      <AlertDescription>
                        Crie o agente primeiro. Assim que ele for criado, a configuração do prompt será liberada abaixo.
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button onClick={handleCreateAgent} disabled={!canCreateAgent}>
                    {creatingAgent ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    {agent ? "Agente já criado" : "Criar agente"}
                  </Button>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="space-y-1">
                    <h3 className="font-semibold">2. Configurar prompt</h3>
                    <p className="text-sm text-muted-foreground">
                      Use a estrutura do `Prompt.md` para montar o comportamento completo do agente.
                    </p>
                  </div>

                  {!agent ? (
                    <Alert>
                      <Sparkles className="h-4 w-4" />
                      <AlertTitle>Criação obrigatória antes da configuração</AlertTitle>
                      <AlertDescription>
                        Depois de criar o agente e vincular a instância, o campo de prompt fica disponível nesta área.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="agent-prompt">Prompt operacional</Label>
                      <Textarea
                        id="agent-prompt"
                        rows={22}
                        value={promptBody}
                        onChange={(event) => setPromptBody(event.target.value)}
                        placeholder="Estruture aqui o prompt completo do agente com base no template de Project/IA/Prompt.md."
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border-t px-6 pb-6 pt-6 lg:border-l lg:border-t-0 bg-muted/20">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold">Etapas do prompt</h3>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  {PROMPT_GUIDANCE_INTRO}
                </p>
              </div>

              <div className="space-y-3">
                {PROMPT_GUIDANCE_SECTIONS.map((section) => (
                  <div key={section.title} className="rounded-lg border bg-background/70 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-sm">{section.title}</p>
                      <Badge variant={section.required ? "default" : "outline"}>
                        {section.required ? "Obrigatório" : "Opcional"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
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
          <Button onClick={handleSavePrompt} disabled={!canSavePrompt}>
            {savingPrompt ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Salvar configuração
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
