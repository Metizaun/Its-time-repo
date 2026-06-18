import type {
  CreateAdvancedTone,
  CreateChip,
  CreateDrafts,
  CreateEmojiUsage,
  CreateMessageType,
  CreatePreset,
  CreateSelectOption,
} from "@/components/Create/types";

export const DEFAULT_DRAFTS: CreateDrafts = {
  whatsapp: {
    subject: "",
    body: "",
  },
  email: {
    subject: "",
    body: "",
  },
  social: {
    subject: "",
    body: "",
  },
};

export const MESSAGE_TYPE_OPTIONS: CreateSelectOption<CreateMessageType>[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail" },
  { value: "social", label: "Texto (Redes Sociais)" },
];

export const PRESET_OPTIONS: CreateSelectOption<CreatePreset>[] = [
  { value: "default", label: "Default" },
  { value: "new", label: "+ Criar novo" },
];

export const ADVANCED_TONE_OPTIONS: CreateSelectOption<CreateAdvancedTone>[] = [
  { value: "corporate", label: "Corporativo" },
  { value: "creative", label: "Criativo" },
  { value: "empathetic", label: "Empatico" },
  { value: "urgent", label: "Urgente" },
];

export const EMOJI_USAGE_OPTIONS: CreateSelectOption<CreateEmojiUsage>[] = [
  { value: "more", label: "Usar mais" },
  { value: "standard", label: "Padrao" },
  { value: "none", label: "Nao usar" },
];

export const CONTENT_TEMPLATE_CHIPS: CreateChip[] = [
  {
    id: "promo-procedimento",
    label: "Promocao [Procedimento] [Mes]",
    template:
      "Temos uma condicao especial de [Procedimento] neste [Mes]. Posso te explicar os detalhes e disponibilidade?",
  },
  {
    id: "consulta-lembrete",
    label: "Lembrete de consulta para [Nome]",
    template:
      "Oi, [Nome]. Passando para lembrar da sua consulta agendada para [Data/Hora]. Caso precise ajustar, me avise por aqui.",
  },
  {
    id: "pos-atendimento",
    label: "Pos-atendimento [Procedimento]",
    template:
      "Como voce esta se sentindo apos o [Procedimento]? Se quiser, posso reforcar os cuidados para os proximos dias.",
  },
  {
    id: "reativacao-paciente",
    label: "Reativacao de pacientes inativos",
    template:
      "Percebemos que faz um tempo desde seu ultimo atendimento. Quer que eu te apresente opcoes para retomar sua rotina de cuidados?",
  },
  {
    id: "confirmacao-agenda",
    label: "Confirmacao de agenda",
    template:
      "Seu horario para [Procedimento] esta reservado. Se precisar alterar, responda esta mensagem e te ajudamos no ajuste.",
  },
];

export const STYLE_TEMPLATE_CHIPS: CreateChip[] = [
  {
    id: "premium",
    label: "Clinica Premium (Elegante)",
    template: "Tom sofisticado, elegante e acolhedor, com foco em seguranca e exclusividade.",
  },
  {
    id: "acessivel",
    label: "Popular/Acessivel (Descontraido)",
    template: "Tom humano, direto e leve, com linguagem simples e amigavel.",
  },
  {
    id: "saude",
    label: "Foco em Saude (Autoridade/Serio)",
    template: "Tom profissional, seguro e orientado por boas praticas de saude.",
  },
  {
    id: "venda-suave",
    label: "Venda consultiva (Sem pressao)",
    template: "Tom consultivo, com perguntas abertas e sem urgencia artificial.",
  },
];

