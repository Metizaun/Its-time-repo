import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import {
  CURRENT_RELEASE_VERSION,
  isCurrentReleasePublished,
} from "@/lib/releaseSchedule";

// Definição de tipos para as atualizações
interface ReleaseItem {
  type: "feature" | "improvement" | "fix" | "hotfix";
  tag: string;
  description: string;
}

interface Release {
  version: string;
  date: string;
  type: "major" | "minor" | "patch";
  status: "active" | "stable" | "legacy";
  headline: string;
  description: string;
  items: ReleaseItem[];
}

const releasesData: Release[] = [
  {
    version: "v2.5.0",
    date: "21 de Julho, 2026",
    type: "minor",
    status: "active",
    headline:
      "Classificação Inteligente de Leads, IA por Voz e Criação de Templates Meta",
    description:
      "Esta versão traz recursos de áudio para a inteligência artificial, classificação inteligente de leads independente de agentes ativos, e o gerenciamento de templates homologados da Meta.",
    items: [
      {
        type: "feature",
        tag: "IA-VOICE",
        description:
          "Agora sua IA pode falar: envio de mensagens de voz automáticas no chat com diversas opções de vozes configuráveis.",
      },
      {
        type: "feature",
        tag: "PIPELINE-INTEL",
        description:
          "Pipeline mais inteligente: mesmo sem agentes de IA ativos, o CRM classifica seus leads automaticamente. O painel de controle permite desligar a inteligência e operar o pipeline 100% de forma manual.",
      },
      {
        type: "feature",
        tag: "META-TEMPLATES",
        description:
          "Permissão para criação e homologação de templates da API oficial da Meta (WhatsApp) para Gupshup diretamente através do app.",
      },
      {
        type: "improvement",
        tag: "CHAT-COMPAT",
        description:
          "Compatibilidade de chat expandida: exibição direta de imagens para canais Gupshup e renderização interativa de botões da Meta.",
      },
      {
        type: "improvement",
        tag: "CHAT-UX",
        description:
          "Chat atualizado visualmente: interface mais limpa, rápida e fácil de usar, otimizando o fluxo diário de produtividade comercial.",
      },
    ],
  },
  {
    version: "v2.4.0",
    date: "20 de Julho, 2026",
    type: "major",
    status: "stable",
    headline: "Integração Nativa de Agentes SDR com Inteligência Cognitiva",
    description:
      "Esta versão consolida a automação de atendimento por agentes cognitivos diretamente integrados ao funil de vendas, eliminando a dependência de scripts rígidos.",
    items: [
      {
        type: "feature",
        tag: "AGENT-FLOW",
        description:
          "Novo módulo de Agentes Inteligentes com compreensão contextual de conversas no WhatsApp e Instagram.",
      },
      {
        type: "feature",
        tag: "PIPELINE-DYNAMIC",
        description:
          "Atualização automática de estágios do pipeline de vendas com base no sentimento detectado na conversa.",
      },
      {
        type: "improvement",
        tag: "UX-DENSITY",
        description:
          "Refatoração visual da tabela de leads para visualização compacta, reduzindo a fadiga visual através do token --color-gray-700.",
      },
      {
        type: "fix",
        tag: "AUTH-JWT",
        description:
          "Correção na expiração de tokens JWT durante sessões prolongadas de atendimento.",
      },
    ],
  },
  {
    version: "v2.3.1",
    date: "02 de Julho, 2026",
    type: "patch",
    status: "legacy",
    headline:
      "Hotfix de Estabilidade e Otimização do Calendário de Agendamentos",
    description:
      "Correções pontuais focadas em performance e sincronização de múltiplos calendários externos (Google Calendar e Outlook).",
    items: [
      {
        type: "hotfix",
        tag: "CALENDAR-SYNC",
        description:
          "Correção de concorrência na sincronização de horários ocupados que causava duplicidade de agendamentos.",
      },
      {
        type: "improvement",
        tag: "PERF-RECHARTS",
        description:
          "Otimização de re-renderização dos gráficos Soft UI na Dashboard principal para carregamento instantâneo.",
      },
      {
        type: "fix",
        tag: "MODAL-TRANSITION",
        description:
          "Ajuste na curva ease-spring de transição nos modais de confirmação rápida.",
      },
    ],
  },
];

