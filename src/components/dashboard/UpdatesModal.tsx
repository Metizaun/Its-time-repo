import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Sparkles } from "lucide-react";
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
const STORAGE_KEY = "its-time-seen-update-v250";

const HIGHLIGHTS = [
  {
    icon: <Sparkles className="h-5 w-5 text-[#E8511A]" aria-hidden="true" />,
    title: "Nova visão de agentes",
    text: "Veja agentes principais, subagentes e ferramentas em um único fluxo.",
  },
  {
    icon: <Sparkles className="h-5 w-5 text-[#E8511A]" aria-hidden="true" />,
    title: "Ferramentas por agente",
    text: "Configure agenda, encaminhamentos e capacidades específicas para cada agente.",
  },
  {
    icon: <Sparkles className="h-5 w-5 text-[#E8511A]" aria-hidden="true" />,
    title: "Encaminhamento inteligente",
    text: "Direcione conversas para agentes especializados com regras de atendimento mais claras.",
  },
  {
    icon: <Sparkles className="h-5 w-5 text-[#E8511A]" aria-hidden="true" />,
    title: "Catálogo de visagismo",
    text: "Organize armações, análises e simulações diretamente pelo CRM.",
  },
  {
    icon: <Sparkles className="h-5 w-5 text-[#E8511A]" aria-hidden="true" />,
    title: "Mais estabilidade no chat",
    text: "Melhorias nas atualizações em tempo real e na contagem de mensagens não lidas.",
  },
];

export function UpdatesModal() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isCurrentReleasePublished()) return;

    const seen = localStorage.getItem(STORAGE_KEY);
    if (seen !== CURRENT_VERSION) setOpen(true);
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
    <Dialog open={open} onOpenChange={(value) => { if (!value) dismiss(); }}>
      <DialogContent
        className="w-[min(94vw,32rem)] overflow-hidden rounded-2xl border border-neutral-200 bg-white p-0 shadow-2xl gap-0"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="relative overflow-hidden border-b border-neutral-100 bg-[#faf9f6] px-6 py-5">
          <div className="relative">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E8511A] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E8511A]" />
              </span>
              <span className="font-mono text-[10px] font-bold tracking-wider text-[#E8511A] uppercase">
                NOVIDADES — {CURRENT_VERSION}
              </span>
            </div>

            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-extrabold leading-snug text-neutral-900">
                Agentes mais claros. Operação mais conectada.
              </DialogTitle>
              <p className="text-xs font-normal leading-relaxed text-neutral-500">
                Uma nova forma de organizar cada fluxo de atendimento.
              </p>
            </DialogHeader>
          </div>
        </div>

        <div className="max-h-[60vh] divide-y divide-neutral-100 overflow-y-auto px-5 py-2">
          {HIGHLIGHTS.map((item) => (
            <div key={item.title} className="group flex items-center gap-3.5 py-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FFF3EE]" aria-hidden="true">
                {item.icon}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="text-sm font-semibold text-neutral-900">{item.title}</h3>
                <p className="text-xs font-normal leading-relaxed text-neutral-700">{item.text}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-neutral-100 bg-[#faf9f6] px-5 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={dismiss}
            className="w-full text-xs font-mono text-neutral-500 hover:text-neutral-900 sm:w-auto"
          >
            Agora não
          </Button>
          <Button
            size="sm"
            onClick={goToUpdates}
            className="w-full gap-1.5 bg-[#E8511A] text-xs font-mono font-bold text-white shadow-sm hover:bg-[#FF6848] sm:w-auto"
          >
            Ver detalhes
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
