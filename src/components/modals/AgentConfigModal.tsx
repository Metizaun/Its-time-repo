import { useState, useRef, useEffect, useCallback } from "react";
import { X, GripVertical, Maximize2, Minimize2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgents } from "@/hooks/useAgents";
import { useInstances } from "@/hooks/useInstances";
import { AIAgent } from "@/types";
import { PROMPT_GUIDANCE_SECTIONS } from "@/lib/aiPrompt";

// ─── Personality / Temperature Configuration ─────────────────────────────────
// 5 levels mapped to Temperature + Behavioral Description injected into prompt.
const PERSONALITY_LEVELS = [
  {
    label: "Cirúrgico",
    description: "Seco, direto e objetivo. Respostas curtas sem rodeios.",
    temperature: 0.10,
    promptSuffix:
      "Mantenha um estilo de comunicação seco, objetivo e extremamente direto. Sem saudações excessivas, sem elogios e sem rodeios. Foco total na informação.",
  },
  {
    label: "Consultivo",
    description: "Profissional e embasado. Transmite confiança e expertise.",
    temperature: 0.25,
    promptSuffix:
      "Mantenha postura consultiva e profissional. Seja claro e embasado, transmitindo confiança e expertise sem excesso de informalidade.",
  },
  {
    label: "Equilibrado",
    description: "Tom neutro. Amigável sem exageros.",
    temperature: 0.40,
    promptSuffix:
      "Use tom equilibrado e amigável. Seja cordial e acessível, mas sem excesso de entusiasmo ou informalidade.",
  },
  {
    label: "Dinâmico",
    description: "Energético e persuasivo. Cria rapport com facilidade.",
    temperature: 0.60,
    promptSuffix:
      "Seja energético, descontraído e persuasivo. Crie rapport de forma espontânea, use uma linguagem mais próxima e envolvente para engajar o lead.",
  },
  {
    label: "Entusiasta",
    description: "Alta energia e impacto emocional. Ideal para vendas ativas.",
    temperature: 0.75,
    promptSuffix:
      "Seja altamente entusiasta e empático. Use linguagem animada, valorize o lead, crie alto impacto emocional e urgência positiva para conduzir à conversão.",
  },
];

const DEFAULT_MODEL = "gemini-2.5-flash";

interface AgentConfigModalProps {
  open: boolean;
  agent: AIAgent | null;
  onClose: () => void;
}