export default function Updates() {
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 40);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Filtragem de releases com base no tipo de item
  const filteredReleases = releasesData
    .filter(
      (release) =>
        release.version !== CURRENT_RELEASE_VERSION ||
        isCurrentReleasePublished(),
    )
    .map((release) => {
      if (activeFilter === "all") return release;
      const filteredItems = release.items.filter(
        (item) => item.type === activeFilter,
      );
      if (filteredItems.length > 0) {
        return { ...release, items: filteredItems };
      }
      return null;
    })
    .filter((r): r is Release => r !== null);

  const TYPE_CONFIG: Record<
    ReleaseItem["type"],
    { icon: string; label: string; gradient: string; textGradient: string }
  > = {
    feature: {
      icon: "/update-icons/feature.png",
      label: "Novidade",
      gradient: "update-gradient--orange-coral",
      textGradient:
        "linear-gradient(135deg, #FF5A1F 0%, #FF6848 50%, #F0525D 100%)",
    },
    improvement: {
      icon: "/update-icons/improvement.png",
      label: "Melhoria",
      gradient: "update-gradient--coral-pink",
      textGradient:
        "linear-gradient(135deg, #F45B42 0%, #F45362 52%, #EB3F78 100%)",
    },
    fix: {
      icon: "/update-icons/fix.png",
      label: "Correção",
      gradient: "update-gradient--orange-pink-electric",
      textGradient:
        "linear-gradient(90deg, #FF4B16 0%, #FF534D 45%, #F52D73 100%)",
    },
    hotfix: {
      icon: "/update-icons/hotfix.png",
      label: "Hotfix",
      gradient: "update-gradient--coral-pink-soft",
      textGradient:
        "linear-gradient(135deg, #FF8A6C 0%, #F68F89 48%, #F3A1B2 100%)",
    },
  };

  return (
    <div className="min-h-screen bg-[#f5f3ef] text-[#0e0e10] font-sans antialiased relative selection:bg-[#FFE2D0] selection:text-[#E8511A]">
      {/* Elementos de Partícula Decorativos no Fundo */}
      <div
        className="absolute inset-0 overflow-hidden pointer-events-none opacity-40"
        aria-hidden="true"
      >
        {/* Grade fina Swiss */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(#d0cdc7 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        {/* Partículas flutuantes estilo site */}
        <span className="absolute w-2.5 h-2.5 bg-[#E8511A] rounded-full top-[12%] left-[8%] animate-pulse" />
        <span className="absolute w-1.5 h-1.5 bg-[#E83560] rounded-full top-[45%] right-[10%]" />
        <span className="absolute w-3 h-3 bg-neutral-900 rounded-sm top-[72%] left-[15%] opacity-20" />
        <span className="absolute w-2 h-2 bg-[#E8511A] rounded-full bottom-[15%] right-[25%]" />
      </div>

      {/* Header Sticky Editorial */}
      <header
        className={`sticky top-0 z-50 transition-all duration-300 border-b ${
          scrolled
            ? "bg-[#f5f3ef]/90 backdrop-blur-md border-[#d9d6d1] py-4 shadow-sm"
            : "bg-transparent border-transparent py-6"
        }`}
      >
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="flex items-center gap-2 mr-4 group text-sm font-mono text-neutral-600 hover:text-neutral-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
              <span>Voltar</span>
            </Link>

            {/* Logo com bloco e sombra laranja */}
            <div className="flex items-center gap-3">
              <div className="relative w-6 h-6 bg-[#080808] flex items-center justify-center shadow-[6px_5px_0_rgba(232,81,26,0.94)]">
                <div className="w-2.5 h-2.5 bg-[#f5f3ef]" />
                <span className="absolute top-2 -right-[9px] w-2 h-2 bg-[#E8511A]" />
                <span className="absolute -bottom-[2px] -right-[9px] w-2 h-2 bg-[#E83560]" />
              </div>
              <span className="font-mono text-lg font-bold tracking-[0.16em]">
                Its Time
              </span>
            </div>

            <div className="hidden sm:block w-[1px] h-6 bg-neutral-300/60 mx-2" />
            <p className="hidden sm:block text-[10px] text-neutral-500 font-mono tracking-widest uppercase">
              Release Notes & Updates
            </p>
          </div>

          <a
            href="https://itstime.com.br"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[#d9d6d1] rounded-full bg-white/60 hover:bg-white text-xs font-mono transition-all duration-200"
          >
            <span>Website</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12 relative z-10">
        {/* Seção Hero - Editorial Brutalista */}
        <section className="mb-20">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 mb-6">
              <span className="w-2 h-2 bg-[#E8511A] rounded-full animate-ping" />
              <span className="font-mono text-xs font-medium tracking-wider text-[#E8511A] uppercase">
                Atualizado em tempo real
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-[#0e0e10] mb-8 leading-[1.05]">
              Evolução é complexidade
              <br />
              <span className="text-neutral-400">sendo organizada.</span>
            </h1>

            <p className="text-lg sm:text-xl text-neutral-600 leading-relaxed max-w-2xl font-light">
              Release notes oficiais da plataforma Its Time CRM. Acompanhe a
              introdução de novos agentes de IA, automações cirúrgicas e
              melhorias operacionais.
            </p>
          </div>
        </section>

        {/* Filtros da Timeline */}
        <div className="border-b border-[#d9d6d1] pb-4 mb-12 flex flex-wrap gap-2 items-center justify-between">
          <div className="flex flex-wrap gap-1">
            {[
              { id: "all", label: "TODOS OS UPDATES" },
              { id: "feature", label: "NOVIDADES" },
              { id: "improvement", label: "MELHORIAS" },
              { id: "fix", label: "CORREÇÕES" },
              { id: "hotfix", label: "HOTFIXES" },
            ].map((filter) => (
              <button
                key={filter.id}
                onClick={() => setActiveFilter(filter.id)}
                className={`px-4 py-2 text-xs font-mono border rounded-full transition-all duration-200 uppercase ${
                  activeFilter === filter.id
                    ? "bg-[#0e0e10] text-[#f5f3ef] border-[#0e0e10] shadow-sm"
                    : "bg-white/40 border-[#d9d6d1] text-neutral-600 hover:bg-white hover:text-neutral-900"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <span className="text-xs font-mono text-neutral-400 uppercase mt-2 sm:mt-0">
            {filteredReleases.length}{" "}
            {filteredReleases.length === 1
              ? "versão encontrada"
              : "versões encontradas"}
          </span>
        </div>

        {/* Timeline Grid */}
        <section className="space-y-16">
          {filteredReleases.length > 0 ? (
            filteredReleases.map((release) => (
              <div
                key={release.version}
                className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 group relative pt-4"
              >
                {/* Indicador lateral / Data e Versão */}
                <div className="lg:col-span-3 flex flex-row lg:flex-col items-baseline lg:items-start justify-between lg:justify-start gap-2 border-l-2 border-[#E8511A]/30 lg:border-l-0 pl-4 lg:pl-0 lg:border-t lg:border-[#d9d6d1] lg:pt-6">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-3xl font-mono font-bold tracking-tight text-[#0e0e10]">
                        {release.version}
                      </h2>
                      {release.status === "active" && (
                        <span className="px-2 py-0.5 text-[9px] font-mono font-semibold tracking-wider text-[#E8511A] bg-[#FFF3EE] border border-[#FFE2D0] rounded-sm uppercase">
                          ATUAL
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-mono text-neutral-500 mt-1">
                      {release.date}
                    </p>
                  </div>

                  <div className="mt-0 lg:mt-4">
                    <span
                      className={`text-[10px] font-mono px-2 py-1 rounded-sm uppercase border ${
                        release.type === "major"
                          ? "border-[#FFE2D0] bg-[#FFF3EE] text-[#E8511A]"
                          : "border-neutral-200 bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {release.type === "major"
                        ? "Major release"
                        : release.type === "minor"
                          ? "Minor Update"
                          : "Patch Fix"}
                    </span>
                  </div>
                </div>

                {/* Conteúdo Detalhado */}
                <div className="lg:col-span-9 lg:border-t lg:border-[#d9d6d1] lg:pt-6">
                  <div className="max-w-3xl">
                    {/* Headline da Versão */}
                    <h3 className="text-xl sm:text-2xl font-bold text-neutral-900 mb-3 tracking-tight">
                      {release.headline}
                    </h3>

                    {/* Descrição Geral */}
                    <p className="text-neutral-600 leading-relaxed text-sm mb-8">
                      {release.description}
                    </p>

                    {/* Lista de Alterações Modulares */}
                    <div className="space-y-3">
                      {release.items.map((item, index) => {
                        const cfg = TYPE_CONFIG[item.type];
                        return (
                          <div
                            key={index}
                            className="flex gap-4 p-4 bg-white/70 hover:bg-white border border-[#d9d6d1]/80 hover:border-[#d0cdc7] rounded-xl transition-all duration-200 shadow-sm group"
                          >
                            <img
                              src={cfg.icon}
                              alt={cfg.label}
                              className="w-16 h-16 shrink-0 self-center select-none"
                              draggable={false}
                            />

                            {/* Conteúdo */}
                            <div className="min-w-0 flex-1 flex flex-col justify-center">
                              <span
                                className="mb-0.5 block text-xs font-semibold tracking-wide"
                                style={{
                                  background: cfg.textGradient,
                                  WebkitBackgroundClip: "text",
                                  WebkitTextFillColor: "transparent",
                                  backgroundClip: "text",
                                }}
                              >
                                {cfg.label}
                              </span>
                              <span className="mb-2 block text-[10px] font-mono text-neutral-400 tracking-wider">
                                {item.tag}
                              </span>
                              <p className="text-sm text-neutral-700 leading-relaxed font-light">
                                {item.description}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-20 bg-white/40 border border-dashed border-[#d9d6d1] rounded-2xl">
              <p className="text-neutral-500 font-mono text-sm">
                Nenhum update corresponde ao filtro selecionado.
              </p>
              <button
                onClick={() => setActiveFilter("all")}
                className="mt-4 text-xs font-mono text-[#E8511A] hover:underline"
              >
                Limpar filtros
              </button>
            </div>
          )}
        </section>

        {/* Footer da Página */}
        <footer className="mt-32 pt-8 border-t border-[#d9d6d1] flex flex-col sm:flex-row justify-between items-center gap-4 text-xs font-mono text-neutral-500">
          <div>
            <p>
              © {new Date().getFullYear()} Its Time CRM. Todos os direitos
              reservados.
            </p>
          </div>
          <div className="flex gap-4">
            <Link to="/" className="hover:text-neutral-900 transition-colors">
              Acessar App
            </Link>
            <a
              href="https://itstime.com.br"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-neutral-900 transition-colors"
            >
              Página Principal
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
