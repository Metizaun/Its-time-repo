import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  CalendarCheck,
  Image,
  Route,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
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

const CURRENT_VERSION = CURRENT_RELEASE_VERSION;
const STORAGE_KEY = `its-time-seen-update-${CURRENT_VERSION.replace(".", "")}`;

const HIGHLIGHTS = [
  [
    {
      icon: <Send className="h-5 w-5 text-[var(--color-primary-500)]" aria-hidden="true" />,
      title: "Instagram conectado ao CRM",
      text: "Conecte sua conta profissional, receba conversas no lead e responda sem sair do fluxo comercial.",
    },
    {
      icon: <Image className="h-5 w-5 text-[var(--color-primary-500)]" aria-hidden="true" />,
      title: "Texto, imagem e áudio",
      text: "Envie mensagens multimídia pelo canal certo, com suporte para os formatos usados no atendimento.",
    },
    {
      icon: <ShieldCheck className="h-5 w-5 text-[var(--color-primary-500)]" aria-hidden="true" />,
      title: "Histórico de conversas protegido",
      text: "Mídias e mensagens ficam registradas no lead com conexão segura e renovação de token.",
    },
  ],
  [
    {
      icon: <Route className="h-5 w-5 text-[var(--color-primary-500)]" aria-hidden="true" />,
      title: "Roteamento por empresa e instância",
      text: "Cada operação continua isolada, sem misturar números, canais ou históricos entre empresas.",
    },
    {
      icon: <CalendarCheck className="h-5 w-5 text-[var(--color-primary-500)]" aria-hidden="true" />,
      title: "Agenda e encaminhamento mais claros",
      text: "Handoff e agendamento seguem o contexto correto do lead e da unidade de atendimento.",
    },
    {
      icon: <Sparkles className="h-5 w-5 text-[var(--color-primary-500)]" aria-hidden="true" />,
      title: "Chat mais consistente",
      text: "Ajustes em mídias, botões, localizador de lojas e atualizações em tempo real deixam a operação mais estável.",
    },
  ],
] as const;

export function UpdatesModal() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!isCurrentReleasePublished()) return;

    const seen = localStorage.getItem(STORAGE_KEY);
    if (seen !== CURRENT_VERSION) {
      setPage(0);
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
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setOpen(true);
        } else if (page === 1) {
          dismiss();
        }
      }}
    >
      <DialogContent
        className="w-[min(94vw,32rem)] overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--color-surface-1)] p-0 shadow-modal gap-0"
        onEscapeKeyDown={(event) => {
          if (page === 0) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (page === 0) event.preventDefault();
        }}
      >
        <div className="relative overflow-hidden border-b border-[var(--border-subtle)] bg-[var(--color-surface-2)] px-6 py-5">
          <div className="relative">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-primary-500)] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-primary-500)]" />
              </span>
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--color-primary-500)]">
                NOVA ATUALIZAÇÃO — {CURRENT_VERSION}
              </span>
            </div>

            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-extrabold leading-snug text-[var(--color-gray-900)]">
                {page === 0
                  ? "Conversas que chegam mais perto."
                  : "Uma operação mais conectada."}
              </DialogTitle>
              <p className="text-xs font-normal leading-relaxed text-[var(--color-gray-500)]">
                {page === 0
                  ? "Instagram + Its Time CRM"
                  : "Tudo o que evoluiu no atendimento nas últimas semanas."}
              </p>
            </DialogHeader>
          </div>
        </div>

        <div className="max-h-[60vh] divide-y divide-[var(--border-subtle)] overflow-y-auto px-5 py-2">
          {HIGHLIGHTS[page].map((item) => (
            <div key={item.title} className="group flex items-center gap-3.5 py-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-50)]" aria-hidden="true">
                {item.icon}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="text-sm font-semibold text-[var(--color-gray-900)]">{item.title}</h3>
                <p className="text-xs font-normal leading-relaxed text-[var(--color-gray-700)]">{item.text}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--color-surface-2)] px-5 py-4">
          <div className="flex items-center gap-1.5" aria-label={`Página ${page + 1} de 2`}>
            {[0, 1].map((step) => (
              <span
                key={step}
                className={`h-1.5 rounded-full transition-all ${step === page ? "w-5 bg-[var(--color-primary-500)]" : "w-1.5 bg-[var(--color-gray-300)]"}`}
              />
            ))}
          </div>

          {page === 0 ? (
            <Button
              size="sm"
              onClick={() => setPage(1)}
              className="w-full gap-1.5 bg-[var(--color-primary-500)] text-xs font-mono font-bold text-white shadow-primary hover:bg-[var(--color-primary-600)] sm:w-auto"
            >
              Continuar
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          ) : (
            <div className="flex w-full gap-2 sm:w-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={dismiss}
                className="w-full text-xs font-mono text-[var(--color-gray-500)] hover:text-[var(--color-gray-900)] sm:w-auto"
              >
                Agora não
              </Button>
              <Button
                size="sm"
                onClick={goToUpdates}
                className="w-full gap-1.5 bg-[var(--color-primary-500)] text-xs font-mono font-bold text-white shadow-primary hover:bg-[var(--color-primary-600)] sm:w-auto"
              >
                Ver atualizações
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
