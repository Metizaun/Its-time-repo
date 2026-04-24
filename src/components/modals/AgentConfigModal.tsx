import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X, GripVertical, Maximize2, Minimize2, ChevronRight, Loader2 } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useAgents } from "@/hooks/useAgents";
import { useInstances } from "@/hooks/useInstances";
import { PROMPT_GUIDANCE_SECTIONS } from "@/lib/aiPrompt";
import { cn } from "@/lib/utils";
import { testAgentHandoff } from "@/services/agentService";
import { AIAgent } from "@/types";
import { Switch } from "@/components/ui/switch";

import { toast } from "sonner";

const PERSONALITY_LEVELS = [
  {
    label: "Cirurgico",
    description: "Seco, direto e objetivo. Respostas curtas sem rodeios.",
    temperature: 0.1,
    promptSuffix:
      "Mantenha um estilo de comunicacao seco, objetivo e extremamente direto. Sem saudacoes excessivas, sem elogios e sem rodeios. Foco total na informacao.",
  },
  {
    label: "Consultivo",
    description: "Profissional e embasado. Transmite confianca e expertise.",
    temperature: 0.25,
    promptSuffix:
      "Mantenha postura consultiva e profissional. Seja claro e embasado, transmitindo confianca e expertise sem excesso de informalidade.",
  },
  {
    label: "Equilibrado",
    description: "Tom neutro. Amigavel sem exageros.",
    temperature: 0.4,
    promptSuffix:
      "Use tom equilibrado e amigavel. Seja cordial e acessivel, mas sem excesso de entusiasmo ou informalidade.",
  },
  {
    label: "Dinamico",
    description: "Energetico e persuasivo. Cria rapport com facilidade.",
    temperature: 0.6,
    promptSuffix:
      "Seja energetico, descontraido e persuasivo. Crie rapport de forma espontanea, use uma linguagem mais proxima e envolvente para engajar o lead.",
  },
  {
    label: "Entusiasta",
    description: "Alta energia e impacto emocional. Ideal para vendas ativas.",
    temperature: 0.75,
    promptSuffix:
      "Seja altamente entusiasta e empatico. Use linguagem animada, valorize o lead, crie alto impacto emocional e urgencia positiva para conduzir a conversao.",
  },
] as const;

const DEFAULT_MODEL = "gemini-2.5-flash";
const PERSONALITY_SECTION_TITLE = "## Estilo de Comunicacao";
const PERSONALITY_SECTION_PATTERN = /\n*## Estilo de Comunica(?:cao|\u00e7\u00e3o)\n[\s\S]*$/u;

function stripPersonalityInstructions(prompt: string) {
  return prompt.trim().replace(PERSONALITY_SECTION_PATTERN, "").trimEnd();
}

interface AgentConfigModalProps {
  open: boolean;
  agent: AIAgent | null;
  onClose: () => void;
}

