import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Cpu, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CURRENT_RELEASE_VERSION,
  isCurrentReleasePublished,
} from "@/lib/releaseSchedule";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Constante de versão ───────────────────────────────────────────────────────
// Atualize este valor a cada release para que o modal reapareça para todos.
const CURRENT_VERSION = CURRENT_RELEASE_VERSION;
const STORAGE_KEY = "its-time-seen-update";

// ─── Novidades do release atual ───────────────────────────────────────────────
const HIGHLIGHTS = [
  {
    icon: <Sparkles className="h-5 w-5" aria-hidden="true" />,
    type: "NOVIDADE",
    gradient: "update-gradient--orange-coral",
    text: "Sua IA agora pode falar — envio de mensagens de voz com diversas opções de vozes.",
  },
  {
    icon: <Sparkles className="h-5 w-5" aria-hidden="true" />,
    type: "NOVIDADE",
    gradient: "update-gradient--coral-pink",
    text: "Pipeline inteligente classifica leads automaticamente, mesmo sem agentes de IA ativos.",
  },
  {
    icon: <Sparkles className="h-5 w-5" aria-hidden="true" />,
    type: "NOVIDADE",
    gradient: "update-gradient--orange-pink-electric",
    text: "Crie templates oficiais da Meta (Gupshup) diretamente pelo app.",
  },
  {
    icon: <Cpu className="h-5 w-5" aria-hidden="true" />,
    type: "MELHORIA",
    gradient: "update-gradient--coral-pink-soft",
    text: "Exibição de imagens (Gupshup) e botões interativos (Meta) no chat.",
  },
  {
    icon: <Cpu className="h-5 w-5" aria-hidden="true" />,
    type: "MELHORIA",
    gradient: "update-gradient--coral-pink",
    text: "Chat redesenhado: mais limpo, rápido e produtivo.",
  },
];

export function UpdatesModal() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isCurrentReleasePublished()) return;

    const seen = localStorage.getItem(STORAGE_KEY);
    if (seen !== CURRENT_VERSION) {
      setOpen(true);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
    setOpen(false);
  }

  function goToUpdates() {
    dismiss();
    navigate("/updates");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent
        className="w-[min(92vw,30rem)] overflow-hidden rounded-[var(--radius-xl)] border-[var(--border-default)] bg-[var(--color-surface-1)] p-0 shadow-[var(--shadow-lg)] gap-0"
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Cabeçalho com gradiente laranja sutil */}
        <div className="relative overflow-hidden px-6 py-5 border-b border-[var(--border-subtle)]">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{
              background:
                "radial-gradient(circle at 0% 50%, var(--color-primary-500), transparent 70%)",
            }}
            aria-hidden="true"
          />

          <div className="relative">
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                {/* Bullet laranja pulsante */}
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-primary-500)] opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-primary-500)]" />
                </span>
                <span className="font-mono text-[10px] font-semibold tracking-wider text-[var(--color-primary-600)] uppercase">
                  Novidades — {CURRENT_VERSION}
                </span>
              </div>
              <DialogHeader className="space-y-1">
                <DialogTitle className="text-base font-bold text-[var(--color-gray-900)] leading-snug">
                  Atualizações desta semana
                </DialogTitle>
                <p className="text-xs text-[var(--color-gray-500)] leading-relaxed">
                  Novas capacidades, melhorias e compatibilidades disponíveis agora.
                </p>
              </DialogHeader>
            </div>
          </div>
        </div>

        {/* Lista de Highlights */}
        <div className="divide-y divide-[var(--border-subtle)] px-5 py-1">
          {HIGHLIGHTS.map((item, i) => (
            <div key={i} className="flex items-start gap-4 py-3.5">
              <span
                className={`update-type-visual update-type-visual--compact ${item.gradient}`}
                role="img"
                aria-label={item.type}
              >
                {item.icon}
              </span>
              <p className="min-w-0 pt-0.5 text-xs leading-relaxed text-[var(--color-gray-700)]">
                <span className="sr-only">{item.type}: </span>
                {item.text}
              </p>
            </div>
          ))}
        </div>

        {/* Footer com ações */}
        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--color-bg-subtle)] px-5 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={dismiss}
            className="text-xs text-[var(--color-gray-500)] hover:text-[var(--color-gray-800)]"
          >
            Dispensar
          </Button>
          <Button
            size="sm"
            onClick={goToUpdates}
            className="gap-1.5 bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] text-xs"
          >
            Ver todas as novidades
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
