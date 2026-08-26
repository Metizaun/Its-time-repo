import { useEffect, type ReactNode } from "react";
import { ArrowLeft, ExternalLink, FileText, Mail, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

type DocumentKind = "privacy" | "terms";

type Section = {
  id: string;
  title: string;
  content: ReactNode;
};

const company = "ITS TIME TECH LTDA";
const companyEmail = "matheus@itstime.pro";
const companyAddress =
  "Av. Cristóvão Colombo, 2144, Sala 408, Andar 3, Floresta, Porto Alegre/RS, CEP 90560-001";

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-[var(--color-primary-600)]">
      <span aria-hidden="true" className="h-0.5 w-5 bg-[var(--color-primary-500)]" />
      {children}
    </p>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 list-disc space-y-2 pl-5 text-[var(--color-gray-700)] marker:text-[var(--color-primary-500)]">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

const privacySections: Section[] = [
  {
    id: "quem-somos",
    title: "Quem somos",
    content: (
      <>
        <p>
          Esta Política explica como a <strong>{company}</strong>, CNPJ
          68.427.775/0001-81, trata dados pessoais no contexto da plataforma Its
          Time CRM, disponível em app.itstime.pro.
        </p>
        <p className="mt-4">
          Somos uma empresa de tecnologia que oferece gestão de relacionamento,
          atendimento e automação para empresas.
        </p>
      </>
    ),
  },
  {
    id: "papeis",
    title: "Papéis e titulares",
    content: (
      <>
        <p>
          Para dados de cadastro, autenticação, segurança, suporte, faturamento
          e uso da própria plataforma, a Its Time atua como <strong>Controladora</strong>.
        </p>
        <p className="mt-4">
          Para dados de clientes, pacientes e contatos inseridos ou recebidos
          pela empresa contratante, a Its Time normalmente atua como
          <strong> Operadora</strong>, e a empresa contratante é a
          <strong> Controladora</strong>. Pedidos sobre esses dados devem ser
          direcionados primeiro à empresa com a qual o titular se relacionou.
        </p>
      </>
    ),
  },
  {
    id: "dados",
    title: "Dados tratados",
    content: (
      <>
        <p>Dependendo da conta e das funcionalidades, podemos tratar:</p>
        <BulletList
          items={[
            "nome, e-mail, telefone, credenciais protegidas e perfil de acesso;",
            "mensagens, imagens, áudios, documentos e metadados de atendimento;",
            "origem do contato, etiquetas, anotações, oportunidades e agendamentos;",
            "registros técnicos, ações realizadas e informações de segurança; e",
            "identificadores, configurações e status de integrações.",
          ]}
        />
        <p className="mt-4">
          Funcionalidades opcionais podem receber receitas ou imagens. Receitas
          podem conter dados de saúde. Imagens faciais são dados pessoais e
          podem adquirir natureza biométrica sensível conforme o processamento.
        </p>
      </>
    ),
  },
  {
    id: "finalidades",
    title: "Finalidades e bases legais",
    content: (
      <>
        <p>Os dados podem ser tratados para:</p>
        <BulletList
          items={[
            "criar contas, autenticar usuários, controlar permissões e prestar suporte;",
            "receber, organizar e responder atendimentos;",
            "sincronizar mensagens e status de integrações;",
            "gerenciar leads, oportunidades, agendamentos e equipes;",
            "proteger a plataforma, prevenir fraude, corrigir falhas e cumprir obrigações; e",
            "usar transcrição, resumo, classificação ou sugestão de resposta quando habilitados.",
          ]}
        />
        <p className="mt-4">
          A base legal varia conforme a finalidade e pode incluir contrato,
          obrigação legal, exercício de direitos, legítimo interesse,
          consentimento ou outra hipótese da LGPD. Nos dados da empresa
          contratante, a base legal é definida por ela.
        </p>
      </>
    ),
  },
  {
    id: "ia",
    title: "WhatsApp, Meta e inteligência artificial",
    content: (
      <>
        <p>
          Canais conectados podem envolver Meta, WhatsApp Business e parceiros
          como a Gupshup. Recursos de IA podem apoiar transcrição, compreensão de
          mensagens, organização, classificação e elaboração de respostas.
        </p>
        <p className="mt-4">
          Os resultados podem conter erros. A empresa contratante deve
          supervisionar o atendimento e revisar informações sensíveis ou
          relevantes. Quando houver decisão tomada unicamente por meios
          automatizados que afete interesses do titular, serão observados os
          direitos de informação e revisão previstos na LGPD, quando aplicável.
        </p>
      </>
    ),
  },
  {
    id: "compartilhamento",
    title: "Compartilhamento e transferência internacional",
    content: (
      <>
        <p>
          Não vendemos dados pessoais. O compartilhamento pode ocorrer com a
          empresa contratante, usuários autorizados, provedores de integração,
          hospedagem, banco de dados, armazenamento, suporte e processamento
          automatizado, ou autoridades competentes quando exigido.
        </p>
        <p className="mt-4">
          Alguns fornecedores podem processar dados fora do Brasil. A
          transferência internacional observará a LGPD e a regulamentação da
          ANPD, com finalidade, necessidade, transparência, segurança e direitos
          compatíveis. A lista de fornecedores, destinos e mecanismos aplicáveis
          deve ser mantida atualizada conforme os serviços realmente utilizados.
        </p>
      </>
    ),
  },
  {
    id: "retencao-seguranca",
    title: "Retenção e segurança",
    content: (
      <>
        <p>
          Conservamos os dados pelo período necessário às finalidades, ao
          contrato, às obrigações legais e ao exercício regular de direitos.
          Prazos variam por categoria, finalidade, conta e obrigação aplicável.
        </p>
        <p className="mt-4">
          Adotamos medidas compatíveis com o risco, incluindo controle de
          acesso, segregação lógica entre contas, proteção de credenciais,
          criptografia em trânsito, monitoramento e resposta a incidentes.
          Nenhum sistema é completamente imune a riscos.
        </p>
      </>
    ),
  },
  {
    id: "direitos",
    title: "Direitos do titular",
    content: (
      <>
        <p>Conforme aplicável, o titular pode solicitar:</p>
        <BulletList
          items={[
            "confirmação da existência e acesso aos dados;",
            "correção, anonimização, bloqueio ou eliminação;",
            "informações sobre finalidades e compartilhamentos;",
            "portabilidade, observada a regulamentação aplicável;",
            "revogação do consentimento; e",
            "revisão de decisões tomadas unicamente por meios automatizados.",
          ]}
        />
        <p className="mt-4">
          Solicitações devem ser enviadas para{" "}
          <a className="font-semibold text-[var(--color-primary-600)] underline underline-offset-4" href={"mailto:" + companyEmail}>
            {companyEmail}
          </a>
          . Podemos solicitar dados para confirmar a identidade. Quando a Its
          Time for Operadora, encaminharemos o pedido à Controladora.
        </p>
      </>
    ),
  },
  {
    id: "contato",
    title: "Cookies, encarregado e contato",
    content: (
      <>
        <p>
          Utilizamos cookies e armazenamento local necessários para sessão,
          segurança, preferências e funcionamento da interface. Não usamos
          cookies de publicidade comportamental nesta aplicação.
        </p>
        <div className="mt-4 rounded-xl border border-border bg-[var(--color-surface-2)] p-4 text-[var(--color-gray-700)]">
          <p className="font-semibold text-[var(--color-gray-900)]">
            Encarregado: Lucas Matheus Ribeiro da Silva
          </p>
          <p className="mt-1">{companyEmail}</p>
          <p className="mt-1">{companyAddress}</p>
        </div>
      </>
    ),
  },
  {
    id: "alteracoes",
    title: "Alterações",
    content: (
      <p>
        Esta Política pode ser atualizada para refletir mudanças na plataforma,
        nos fornecedores ou na legislação. A versão vigente estará disponível
        nesta página, com a data de atualização.
      </p>
    ),
  },
];

const termsSections: Section[] = [
  {
    id: "contratacao",
    title: "Contratação e licença",
    content: (
      <>
        <p>
          Estes Termos regulam o uso da plataforma Its Time CRM pela pessoa
          jurídica contratante. A Its Time concede licença limitada, não
          exclusiva e intransferível conforme o plano, proposta ou contrato.
        </p>
        <p className="mt-4">
          A contratação específica deve ser aceita por pessoa com poderes para
          obrigar a Contratante.
        </p>
      </>
    ),
  },
  {
    id: "uso",
    title: "Uso aceitável e contas",
    content: (
      <>
        <p>
          A Contratante deve usar o sistema de forma lícita, manter credenciais
          individuais, remover usuários desligados e revisar permissões.
        </p>
        <BulletList
          items={[
            "não realizar engenharia reversa;",
            "não compartilhar credenciais;",
            "não enviar spam ou conteúdo ilícito; e",
            "não contornar controles técnicos ou de segurança.",
          ]}
        />
      </>
    ),
  },
  {
    id: "integracoes",
    title: "WhatsApp e integrações",
    content: (
      <p>
        A plataforma pode oferecer integrações com WhatsApp Business, Meta,
        Gupshup e outros provedores. A Contratante deve obter autorizações,
        respeitar opt-in, templates, janelas de atendimento e políticas dos
        canais. A disponibilidade depende também desses provedores.
      </p>
    ),
  },
  {
    id: "dados",
    title: "Proteção de dados",
    content: (
      <>
        <p>
          Para dados de clientes, pacientes e contatos da Contratante, a
          Contratante é a Controladora e a Its Time normalmente é a Operadora,
          conforme instruções documentadas e o DPA.
        </p>
        <p className="mt-4">
          A Contratante define finalidades e bases legais, fornece transparência,
          atende titulares, obtém autorizações quando necessárias, insere dados
          licitamente e configura automações de forma compatível com a lei.
        </p>
      </>
    ),
  },
  {
    id: "recursos-automatizados",
    title: "Recursos automatizados",
    content: (
      <p>
        Algumas funcionalidades usam IA para transcrição, organização,
        classificação, resumo e sugestão de respostas. Os resultados são
        probabilísticos. A Contratante deve revisar informações sensíveis ou
        relevantes e responde pelo conteúdo enviado em seu nome.
      </p>
    ),
  },
  {
    id: "seguranca",
    title: "Segurança, dados e confidencialidade",
    content: (
      <p>
        Cada parte deve proteger as informações confidenciais da outra. A Its
        Time adotará medidas técnicas e administrativas compatíveis com o risco,
        conforme o DPA e a realidade do serviço. Dados efetivamente agregados e
        anonimizados podem ser usados para estatísticas e melhoria do produto,
        sem identificar titulares.
      </p>
    ),
  },
  {
    id: "encerramento",
    title: "Disponibilidade e encerramento",
    content: (
      <p>
        Empregamos esforços razoáveis para manter a plataforma disponível, mas
        não garantimos operação contínua ou livre de falhas. No encerramento, a
        exportação, devolução, eliminação ou conservação dos dados seguirá a
        contratação, o DPA e os fundamentos legais aplicáveis.
      </p>
    ),
  },
  {
    id: "alteracoes-contato",
    title: "Alterações e contato",
    content: (
      <>
        <p>
          Podemos atualizar estes Termos para refletir mudanças na plataforma,
          fornecedores ou legislação. A versão vigente ficará disponível nesta
          página e alterações materiais serão comunicadas quando aplicável.
        </p>
        <div className="mt-4 rounded-xl border border-border bg-[var(--color-surface-2)] p-4 text-[var(--color-gray-700)]">
          <p className="font-semibold text-[var(--color-gray-900)]">{company}</p>
          <p className="mt-1">CNPJ 68.427.775/0001-81</p>
          <p className="mt-1">{companyAddress}</p>
          <p className="mt-2">{companyEmail}</p>
        </div>
      </>
    ),
  },
];

const documentConfig: Record<
  DocumentKind,
  { title: string; eyebrow: string; description: string; sections: Section[]; icon: typeof ShieldCheck }
> = {
  privacy: {
    title: "Política de Privacidade",
    eyebrow: "TRANSPARÊNCIA E DADOS",
    description: "Como a Its Time trata dados pessoais no CRM, nos canais de atendimento e nas integrações.",
    sections: privacySections,
    icon: ShieldCheck,
  },
  terms: {
    title: "Termos de Serviço",
    eyebrow: "CONTRATAÇÃO E USO",
    description: "Regras gerais para contratação e uso da plataforma Its Time CRM por empresas.",
    sections: termsSections,
    icon: FileText,
  },
};

export default function LegalDocument({ document: documentKind }: { document: DocumentKind }) {
  const config = documentConfig[documentKind];
  const Icon = config.icon;
  const isPrivacy = documentKind === "privacy";

  useEffect(() => {
    document.title = config.title + " · Its Time CRM";
  }, [config.title]);

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] text-foreground selection:bg-[var(--color-primary-100)] selection:text-[var(--color-primary-700)]">
      <header className="sticky top-0 z-50 border-b border-border bg-[var(--color-surface-overlay)] backdrop-blur-md">
        <div className="mx-auto flex min-h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/auth" className="group inline-flex items-center gap-2 text-sm font-medium text-[var(--color-gray-600)] transition-colors hover:text-[var(--color-gray-900)] focus-visible:shadow-focus">
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
            <span>Voltar para o acesso</span>
          </Link>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-bg-inverse)] shadow-sm" aria-hidden="true">
              <span className="h-2.5 w-2.5 bg-[var(--color-surface-1)]" />
            </div>
            <span className="font-mono text-sm font-bold tracking-wider text-[var(--color-gray-900)]">ITS TIME</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <section className="relative overflow-hidden rounded-2xl border border-border bg-[var(--color-surface-1)] p-6 shadow-sm sm:p-10">
          <div className="absolute inset-x-0 top-0 h-1 bg-[var(--color-primary-500)]" aria-hidden="true" />
          <div className="flex max-w-3xl items-start gap-4">
            <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-50)] text-[var(--color-primary-600)] sm:flex" aria-hidden="true">
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--color-primary-600)]">{config.eyebrow}</p>
              <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-[var(--color-gray-900)] sm:text-5xl">{config.title}</h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--color-gray-600)]">{config.description}</p>
              <p className="mt-6 font-mono text-xs uppercase tracking-wider text-[var(--color-gray-500)]">Versão 1.1 · Última atualização: 25 de agosto de 2026</p>
            </div>
          </div>
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
          <aside className="lg:sticky lg:top-24">
            <nav aria-label={"Índice de " + config.title.toLowerCase()} className="rounded-xl border border-border bg-[var(--color-surface-2)] p-4 shadow-sm">
              <SectionLabel>Índice</SectionLabel>
              <ol className="space-y-2 text-sm">
                {config.sections.map((section, index) => (
                  <li key={section.id}>
                    <a href={"#" + section.id} className="block rounded-md px-2 py-1.5 text-[var(--color-gray-600)] transition-colors hover:bg-[var(--color-surface-1)] hover:text-[var(--color-primary-600)] focus-visible:shadow-focus">
                      <span className="mr-2 font-mono text-xs text-[var(--color-gray-400)]">{String(index + 1).padStart(2, "0")}</span>
                      {section.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>

          <article className="min-w-0 rounded-2xl border border-border bg-[var(--color-surface-1)] px-5 py-8 shadow-sm sm:px-10 sm:py-10">
            <div className="space-y-10">
              {config.sections.map((section, index) => (
                <section key={section.id} id={section.id} className="scroll-mt-24 border-b border-[var(--border-subtle)] pb-8 last:border-b-0 last:pb-0">
                  <SectionLabel>Seção {String(index + 1).padStart(2, "0")}</SectionLabel>
                  <h2 className="text-xl font-bold tracking-tight text-[var(--color-gray-800)] sm:text-2xl">{section.title}</h2>
                  <div className="mt-4 text-[15px] leading-relaxed text-[var(--color-gray-700)]">{section.content}</div>
                </section>
              ))}
            </div>
          </article>
        </div>
      </main>

      <footer className="border-t border-border bg-[var(--color-bg-subtle)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-[var(--color-gray-600)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} Its Time CRM · {company}</p>
          <div className="flex flex-wrap items-center gap-4">
            <Link to={isPrivacy ? "/termos" : "/privacidade"} className="inline-flex items-center gap-1.5 hover:text-[var(--color-primary-600)] focus-visible:shadow-focus">
              {isPrivacy ? "Termos de Serviço" : "Política de Privacidade"}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <a href={"mailto:" + companyEmail} className="inline-flex items-center gap-1.5 hover:text-[var(--color-primary-600)] focus-visible:shadow-focus">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              Contato
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

