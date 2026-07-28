import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  HelpCircle,
  MapPin,
  MessageSquare,
  Search,
  Sparkles,
  UserCheck,
  Users,
} from "lucide-react";

export default function AgendaGuide() {
  const [activeTab, setActiveTab] = useState<number>(1);

  return (
    <div className="min-h-screen bg-[#f5f3ef] text-[#0e0e10] font-sans antialiased relative selection:bg-[#FFE2D0] selection:text-[#E8511A]">
      {/* Grade fina Swiss no fundo */}
      <div
        className="absolute inset-0 overflow-hidden pointer-events-none opacity-40"
        aria-hidden="true"
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(#d0cdc7 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
      </div>

      {/* Header Sticky */}
      <header className="sticky top-0 z-50 bg-[#f5f3ef]/90 backdrop-blur-md border-b border-[#d9d6d1] py-4">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/updates"
              className="flex items-center gap-2 mr-2 group text-sm font-mono text-neutral-600 hover:text-neutral-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
              <span>Updates</span>
            </Link>

            <div className="hidden sm:block w-[1px] h-5 bg-neutral-300 mx-1" />

            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-[#080808] flex items-center justify-center shadow-[4px_4px_0_rgba(232,81,26,0.94)]">
                <Calendar className="w-3.5 h-3.5 text-[#f5f3ef]" />
              </div>
              <span className="font-mono text-base font-bold tracking-tight">
                Guia do Usuário: Empresa & Agenda
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/calendar"
              className="flex items-center gap-1.5 px-4 py-2 bg-[#E8511A] hover:bg-[#FF6848] text-white rounded-full text-xs font-mono font-bold transition-all shadow-sm"
            >
              <span>Ir para a Agenda</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-12 relative z-10">
        {/* Hero Section */}
        <section className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#FFF3EE] border border-[#FFE2D0] rounded-full text-xs font-mono text-[#E8511A] mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Versão 2.4.0 — Manual Oficial de Uso</span>
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-[#0e0e10] tracking-tight mb-4 leading-tight">
            Como operar o Módulo Multi-Empresas com a Nova Agenda
          </h1>

          <p className="text-base sm:text-lg text-neutral-600 max-w-3xl font-light leading-relaxed">
            Aprenda a cadastrar filiais, associar profissionais e serviços por unidade, gerenciar agendamentos por fuso horário local e permitir que a Inteligência Artificial agende consultas automaticamente.
          </p>
        </section>

        {/* NAVEGAÇÃO POR PASSO A PASSO (TABS) */}
        <div className="flex flex-wrap gap-2 mb-8 border-b border-[#d9d6d1] pb-4">
          {[
            { id: 1, label: "1. Cadastrar Empresas", icon: Building2 },
            { id: 2, label: "2. Profissionais & Serviços", icon: Users },
            { id: 3, label: "3. Operar a Nova Agenda", icon: Calendar },
            { id: 4, label: "4. Agendamento com IA", icon: MessageSquare },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-mono text-xs transition-all ${
                  isActive
                    ? "bg-[#E8511A] text-white shadow-sm font-bold"
                    : "bg-white/60 hover:bg-white text-neutral-700 border border-[#d9d6d1]"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-white" : "text-neutral-500"}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* PASSO 1: CADASTRAR EMPRESAS */}
        {activeTab === 1 && (
          <div className="space-y-8 animate-fadeIn">
            <div className="bg-white rounded-2xl p-6 sm:p-8 border border-[#d9d6d1] shadow-sm">
              <div className="max-w-3xl mb-6">
                <span className="text-xs font-mono text-[#E8511A] uppercase tracking-wider font-semibold">
                  Passo 1 de 4
                </span>
                <h2 className="text-2xl font-bold text-neutral-900 mt-1 mb-3">
                  Cadastrando Filiais, CNPJ e Fusos Horários
                </h2>
                <p className="text-sm text-neutral-600 leading-relaxed font-light">
                  Acesse <strong>Configurações / Admin &gt; Empresas</strong> para adicionar suas unidades comerciais. O sistema valida automaticamente a estrutura do CNPJ e ajusta a agenda no fuso horário específico de cada filial.
                </p>
              </div>

              {/* MOCKUP VISUAL DA TELA DO APP (PRINT LIGHT MODE) */}
              <div className="rounded-xl border border-neutral-300 bg-white overflow-hidden shadow-lg">
                {/* Janela de Navegador Simulada (Light Mode) */}
                <div className="bg-neutral-100 px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-400 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-amber-400 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-emerald-400 inline-block" />
                    <span className="text-xs font-mono text-neutral-600 ml-2 bg-white px-3 py-0.5 rounded border border-neutral-200 shadow-2xs">
                      https://app.itstime.com.br/admin (Empresas)
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-semibold">
                    TELA DO APP
                  </span>
                </div>

                {/* Conteúdo Interno Simulado (Light Mode) */}
                <div className="p-6 bg-[#faf9f6] text-neutral-900 font-sans space-y-6">
                  {/* Top Bar */}
                  <div className="flex items-center justify-between pb-4 border-b border-neutral-200">
                    <div>
                      <h3 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-[#E8511A]" />
                        Gerenciador de Empresas & Filiais
                      </h3>
                      <p className="text-xs text-neutral-500">
                        3 unidades ativas cadastradas
                      </p>
                    </div>
                    <button className="px-3 py-1.5 bg-[#E8511A] text-white text-xs font-mono rounded-lg flex items-center gap-1.5 shadow-sm font-semibold">
                      <span>+ Nova Empresa</span>
                    </button>
                  </div>

                  {/* Formulário / Modal em Destaque */}
                  <div className="bg-white border border-neutral-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4 shadow-sm">
                    <div>
                      <label className="text-[11px] font-mono text-neutral-600 block mb-1 font-medium">
                        CNPJ da Empresa *
                      </label>
                      <div className="relative">
                        <input
                          readOnly
                          value="12.345.678/0001-90"
                          className="w-full bg-emerald-50/50 border border-emerald-500 text-emerald-800 text-xs rounded-lg p-2.5 font-mono font-semibold"
                        />
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 absolute right-3 top-2.5" />
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-mono text-neutral-600 block mb-1 font-medium">
                        Nome Fantasia da Unidade *
                      </label>
                      <input
                        readOnly
                        value="Matriz São Paulo - Jardins"
                        className="w-full bg-white border border-neutral-300 text-neutral-900 text-xs rounded-lg p-2.5 font-medium"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-mono text-neutral-600 block mb-1 font-medium">
                        Cidade / UF *
                      </label>
                      <input
                        readOnly
                        value="São Paulo / SP"
                        className="w-full bg-white border border-neutral-300 text-neutral-900 text-xs rounded-lg p-2.5 font-medium"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-mono text-neutral-600 block mb-1 font-medium">
                        Fuso Horário Local *
                      </label>
                      <input
                        readOnly
                        value="Brasília (UTC-03:00)"
                        className="w-full bg-orange-50/60 border border-[#FFE2D0] text-[#E8511A] text-xs rounded-lg p-2.5 font-mono font-bold"
                      />
                    </div>
                  </div>

                  {/* Lista de Filiais */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                    <div className="bg-white border border-neutral-200 p-3.5 rounded-xl flex items-center justify-between shadow-2xs">
                      <div>
                        <p className="text-xs font-bold text-neutral-900">Matriz São Paulo</p>
                        <p className="text-[10px] font-mono text-neutral-500">CNPJ: 12.345.678/0001-90</p>
                      </div>
                      <span className="text-[9px] font-mono px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded font-semibold">
                        Ativa
                      </span>
                    </div>

                    <div className="bg-white border border-neutral-200 p-3.5 rounded-xl flex items-center justify-between shadow-2xs">
                      <div>
                        <p className="text-xs font-bold text-neutral-900">Filial Rio de Janeiro</p>
                        <p className="text-[10px] font-mono text-neutral-500">CNPJ: 98.765.432/0001-10</p>
                      </div>
                      <span className="text-[9px] font-mono px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded font-semibold">
                        Ativa
                      </span>
                    </div>

                    <div className="bg-white border border-neutral-200 p-3.5 rounded-xl flex items-center justify-between shadow-2xs">
                      <div>
                        <p className="text-xs font-bold text-neutral-900">Unidade Manaus</p>
                        <p className="text-[10px] font-mono text-neutral-500">CNPJ: 55.443.221/0001-88</p>
                      </div>
                      <span className="text-[9px] font-mono px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded font-semibold">
                        UTC-4
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PASSO 2: PROFISSIONAIS E SERVIÇOS */}
        {activeTab === 2 && (
          <div className="space-y-8 animate-fadeIn">
            <div className="bg-white rounded-2xl p-6 sm:p-8 border border-[#d9d6d1] shadow-sm">
              <div className="max-w-3xl mb-6">
                <span className="text-xs font-mono text-[#E8511A] uppercase tracking-wider font-semibold">
                  Passo 2 de 4
                </span>
                <h2 className="text-2xl font-bold text-neutral-900 mt-1 mb-3">
                  Vinculando Profissionais e Serviços às Empresas
                </h2>
                <p className="text-sm text-neutral-600 leading-relaxed font-light">
                  Acesse <strong>Agenda &gt; Configurações ⚙️</strong> para associar cada membro da equipe às unidades onde atende, além de definir preços, durações e prazos de preparo (buffer) por serviço.
                </p>
              </div>

              {/* MOCKUP VISUAL PRINT 2 LIGHT MODE */}
              <div className="rounded-xl border border-neutral-300 bg-white overflow-hidden shadow-lg">
                <div className="bg-neutral-100 px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-400 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-amber-400 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-emerald-400 inline-block" />
                    <span className="text-xs font-mono text-neutral-600 ml-2 bg-white px-3 py-0.5 rounded border border-neutral-200 shadow-2xs">
                      https://app.itstime.com.br/calendar/settings
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-semibold">
                    TELA DO APP
                  </span>
                </div>

                <div className="p-6 bg-[#faf9f6] text-neutral-900 font-sans space-y-6">
                  {/* Tabs internas */}
                  <div className="flex items-center gap-6 border-b border-neutral-200 pb-3">
                    <span className="text-xs font-mono text-[#E8511A] font-bold border-b-2 border-[#E8511A] pb-3 -mb-3">
                      Profissionais
                    </span>
                    <span className="text-xs font-mono text-neutral-500 font-medium pb-3">
                      Serviços & Tarifas
                    </span>
                    <span className="text-xs font-mono text-neutral-500 font-medium pb-3">
                      Regras Gerais
                    </span>
                  </div>

                  {/* Card do Profissional */}
                  <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[#FFF3EE] border border-[#FFE2D0] flex items-center justify-center text-xs font-mono font-bold text-[#E8511A]">
                          CR
                        </div>
                        <div>
                          <p className="text-sm font-bold text-neutral-900">Dra. Camila Rocha</p>
                          <p className="text-xs text-neutral-500">Especialista Comercial / Atendimento</p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 text-[10px] font-mono bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full font-semibold">
                        Atendimento Ativo
                      </span>
                    </div>

                    <div className="pt-3 border-t border-neutral-100">
                      <p className="text-[11px] font-mono text-neutral-500 mb-2 font-medium">
                        Empresas / Unidades de Atendimento Vinculadas:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <span className="px-2.5 py-1 bg-[#FFF3EE] text-[#E8511A] border border-[#FFE2D0] rounded-lg text-xs font-mono font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Matriz SP (Jardins)
                        </span>
                        <span className="px-2.5 py-1 bg-[#FFF3EE] text-[#E8511A] border border-[#FFE2D0] rounded-lg text-xs font-mono font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Filial Rio de Janeiro
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Lista de Serviços */}
                  <div className="bg-white border border-neutral-200 rounded-xl p-4 space-y-3 shadow-sm">
                    <p className="text-xs font-bold text-neutral-700 uppercase tracking-wider font-mono">
                      Serviços Ofertados
                    </p>
                    <div className="flex items-center justify-between p-3.5 bg-[#faf9f6] rounded-xl border border-neutral-200">
                      <div>
                        <p className="text-xs font-bold text-neutral-900">Consulta Avaliativa Inicial</p>
                        <p className="text-[10px] font-mono text-neutral-500">Duração: 30 minutos • Intervalo: 10 min</p>
                      </div>
                      <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">
                        R$ 150,00
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PASSO 3: OPERAR A AGENDA */}
        {activeTab === 3 && (
          <div className="space-y-8 animate-fadeIn">
            <div className="bg-white rounded-2xl p-6 sm:p-8 border border-[#d9d6d1] shadow-sm">
              <div className="max-w-3xl mb-6">
                <span className="text-xs font-mono text-[#E8511A] uppercase tracking-wider font-semibold">
                  Passo 3 de 4
                </span>
                <h2 className="text-2xl font-bold text-neutral-900 mt-1 mb-3">
                  Operando a Nova Agenda Multi-Unidade
                </h2>
                <p className="text-sm text-neutral-600 leading-relaxed font-light">
                  Alterne facilmente a visão da agenda entre <strong>Empresas Específicas</strong> ou <strong>Visão Global</strong>. Visualize os horários livres, marque compromissos manuais e envie notificações por WhatsApp com 1 clique.
                </p>
              </div>

              {/* MOCKUP VISUAL PRINT 3 LIGHT MODE */}
              <div className="rounded-xl border border-neutral-300 bg-white overflow-hidden shadow-lg">
                <div className="bg-neutral-100 px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-400 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-amber-400 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-emerald-400 inline-block" />
                    <span className="text-xs font-mono text-neutral-600 ml-2 bg-white px-3 py-0.5 rounded border border-neutral-200 shadow-2xs">
                      https://app.itstime.com.br/calendar
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-semibold">
                    TELA DO APP
                  </span>
                </div>

                <div className="p-6 bg-[#faf9f6] text-neutral-900 font-sans space-y-6">
                  {/* Seletor de Empresa e Controles na Topbar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-white rounded-xl border border-neutral-200 shadow-2xs">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-neutral-500 font-medium">Filtrar Empresa:</span>
                      <div className="px-3 py-1.5 bg-[#FFF3EE] border border-[#E8511A] rounded-lg text-xs font-mono text-[#E8511A] font-bold flex items-center gap-2 shadow-2xs">
                        <Building2 className="w-3.5 h-3.5" />
                        <span>Matriz SP (Jardins)</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1.5 bg-neutral-100 border border-neutral-200 rounded-lg text-xs font-mono text-neutral-700 font-semibold">
                        Visão: Semana
                      </span>
                      <button className="px-3 py-1.5 bg-[#E8511A] text-white rounded-lg text-xs font-mono font-bold shadow-sm">
                        + Novo Agendamento
                      </button>
                    </div>
                  </div>

                  {/* Grade de Horários */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-white border border-neutral-200 p-4 rounded-xl space-y-2 shadow-sm border-l-4 border-l-emerald-500">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-neutral-500 font-semibold">09:00 - 09:30</span>
                        <span className="text-[9px] font-mono px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded font-bold">
                          Confirmado
                        </span>
                      </div>
                      <p className="text-sm font-bold text-neutral-900">Ana Silva</p>
                      <p className="text-[11px] text-neutral-500">Consulta Avaliativa • Dra. Camila</p>
                    </div>

                    <div className="bg-white border border-neutral-200 p-4 rounded-xl space-y-2 shadow-sm border-l-4 border-l-amber-500">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-neutral-500 font-semibold">10:00 - 10:45</span>
                        <span className="text-[9px] font-mono px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded font-bold">
                          Agendado
                        </span>
                      </div>
                      <p className="text-sm font-bold text-neutral-900">Carlos Eduardo</p>
                      <p className="text-[11px] text-neutral-500">Exame Clínico • Dra. Camila</p>
                    </div>

                    <div className="bg-white border border-neutral-200 p-4 rounded-xl space-y-2 shadow-sm border-l-4 border-l-blue-500">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-neutral-500 font-semibold">14:00 - 14:30</span>
                        <span className="text-[9px] font-mono px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded font-bold">
                          Lembrete Enviado 💬
                        </span>
                      </div>
                      <p className="text-sm font-bold text-neutral-900">Beatriz Souza</p>
                      <p className="text-[11px] text-neutral-500">Retorno • Dra. Camila</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PASSO 4: AGENDAMENTO COM IA */}
        {activeTab === 4 && (
          <div className="space-y-8 animate-fadeIn">
            <div className="bg-white rounded-2xl p-6 sm:p-8 border border-[#d9d6d1] shadow-sm">
              <div className="max-w-3xl mb-6">
                <span className="text-xs font-mono text-[#E8511A] uppercase tracking-wider font-semibold">
                  Passo 4 de 4
                </span>
                <h2 className="text-2xl font-bold text-neutral-900 mt-1 mb-3">
                  Agendamento Automático via IA Cognitiva
                </h2>
                <p className="text-sm text-neutral-600 leading-relaxed font-light">
                  Seus Agentes de IA agora entendem a localização desejada do cliente no WhatsApp ou Instagram, verificam a agenda da unidade no fuso local e marcam compromissos em segundos sem risco de duplicação.
                </p>
              </div>

              {/* MOCKUP VISUAL PRINT 4 - CHAT OFICIAL DO CRM */}
              <div className="rounded-2xl border border-neutral-300 bg-white overflow-hidden shadow-xl max-w-2xl mx-auto">
                {/* Header do Chat (Identidade Oficial do App) */}
                <div className="bg-white px-5 py-3 border-b border-neutral-200 flex items-center justify-between shadow-2xs">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full border border-neutral-200 bg-neutral-100 font-bold text-xs text-neutral-700 flex items-center justify-center shadow-2xs">
                      E
                    </div>
                    <div>
                      <p className="text-xs font-extrabold text-neutral-900 tracking-tight">express baterias</p>
                      <p className="text-[9px] font-mono text-neutral-400 font-bold tracking-widest uppercase">
                        ATENDIMENTO AUTOMÁTICO • WHATSAPP
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 text-neutral-500">
                    <Calendar className="w-4 h-4 hover:text-neutral-800 transition-colors" />
                    <Sparkles className="w-4 h-4 text-[#E8511A]" />
                    <HelpCircle className="w-4 h-4 hover:text-neutral-800 transition-colors" />
                  </div>
                </div>

                {/* Área de Mensagens do Chat (Fundo Soft UI) */}
                <div className="p-6 bg-[#f8f7f4] text-xs font-sans space-y-4">
                  {/* Divisor de Data */}
                  <div className="flex justify-center">
                    <span className="px-3 py-0.5 bg-neutral-200/70 text-neutral-600 text-[10px] font-mono font-bold uppercase rounded-full tracking-wider">
                      HOJE
                    </span>
                  </div>

                  {/* Mensagem Recebida (Cliente - Esquerda, Balão Branco) */}
                  <div className="bg-white text-neutral-800 p-4 rounded-2xl rounded-tl-xs shadow-sm border border-neutral-200/80 max-w-[80%] space-y-1">
                    <p className="text-xs leading-relaxed">
                      Olá, gostaria de agendar uma avaliação para quinta-feira na unidade de São Paulo.
                    </p>
                    <span className="text-[10px] font-mono text-neutral-400 block text-right font-medium">09:00</span>
                  </div>

                  {/* Mensagem Enviada (Agente de IA - Direita, Balão Laranja Oficial) */}
                  <div className="bg-[#E8511A] text-white p-4 rounded-2xl rounded-tr-xs shadow-sm max-w-[82%] ml-auto space-y-1">
                    <p className="text-xs leading-relaxed">
                      Olá! Com certeza! Tenho horário disponível com a Dra. Camila às 14:30 na Matriz São Paulo (Jardins). Posso confirmar para você?
                    </p>
                    <span className="text-[10px] font-mono text-orange-200 block text-right font-medium">09:00</span>
                  </div>

                  {/* Mensagem Recebida (Cliente) */}
                  <div className="bg-white text-neutral-800 p-4 rounded-2xl rounded-tl-xs shadow-sm border border-neutral-200/80 max-w-[80%] space-y-1">
                    <p className="text-xs leading-relaxed">Pode sim, por favor!</p>
                    <span className="text-[10px] font-mono text-neutral-400 block text-right font-medium">09:01</span>
                  </div>

                  {/* Mensagem Enviada (Confirmação Agente IA) */}
                  <div className="bg-[#E8511A] text-white p-4 rounded-2xl rounded-tr-xs shadow-sm max-w-[82%] ml-auto space-y-2">
                    <p className="text-xs leading-relaxed">
                      Olá! Recebi sua mensagem. Como posso ajudar a Express Baterias hoje?
                    </p>
                    <div className="pt-2 border-t border-orange-400/40 space-y-1 text-xs">
                      <p className="font-bold text-white">✅ Agendamento Confirmado!</p>
                      <p>📅 Data: Quinta-feira, 31/07 às 14:30</p>
                      <p>🏢 Local: Matriz São Paulo - Rua Oscar Freire, 1200</p>
                      <p className="text-[10px] text-orange-100 font-medium pt-1">
                        Enviaremos um lembrete automático 1h antes do seu horário.
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-orange-200 block text-right font-medium">09:01</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Call to Action (Light Mode) */}
        <section className="mt-12 bg-gradient-to-r from-orange-50/80 via-white to-orange-50/40 border border-[#FFE2D0] rounded-2xl p-8 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-sm">
          <div>
            <h3 className="text-xl font-extrabold text-neutral-900 mb-2">Pronto para testar na prática?</h3>
            <p className="text-sm text-neutral-600 font-normal">
              Acesse a Nova Agenda do seu sistema e configure suas empresas agora mesmo.
            </p>
          </div>

          <div className="flex gap-3">
            <Link
              to="/calendar"
              className="px-6 py-3 bg-[#E8511A] hover:bg-[#FF6848] text-white font-mono text-xs font-bold rounded-xl transition-all shadow-sm"
            >
              Ir para a Agenda -&gt;
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