export function AgentConfigModal({ open, agent, onClose }: AgentConfigModalProps) {
  const { session } = useAuth();
  const { agents, upsertAgent, saving } = useAgents();
  const { instances } = useInstances();

  const [name, setName] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [personalityLevel, setPersonalityLevel] = useState(2);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model] = useState(DEFAULT_MODEL);
  const [handoffEnabled, setHandoffEnabled] = useState(false);
  const [handoffPrompt, setHandoffPrompt] = useState("");
  const [handoffTargetPhone, setHandoffTargetPhone] = useState("");
  const [handoffEditorOpen, setHandoffEditorOpen] = useState(false);
  const [testingHandoff, setTestingHandoff] = useState(false);

  const [studioExpanded, setStudioExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragBlockRef = useRef<string | null>(null);

  const availableInstances = useMemo(() => {
    const blockedInstances = new Set(
      agents
        .filter((existingAgent) => existingAgent.id !== agent?.id)
        .map((existingAgent) => existingAgent.instance_name)
    );

    return instances.filter(
      (instance) =>
        instance.instancia === agent?.instance_name || !blockedInstances.has(instance.instancia)
    );
  }, [agent?.id, agent?.instance_name, agents, instances]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (agent) {
      setName(agent.name);
      setInstanceName(agent.instance_name);
      setSystemPrompt(stripPersonalityInstructions(agent.system_prompt));
      setHandoffEnabled(Boolean(agent.handoff_enabled));
      setHandoffPrompt(agent.handoff_prompt ?? "");
      setHandoffTargetPhone(agent.handoff_target_phone ?? "");
      setHandoffEditorOpen(Boolean(agent.handoff_enabled));

      const idx = PERSONALITY_LEVELS.reduce((best, level, index) => {
        return Math.abs(level.temperature - agent.temperature) <
          Math.abs(PERSONALITY_LEVELS[best].temperature - agent.temperature)
          ? index
          : best;
      }, 2);
      setPersonalityLevel(idx);
    } else {
      setName("");
      setInstanceName("");
      setSystemPrompt("");
      setPersonalityLevel(2);
      setHandoffEnabled(false);
      setHandoffPrompt("");
      setHandoffTargetPhone("");
      setHandoffEditorOpen(false);
    }

    setStudioExpanded(false);
  }, [open, agent]);

  useEffect(() => {
    if (!open || agent) {
      return;
    }

    setInstanceName((current) => {
      if (availableInstances.some((instance) => instance.instancia === current)) {
        return current;
      }

      return availableInstances[0]?.instancia ?? "";
    });
  }, [agent, availableInstances, open]);

  const handleDragStart = useCallback((content: string) => {
    dragBlockRef.current = content;
  }, []);

  const handleDropOnTextarea = useCallback(
    (event: React.DragEvent<HTMLTextAreaElement>) => {
      event.preventDefault();
      const content = dragBlockRef.current;
      if (!content || !textareaRef.current) {
        return;
      }

      const textarea = textareaRef.current;
      const start = textarea.selectionStart ?? systemPrompt.length;
      const before = systemPrompt.slice(0, start);
      const after = systemPrompt.slice(start);
      const separator = before.length > 0 && !before.endsWith("\n\n") ? "\n\n" : "";
      const nextPrompt = `${before}${separator}${content}\n\n${after}`;

      setSystemPrompt(nextPrompt);
      dragBlockRef.current = null;

      requestAnimationFrame(() => {
        const position = (before + separator + content + "\n\n").length;
        textarea.setSelectionRange(position, position);
        textarea.focus();
      });
    },
    [systemPrompt]
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!name.trim() || !instanceName || !systemPrompt.trim()) {
      return;
    }

    if (handoffEnabled && !handoffPrompt.trim()) {
      setHandoffEditorOpen(true);
      toast.error("Defina quando a IA deve fazer o handoff.");
      return;
    }

    if (handoffEnabled && !handoffTargetPhone.trim()) {
      setHandoffEditorOpen(true);
      toast.error("Informe o numero que vai receber o handoff.");
      return;
    }

    const personality = PERSONALITY_LEVELS[personalityLevel];
    const basePrompt = stripPersonalityInstructions(systemPrompt);
    const finalPrompt = `${basePrompt}\n\n${PERSONALITY_SECTION_TITLE}\n${personality.promptSuffix}`;

    await upsertAgent(
      {
        name: name.trim(),
        instance_name: instanceName,
        system_prompt: finalPrompt,
        model,
        is_active: true,
        temperature: personality.temperature,
        buffer_wait_ms: 15000,
        human_pause_minutes: 60,
        handoff_enabled: handoffEnabled,
        handoff_prompt: handoffPrompt.trim() || null,
        handoff_target_phone: handoffTargetPhone.trim() || null,
      },
      agent?.id
    );

    onClose();
  }

  async function handleTestHandoff() {
    if (!instanceName) {
      toast.error("Selecione a instancia antes de testar.");
      return;
    }

    if (!handoffTargetPhone.trim()) {
      toast.error("Informe o numero de destino do handoff.");
      return;
    }

    if (!session?.access_token) {
      toast.error("Sessao expirada. Entre novamente para testar.");
      return;
    }

    try {
      setTestingHandoff(true);
      const result = await testAgentHandoff({
        accessToken: session.access_token,
        instanceName,
        targetPhone: handoffTargetPhone.trim(),
        agentName: name.trim() || agent?.name || "Agente IA",
        handoffPrompt: handoffPrompt.trim() || undefined,
      });

      toast.success("Teste de handoff enviado.", {
        description: `Destino validado: ${result.normalizedNumber}`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Nao foi possivel validar o envio.";
      toast.error("Falha ao testar handoff.", {
        description: message,
      });
    } finally {
      setTestingHandoff(false);
    }
  }

  if (!open) {
    return null;
  }

  const currentPersonality = PERSONALITY_LEVELS[personalityLevel];
  const handoffReady = Boolean(handoffPrompt.trim() && handoffTargetPhone.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className={cn(
          "relative flex flex-col rounded-[24px] border border-[var(--color-border-subtle)] border-t-2 border-t-[var(--color-accent)] bg-[var(--color-bg-elevated)] shadow-[0_24px_64px_rgba(0,0,0,0.3)] transition-all duration-300",
          studioExpanded ? "h-[90vh] w-[95vw] max-w-none" : "max-h-[90vh] w-full max-w-xl"
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-foreground">
              {agent ? "Editar Agente" : "Novo Agente"}
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
              {agent ? `Editando: ${agent.name}` : "Configure seu novo Agente de IA"}
            </p>
          </div>

          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border-medium)] transition-colors hover:bg-[var(--color-border-subtle)]"
          >
            <X className="h-4 w-4 text-[var(--color-text-secondary)]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 overflow-hidden">
            <div
              className={cn(
                "flex flex-col gap-5 overflow-y-auto p-6",
                studioExpanded ? "w-3/4 border-r border-[var(--color-border-subtle)]" : "w-full"
              )}
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                  Nome do Agente
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex: Agente Vendas WhatsApp"
                  required
                  className="w-full rounded-xl border border-[var(--color-border-medium)] bg-transparent px-4 py-2.5 text-sm text-foreground placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent)]/60 focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                  Instancia Vinculada
                </label>
                <select
                  value={instanceName}
                  onChange={(event) => setInstanceName(event.target.value)}
                  required
                  disabled={!agent && availableInstances.length === 0}
                  className="w-full rounded-xl border border-[var(--color-border-medium)] bg-[var(--color-bg-surface)] px-4 py-2.5 text-sm text-foreground transition-colors focus:border-[var(--color-accent)]/60 focus:outline-none"
                >
                  <option value="" disabled>
                    Selecione uma instancia
                  </option>
                  {availableInstances.map((instance) => (
                    <option key={instance.instancia} value={instance.instancia}>
                      {instance.instancia}
                    </option>
                  ))}
                </select>
                {!agent && availableInstances.length === 0 ? (
                  <p className="text-[11px] text-[var(--color-text-secondary)]">
                    Todas as instancias disponiveis desta conta ja possuem um agente vinculado.
                    Abra um agente existente para editar a configuracao.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                    Estilo de Abordagem
                  </label>
                  <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                    Define como o agente interage e afeta diretamente o comportamento das respostas.
                  </p>
                </div>

                <div className="flex justify-between px-0.5">
                  {PERSONALITY_LEVELS.map((level, index) => (
                    <button
                      key={level.label}
                      type="button"
                      onClick={() => setPersonalityLevel(index)}
                      className={cn(
                        "text-[10px] font-semibold transition-colors duration-150",
                        personalityLevel === index
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                      )}
                    >
                      {level.label}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={1}
                    value={personalityLevel}
                    onChange={(event) => setPersonalityLevel(Number(event.target.value))}
                    className="h-1 w-full cursor-pointer rounded-full bg-[var(--color-border-medium)] accent-[var(--color-accent)]"
                  />
                </div>

                <div className="rounded-xl border border-[var(--color-border-subtle)] border-t-2 border-t-[var(--color-accent)] bg-transparent px-4 py-3 shadow-[0_4px_16px_rgba(229,57,58,0.04)]">
                  <p className="text-xs font-semibold text-foreground">{currentPersonality.label}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
                    {currentPersonality.description}
                  </p>
                  <p className="mt-1.5 text-[10px] text-[var(--color-text-muted)]">
                    Temperatura: {currentPersonality.temperature}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/60 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                      Handoff Humano
                    </label>
                    <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                      Liga um disparo interno no WhatsApp quando a IA identificar a condicao
                      definida por voce.
                    </p>
                    <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">
                      {handoffEnabled
                        ? handoffReady
                          ? `Ativo para enviar ao numero ${handoffTargetPhone}`
                          : "Handoff ligado, mas ainda falta definir o prompt ou o numero."
                        : handoffReady
                          ? "Configurado, mas desligado no toggle."
                          : "Desativado."}
                    </p>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-3">
                    <Switch
                      checked={handoffEnabled}
                      onCheckedChange={(checked) => {
                        setHandoffEnabled(checked);
                        if (checked) {
                          setHandoffEditorOpen(true);
                        }
                      }}
                      aria-label="Ativar handoff humano"
                    />
                    <button
                      type="button"
                      onClick={() => setHandoffEditorOpen((current) => !current)}
                      className="rounded-xl border border-[var(--color-border-medium)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-border-subtle)] hover:text-foreground"
                    >
                      {handoffEditorOpen ? "Fechar" : "Editar"}
                    </button>
                  </div>
                </div>

                {handoffEditorOpen ? (
                  <div className="grid gap-3 border-t border-[var(--color-border-subtle)] pt-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                        Quando a IA Deve Fazer o Handoff
                      </label>
                      <textarea
                        value={handoffPrompt}
                        onChange={(event) => setHandoffPrompt(event.target.value)}
                        placeholder="Ex: Acione o handoff quando o lead pedir atendimento humano, reclamar, pedir desconto fora da politica ou demonstrar urgencia alta."
                        className="min-h-[110px] w-full resize-y rounded-xl border border-[var(--color-border-medium)] bg-transparent px-4 py-3 text-sm text-foreground placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent)]/60 focus:outline-none"
                      />
                      <p className="text-[10px] text-[var(--color-text-muted)]">
                        Escreva em linguagem natural as situacoes que exigem transferencia para uma pessoa.
                      </p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                        Numero para Receber o Handoff
                      </label>
                      <input
                        type="text"
                        value={handoffTargetPhone}
                        onChange={(event) => setHandoffTargetPhone(event.target.value)}
                        placeholder="Ex: 5511999999999"
                        className="w-full rounded-xl border border-[var(--color-border-medium)] bg-transparent px-4 py-2.5 text-sm text-foreground placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent)]/60 focus:outline-none"
                      />
                      <p className="text-[10px] text-[var(--color-text-muted)]">
                        Esse numero recebe o alerta interno disparado pela Evolution.
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)]/60 px-4 py-3">
                      <div>
                        <p className="text-xs font-semibold text-foreground">Teste de envio</p>
                        <p className="text-[11px] text-[var(--color-text-secondary)]">
                          Valida a instancia, o numero informado e o disparo real do handoff.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={handleTestHandoff}
                        disabled={testingHandoff || !instanceName || !handoffTargetPhone.trim()}
                        className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border-medium)] px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-[var(--color-border-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {testingHandoff ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {testingHandoff ? "Testando..." : "Testar envio"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                    Instrucoes do Agente
                  </label>
                  <button
                    type="button"
                    onClick={() => setStudioExpanded((current) => !current)}
                    className="flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)] transition-colors hover:text-foreground"
                  >
                    {studioExpanded ? (
                      <>
                        <Minimize2 className="h-3 w-3" />
                        Recolher
                      </>
                    ) : (
                      <>
                        <Maximize2 className="h-3 w-3" />
                        Expandir Studio
                      </>
                    )}
                  </button>
                </div>

                <textarea
                  ref={textareaRef}
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  onDrop={handleDropOnTextarea}
                  onDragOver={handleDragOver}
                  placeholder="Descreva como o agente deve se comportar, quais sao suas regras, script de abertura, etc."
                  required
                  className={cn(
                    "w-full resize-none rounded-xl border border-[var(--color-border-medium)] bg-transparent px-4 py-3 text-sm leading-relaxed text-foreground placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent)]/60 focus:outline-none",
                    studioExpanded ? "h-full flex-1" : "h-48"
                  )}
                />
              </div>
            </div>

            {studioExpanded ? (
              <div className="flex w-1/4 flex-col overflow-hidden bg-[var(--color-bg-surface)]">
                <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                    Blocos de Instrucao
                  </p>
                  <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                    Arraste para o editor
                  </p>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  {PROMPT_GUIDANCE_SECTIONS.map((section) => (
                    <div
                      key={section.title}
                      draggable
                      onDragStart={() =>
                        handleDragStart(
                          `## ${section.title}\n${section.description}\n\n[Preencha aqui suas instrucoes especificas para esta secao]`
                        )
                      }
                      className={cn(
                        "flex cursor-grab items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] border-t-2 bg-transparent px-3 py-2.5 shadow-[0_4px_12px_rgba(229,57,58,0.03)] transition-all duration-150 hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-border-subtle)] active:cursor-grabbing",
                        section.required
                          ? "border-t-[var(--color-accent)]/60"
                          : "border-t-[var(--color-border-medium)]"
                      )}
                    >
                      <GripVertical className="h-4 w-4 flex-shrink-0 text-[var(--color-text-muted)]" />
                      <span className="select-none text-xs font-medium leading-tight text-[var(--color-text-secondary)]">
                        {section.title}
                      </span>
                      {section.required ? (
                        <ChevronRight className="ml-auto h-3 w-3 flex-shrink-0 text-[var(--color-accent)]/40" />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[var(--color-border-subtle)] px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-border-subtle)] hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-[var(--color-accent)] px-5 py-2 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(229,57,58,0.3)] transition-all hover:brightness-110 disabled:opacity-50"
            >
              {saving ? "Salvando..." : agent ? "Salvar Alteracoes" : "Criar Agente"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
