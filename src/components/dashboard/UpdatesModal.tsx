import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, BookOpen, Building2, Calendar, Sparkles } from "lucide-react";
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
const STORAGE_KEY = "its-time-seen-update-v240";

// ─── Destaques da Release v2.4.0 ───────────────────────────────────────────────
const HIGHLIGHTS = [
  {
    icon: "/update-icons/feature.png",
    fallbackIcon: <Building2 className="h-5 w-5 text-[#E8511A]" />,
    type: "NOVIDADE",
    tag: "MULTI-COMPANY",
    badgeBg: "bg-[#FFF3EE] text-[#E8511A] border-[#FFE2D0]",
    text: "Gestão Completa de Empresas & Filiais: cadastre unidades com validação de CNPJ, endereço e fuso horário local.",
  },
  {
    icon: "/update-icons/feature.png",
    fallbackIcon: <Calendar className="h-5 w-5 text-[#E8511A]" />,
    type: "NOVIDADE",
    tag: "COMPANY-AGENDA",
    badgeBg: "bg-[#FFF3EE] text-[#E8511A] border-[#FFE2D0]",
    text: "Nova Agenda Multi-Unidade: filtre a disponibilidade por empresa, associe profissionais e gerencie tarifas por local.",
  },
  {
    icon: "/update-icons/feature.png",
    fallbackIcon: <Sparkles className="h-5 w-5 text-[#E8511A]" />,
    type: "NOVIDADE",
    tag: "AI-MULTIUNIT",
    badgeBg: "bg-[#FFF3EE] text-[#E8511A] border-[#FFE2D0]",
    text: "Agendamento por IA Geolocalizada: Agentes cognitivos identificam a unidade do cliente e realizam agendamentos autônomos.",
  },
  {
    icon: "/update-icons/improvement.png",
    fallbackIcon: <Building2 className="h-5 w-5 text-rose-600" />,
    type: "MELHORIA",
    tag: "LEAD-TENANCY",
    badgeBg: "bg-rose-50 text-rose-700 border-rose-200",
    text: "Vínculo CRM Empresa-Lead: acompanhe o histórico de atendimentos e agendamentos segregados por filial.",
  },
  {
    icon: "/update-icons/improvement.png",
    fallbackIcon: <Calendar className="h-5 w-5 text-rose-600" />,
    type: "MELHORIA",
    tag: "CALENDAR-UX",
    badgeBg: "bg-rose-50 text-rose-700 border-rose-200",
    text: "Grade da Agenda Otimizada: navegabilidade em tempo real com disparo de lembretes via WhatsApp (1h/24h) e alerta anti-conflito.",
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

  function goToGuide() {
    dismiss();
    navigate("/guia-agenda");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent
        className="w-[min(94vw,32rem)] overflow-hidden rounded-2xl border border-neutral-200 bg-white p-0 shadow-2xl gap-0"
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Cabeçalho com destaque de versão */}
        <div className="relative overflow-hidden px-6 py-5 border-b border-neutral-100 bg-[#faf9f6]">
          <div className="relative">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E8511A] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E8511A]" />
              </span>
              <span className="font-mono text-[10px] font-bold tracking-wider text-[#E8511A] uppercase">
                NOVIDADES — {CURRENT_VERSION}
              </span>
            </div>

            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-extrabold text-neutral-900 leading-snug">
                Atualizações desta semana
              </DialogTitle>
              <p className="text-xs text-neutral-500 font-normal leading-relaxed">
                Módulo Multi-Empresas e Nova Agenda Inteligente disponíveis agora.
              </p>
            </DialogHeader>
          </div>
        </div>

        {/* Lista de Destaques com Ícones Alinhados */}
        <div className="divide-y divide-neutral-100 px-5 py-2 max-h-[60vh] overflow-y-auto">
          {HIGHLIGHTS.map((item, i) => (
            <div key={i} className="flex items-center gap-3.5 py-3.5 group">
              {/* Ícone PNG Oficial em Tamanho Total da Box */}
              <img
                src={item.icon}
                alt={item.type}
                className="w-14 h-14 shrink-0 object-contain select-none drop-shadow-xs"
                draggable={false}
              />

              {/* Texto e Badges */}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded border ${item.badgeBg}`}>
                    {item.type}
                  </span>
                  <span className="text-[10px] font-mono text-neutral-400 font-semibold">
                    {item.tag}
                  </span>
                </div>
                <p className="text-xs text-neutral-700 leading-relaxed font-normal">
                  {item.text}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer com ações */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-neutral-100 bg-[#faf9f6] px-5 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={dismiss}
            className="text-xs text-neutral-500 hover:text-neutral-900 font-mono w-full sm:w-auto"
          >
            Dispensar
          </Button>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={goToGuide}
              className="gap-1.5 border-[#E8511A] text-[#E8511A] bg-[#FFF3EE] hover:bg-[#FFE2D0] text-xs font-mono font-bold w-full sm:w-auto"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Guia em Fotos
            </Button>

            <Button
              size="sm"
              onClick={goToUpdates}
              className="gap-1.5 bg-[#E8511A] text-white hover:bg-[#FF6848] text-xs font-mono font-bold w-full sm:w-auto shadow-sm"
            >
              Ver todas
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
