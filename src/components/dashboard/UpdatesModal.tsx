import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Cable,
  CalendarDays,
  Headphones,
  MessageCircle,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CURRENT_VERSION = "v2.7.0";
const RELEASE_PUBLISH_AT = Date.parse("2026-09-15T00:00:00-03:00");
const RELEASE_URL = "https://itstime.pro/updates";
const STORAGE_KEY = `its-time-seen-update-${CURRENT_VERSION.split(".").join("")}`;

const HIGHLIGHTS = [
  [
    {
      icon: <MessageCircle className="h-5 w-5 text-[var(--color-primary-500)]" aria-hidden="true" />,
      title: "Chat interno",
      text: "Conversas diretas, grupos, menções, anexos e mensagens não lidas dentro do CRM.",
    },
    {
      icon: <Receipt className="h-5 w-5 text-[var(--color-primary-500)]" aria-hidden="true" />,
      title: "Cobrança independente",
      text: "Integração RB, webhooks e importações CSV ou XLSX em uma operação mais previsível.",
    },
    {
      icon: <CalendarDays className="h-5 w-5 text-[var(--color-primary-500)]" aria-hidden="true" />,
      title: "Sincronização de agenda",
      text: "Uma nova base para conectar agendas e sincronizar dados em duas direções.",
    },
  ],
  [
    {
      icon: <Cable className="h-5 w-5 text-[var(--color-primary-500)]" aria-hidden="true" />,
      title: "Central de conexões",
      text: "Canais, fontes financeiras e parceiros de agenda agora fazem parte do mesmo mapa operacional.",
    },
    {
      icon: <Headphones className="h-5 w-5 text-[var(--color-primary-500)]" aria-hidden="true" />,
      title: "Atendimento mais consistente",
      text: "Melhorias em áudios, templates, provedores de mensagens e classificação comercial.",
    },
    {
      icon: <ShieldCheck className="h-5 w-5 text-[var(--color-primary-500)]" aria-hidden="true" />,
      title: "Segurança e continuidade",
      text: "Isolamento por empresa, auditoria, proteção de credenciais e backups verificáveis.",
    },
  ],
] as const;

export function UpdatesModal() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let timer: number | undefined;

    const syncRelease = () => {
      const now = Date.now();
      if (now < RELEASE_PUBLISH_AT) {
        timer = window.setTimeout(
          syncRelease,
          Math.min(RELEASE_PUBLISH_AT - now, 60_000),
        );
        return;
      }

      let seen: string | null = null;
      try {
        seen = localStorage.getItem(STORAGE_KEY);
      } catch {
        // Mantém o anúncio disponível quando o armazenamento do navegador estiver bloqueado.
      }
      if (seen !== CURRENT_VERSION) {
        setPage(0);
        setOpen(true);
      }
    };

    syncRelease();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
    } catch {
      // O fechamento continua funcionando mesmo sem acesso ao armazenamento local.
    }
    setOpen(false);
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
                  ? "Três fluxos. Uma operação mais coordenada."
                  : "Mais recursos. Menos complexidade."}
              </DialogTitle>
              <p className="text-xs font-normal leading-relaxed text-[var(--color-gray-500)]">
                {page === 0
                  ? "Conversa, cobrança e agenda avançam sob a mesma lógica operacional."
                  : "Conexões, atendimento e segurança sustentam a nova entrega."}
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
                asChild
                size="sm"
                className="w-full gap-1.5 bg-[var(--color-primary-500)] text-xs font-mono font-bold text-white shadow-primary hover:bg-[var(--color-primary-600)] sm:w-auto"
              >
                <a href={RELEASE_URL} target="_blank" rel="noreferrer" onClick={dismiss}>
                  Ver atualização completa
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
