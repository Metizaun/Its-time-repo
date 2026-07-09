import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X, GripVertical, Maximize2, Minimize2, ChevronRight } from "lucide-react";

import { useAgents } from "@/hooks/useAgents";
import { useInstances } from "@/hooks/useInstances";
import { PROMPT_GUIDANCE_SECTIONS } from "@/lib/aiPrompt";
import { cn } from "@/lib/utils";
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
  templateKey?: string | null;
  templateName?: string | null;
  onClose: () => void;
}

export function AgentConfigModal({
  open,
  agent,
  templateKey = null,
  templateName = null,
  onClose,
}: AgentConfigModalProps) {
  const { agents, upsertAgent, saving } = useAgents();
  const { instances } = useInstances();

  const [name, setName] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [personalityLevel, setPersonalityLevel] = useState(2);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model] = useState(DEFAULT_MODEL);
  const [handoffEnabled, setHandoffEnabled] = useState(false);
  const [handoffPrompt, setHandoffPrompt] = useState("");
  const [handoffConfigOpen, setHandoffConfigOpen] = useState(false);
  const [rbTokenApi, setRbTokenApi] = useState("");

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
      setHandoffConfigOpen(false);
      setRbTokenApi("");

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
      setHandoffConfigOpen(false);
      setRbTokenApi("");
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

    if (!agent && templateKey === "cobranca_rb" && !rbTokenApi.trim()) {
      toast.error("Informe o Token API do Registro Base para criar o agente de cobranca.");
      return;
    }

    if (handoffEnabled && !handoffPrompt.trim()) {
      setHandoffConfigOpen(true);
      toast.error("Defina quando a IA deve fazer o handoff.");
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
        templateKey: agent ? null : templateKey,
        rb_token_api: agent ? null : rbTokenApi.trim() || null,
      },
      agent?.id
    );

    onClose();
  }

  if (!open) {
    return null;
  }

  const currentPersonality = PERSONALITY_LEVELS[personalityLevel];
  const handoffReady = Boolean(handoffPrompt.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[rgba(26,24,20,0.45)] backdrop-blur-sm" onClick={onClose} />

      <div
        className={cn(
          "relative flex max-h-[90vh] flex-col rounded-[24px] border border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-modal transition-all duration-300",
          studioExpanded ? "h-[90vh] w-[95vw] max-w-7xl" : "w-full max-w-xl"
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-foreground">
              {agent ? "Editar Agente" : "Novo Agente"}
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
              {agent
                ? `Editando: ${agent.name}`
                : templateName
                  ? `Template: ${templateName}`
                  : "Configure seu novo Agente de IA"}
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
          <div
            className={cn(
              "flex min-h-0 flex-1 overflow-hidden",
              studioExpanded ? "flex-col lg:flex-row" : "flex-col"
            )}
          >
            <div
              className={cn(
                "flex min-h-0 flex-col gap-5 p-6",
                studioExpanded
                  ? "flex-1 overflow-hidden border-b border-[var(--color-border-subtle)] lg:w-[72%] lg:border-b-0 lg:border-r"
                  : "w-full overflow-y-auto"
              )}
            >
              <div
                className={cn(
                  "grid-cols-1 gap-5",
                  studioExpanded ? "hidden" : "grid"
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

              {!agent && templateKey === "cobranca_rb" ? (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                    Token API RB
                  </label>
                  <input
                    type="text"
                    value={rbTokenApi}
                    onChange={(event) => setRbTokenApi(event.target.value)}
                    placeholder="Cole o token do Registro Base"
                    className="w-full rounded-xl border border-[var(--color-border-medium)] bg-transparent px-4 py-2.5 text-sm text-foreground placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent)]/60 focus:outline-none"
                  />
                  <p className="text-[11px] text-[var(--color-text-secondary)]">
                    Esse token habilita a integracao inicial. Empresas e Pix por loja continuam na Tool Cobranca RB.
                  </p>
                </div>
              ) : null}

              <div className={cn("flex flex-col gap-3", studioExpanded && "xl:col-span-2")}>
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

                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--color-surface-1)] px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold text-foreground">{currentPersonality.label}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
                    {currentPersonality.description}
                  </p>
                  <p className="mt-1.5 text-[10px] text-[var(--color-text-muted)]">
                    Temperatura: {currentPersonality.temperature}
                  </p>
                </div>
              </div>

              <div className={cn("rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/60 p-4", studioExpanded && "xl:col-span-2")}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                      Handoff Humano
                    </label>
                    <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                      Transfere o lead da IA para o Chat Manual dentro do CRM.
                    </p>
                    <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">
                      {handoffEnabled
                        ? handoffReady
                          ? "Ativo para transferir ao Chat Manual."
                          : "Handoff ligado, mas ainda falta definir a regra de transferencia."
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
                          setHandoffConfigOpen(true);
                        }
                      }}
                      aria-label="Ativar handoff humano"
                    />
                    <button
                      type="button"
                      onClick={() => setHandoffConfigOpen(true)}
                      className="rounded-xl border border-[var(--color-border-medium)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-border-subtle)] hover:text-foreground"
                    >
                      Configurar
                    </button>
                  </div>
                </div>
              </div>

              </div>

              <div
                className={cn(
                  "flex flex-col gap-1.5",
                  studioExpanded ? "min-h-0 flex-1" : "min-h-[320px]"
                )}
              >
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
                    studioExpanded ? "min-h-[360px] flex-1" : "min-h-[280px]"
                  )}
                />
              </div>
            </div>

            {studioExpanded ? (
              <div className="flex max-h-[34vh] min-h-0 flex-col overflow-hidden bg-[var(--color-bg-surface)] lg:max-h-none lg:w-[28%]">
                <div className="flex-shrink-0 border-b border-[var(--color-border-subtle)] px-4 py-3">
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
                        "flex cursor-grab items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--color-surface-1)] px-3 py-2.5 shadow-sm transition-all duration-150 hover:border-[var(--color-primary-200)] hover:bg-[var(--color-bg-subtle)] active:cursor-grabbing",
                        section.required
                          ? "border-[var(--color-primary-200)]"
                          : "border-[var(--color-border-medium)]"
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
              className="rounded-xl bg-[var(--color-primary-500)] px-5 py-2 text-sm font-semibold text-[var(--color-surface-1)] shadow-primary transition-all hover:bg-[var(--color-primary-600)] disabled:opacity-50"
            >
              {saving ? "Salvando..." : agent ? "Salvar Alteracoes" : "Criar Agente"}
            </button>
          </div>
        </form>
      </div>

      {handoffConfigOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-[rgba(26,24,20,0.35)] backdrop-blur-sm"
            onClick={() => setHandoffConfigOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="handoff-config-title"
            className="relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-[24px] border border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] px-6 py-4">
              <div>
                <h3 id="handoff-config-title" className="text-base font-bold text-foreground">
                  Configuracao rapida de handoff
                </h3>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                  Defina quando a IA deve sair do fluxo automatico e transferir para o Chat Manual.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setHandoffConfigOpen(false)}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[var(--color-border-medium)] transition-colors hover:bg-[var(--color-border-subtle)]"
                aria-label="Fechar configuracao de handoff"
              >
                <X className="h-4 w-4 text-[var(--color-text-secondary)]" />
              </button>
            </div>

            <div className="grid gap-4 overflow-y-auto px-6 py-5">
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/60 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">Handoff humano</p>
                  <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                    {handoffEnabled ? "Ativo para este agente." : "Desativado para este agente."}
                  </p>
                </div>
                <Switch
                  checked={handoffEnabled}
                  onCheckedChange={setHandoffEnabled}
                  aria-label="Ativar handoff humano"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                  Quando a IA Deve Fazer o Handoff
                </label>
                <textarea
                  value={handoffPrompt}
                  onChange={(event) => setHandoffPrompt(event.target.value)}
                  placeholder="Ex: Acione o handoff quando o lead pedir atendimento humano, reclamar, pedir desconto fora da politica ou demonstrar urgencia alta."
                  className="min-h-[150px] w-full resize-y rounded-xl border border-[var(--color-border-medium)] bg-transparent px-4 py-3 text-sm text-foreground placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent)]/60 focus:outline-none"
                />
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  Escreva em linguagem natural as situacoes que exigem transferencia para uma pessoa.
                </p>
              </div>

              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-4 py-3">
                <p className="text-xs font-semibold text-foreground">Encaminhamento externo</p>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                  Chamadas e notificacoes por telefone/WhatsApp agora pertencem exclusivamente a Tool Encaminhamento.
                  Configure esses destinos no fluxo proprio de Tools do agente.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-[var(--color-border-subtle)] px-6 py-4">
              <button
                type="button"
                onClick={() => setHandoffConfigOpen(false)}
                className="rounded-xl px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-border-subtle)] hover:text-foreground"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