export function AgentConfigModal({ open, agent, onClose }: AgentConfigModalProps) {
  const { upsertAgent, saving } = useAgents();
  const { instances } = useInstances();

  // ── Form state ──────────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [personalityLevel, setPersonalityLevel] = useState(2); // índice 0-4
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model] = useState(DEFAULT_MODEL);

  // ── Prompt Studio ─────────────────────────────────────────────────────────
  const [studioExpanded, setStudioExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragBlockRef = useRef<string | null>(null);

  // Populate on edit
  useEffect(() => {
    if (open) {
      if (agent) {
        setName(agent.name);
        setInstanceName(agent.instance_name);
        setSystemPrompt(agent.system_prompt);
        // Approximate the level from the stored temperature
        const idx = PERSONALITY_LEVELS.reduce((best, lvl, i) => {
          return Math.abs(lvl.temperature - agent.temperature) <
            Math.abs(PERSONALITY_LEVELS[best].temperature - agent.temperature)
            ? i
            : best;
        }, 2);
        setPersonalityLevel(idx);
      } else {
        setName("");
        setInstanceName("");
        setSystemPrompt("");
        setPersonalityLevel(2);
      }
      setStudioExpanded(false);
    }
  }, [open, agent]);

  // ── DnD Handlers ─────────────────────────────────────────────────────────
  const handleDragStart = useCallback((content: string) => {
    dragBlockRef.current = content;
  }, []);

  const handleDropOnTextarea = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      const content = dragBlockRef.current;
      if (!content || !textareaRef.current) return;

      const textarea = textareaRef.current;
      const start = textarea.selectionStart ?? systemPrompt.length;
      const before = systemPrompt.slice(0, start);
      const after = systemPrompt.slice(start);
      const separator = before.length > 0 && !before.endsWith("\n\n") ? "\n\n" : "";
      const next = `${before}${separator}${content}\n\n${after}`;
      setSystemPrompt(next);
      dragBlockRef.current = null;

      // Reposicionar cursor após o bloco inserido
      requestAnimationFrame(() => {
        const pos = (before + separator + content + "\n\n").length;
        textarea.setSelectionRange(pos, pos);
        textarea.focus();
      });
    },
    [systemPrompt]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !instanceName || !systemPrompt.trim()) return;

    const personality = PERSONALITY_LEVELS[personalityLevel];
    const finalPrompt = `${systemPrompt.trim()}\n\n## Estilo de Comunicação\n${personality.promptSuffix}`;

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
      },
      agent?.id
    );
    onClose();
  }

  if (!open) return null;

  const currentPersonality = PERSONALITY_LEVELS[personalityLevel];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={cn(
          "relative bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] border-t-2 border-t-[var(--color-accent)]",
          "shadow-[0_24px_64px_rgba(0,0,0,0.3)] rounded-[24px] flex flex-col transition-all duration-300",
          studioExpanded
            ? "w-[95vw] h-[90vh] max-w-none"
            : "w-full max-w-xl max-h-[90vh]"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)] flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-foreground">
              {agent ? "Editar Agente" : "Novo Agente"}
            </h2>
            <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
              {agent ? `Editando: ${agent.name}` : "Configure seu novo Agente de IA"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-[var(--color-border-medium)] flex items-center justify-center hover:bg-[var(--color-border-subtle)] transition-colors"
          >
            <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex flex-1 overflow-hidden">

            {/* Main Form Area */}
            <div className={cn("flex flex-col overflow-y-auto p-6 gap-5", studioExpanded ? "w-3/4 border-r border-[var(--color-border-subtle)]" : "w-full")}>

              {/* Nome */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                  Nome do Agente
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Agente Vendas WhatsApp"
                  required
                  className="w-full bg-transparent border border-[var(--color-border-medium)] rounded-xl px-4 py-2.5 text-sm text-foreground placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]/60 transition-colors"
                />
              </div>

              {/* Instância */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                  Instância Vinculada
                </label>
                <select
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  required
                  className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-medium)] rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-[var(--color-accent)]/60 transition-colors"
                >
                  <option value="" disabled>Selecione uma instância</option>
                  {instances.map((inst) => (
                    <option key={inst.instancia} value={inst.instancia}>
                      {inst.instancia}
                    </option>
                  ))}
                </select>
              </div>

              {/* Personalidade / Estilo */}
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                    Estilo de Abordagem
                  </label>
                  <p className="text-[11px] text-[var(--color-text-secondary)] mt-1">
                    Define como o agente interage — afeta diretamente o comportamento e a precisão das respostas.
                  </p>
                </div>

                {/* Level Labels */}
                <div className="flex justify-between px-0.5">
                  {PERSONALITY_LEVELS.map((lvl, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPersonalityLevel(i)}
                      className={cn(
                        "text-[10px] font-semibold transition-colors duration-150",
                        personalityLevel === i
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                      )}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>

                {/* Slider */}
                <div className="relative">
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={1}
                    value={personalityLevel}
                    onChange={(e) => setPersonalityLevel(Number(e.target.value))}
                    className="w-full accent-[var(--color-accent)] h-1 bg-[var(--color-border-medium)] rounded-full cursor-pointer"
                  />
                </div>

                {/* Active description */}
                <div className="rounded-xl border border-[var(--color-border-subtle)] border-t-[var(--color-accent)] border-t-2 bg-transparent px-4 py-3 shadow-[0_4px_16px_rgba(229,57,58,0.04)]">
                  <p className="text-xs font-semibold text-foreground">{currentPersonality.label}</p>
                  <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">{currentPersonality.description}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
                    Temperatura: {currentPersonality.temperature}
                  </p>
                </div>
              </div>

              {/* Prompt / Studio */}
              <div className="flex flex-col gap-1.5 flex-1 min-h-0">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                    Instruções do Agente
                  </label>
                  <button
                    type="button"
                    onClick={() => setStudioExpanded(!studioExpanded)}
                    className="flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)] hover:text-foreground transition-colors"
                  >
                    {studioExpanded ? (
                      <><Minimize2 className="w-3 h-3" /> Recolher</>
                    ) : (
                      <><Maximize2 className="w-3 h-3" /> Expandir Studio</>
                    )}
                  </button>
                </div>
                <textarea
                  ref={textareaRef}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  onDrop={handleDropOnTextarea}
                  onDragOver={handleDragOver}
                  placeholder="Descreva como o agente deve se comportar, quais são suas regras, script de abertura, etc."
                  required
                  className={cn(
                    "w-full bg-transparent border border-[var(--color-border-medium)] rounded-xl px-4 py-3 text-sm text-foreground placeholder-[var(--color-text-muted)]",
                    "focus:outline-none focus:border-[var(--color-accent)]/60 transition-colors resize-none leading-relaxed",
                    studioExpanded ? "flex-1 h-full" : "h-48"
                  )}
                />
              </div>
            </div>

            {/* Prompt Studio Sidebar */}
            {studioExpanded && (
              <div className="w-1/4 flex flex-col overflow-hidden bg-[var(--color-bg-surface)]">
                <div className="px-4 py-3 border-b border-[var(--color-border-subtle)] flex-shrink-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
                    Blocos de Instrução
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                    Arraste para o editor
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {PROMPT_GUIDANCE_SECTIONS.map((section) => (
                    <div
                      key={section.title}
                      draggable
                      onDragStart={() =>
                        handleDragStart(
                          `## ${section.title}\n${section.description}\n\n[Preencha aqui suas instruções específicas para esta seção]`
                        )
                      }
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-grab active:cursor-grabbing",
                        "bg-transparent border border-[var(--color-border-subtle)] border-t-2",
                        section.required
                          ? "border-t-[var(--color-accent)]/60"
                          : "border-t-[var(--color-border-medium)]",
                        "hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-border-subtle)] transition-all duration-150",
                        "shadow-[0_4px_12px_rgba(229,57,58,0.03)]"
                      )}
                    >
                      {/* Grip icon — visual affordance only */}
                      <GripVertical className="w-4 h-4 text-[var(--color-text-muted)] flex-shrink-0" />
                      <span className="text-xs font-medium text-[var(--color-text-secondary)] select-none leading-tight">
                        {section.title}
                      </span>
                      {section.required && (
                        <ChevronRight className="w-3 h-3 text-[var(--color-accent)]/40 ml-auto flex-shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border-subtle)] flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-foreground rounded-xl hover:bg-[var(--color-border-subtle)] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-semibold bg-[var(--color-accent)] hover:brightness-110 disabled:opacity-50 text-white rounded-xl transition-all shadow-[0_4px_16px_rgba(229,57,58,0.3)]"
            >
              {saving ? "Salvando..." : agent ? "Salvar Alterações" : "Criar Agente"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
