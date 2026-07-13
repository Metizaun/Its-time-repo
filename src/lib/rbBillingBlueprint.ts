import type { AutomationJourneyPayload, AutomationStepPayload } from "@/hooks/useAutomationJourneys";

const RB_PAYMENT_TYPE_IDS = ["6", "8", "9"];

export type RbBillingStageBlueprint = {
  key: string;
  stageName: string;
  color: string;
  category: "Aberto" | "Ganho" | "Perdido";
  classifierDescription: string;
  classifierPositiveSignals: string[];
  classifierNegativeSignals: string[];
  classifierExamples: string[];
};

export type RbBillingMessageBlueprint = {
  key: string;
  stageName: string;
  journeyName: string;
  rbMessageKind: "reminder" | "charge";
  rbDaysOffset: number;
  gupshupTemplateId: string;
  gupshupTemplateName: string;
  gupshupTemplateLanguage: string;
  gupshupTemplateParams: string[];
  messageTemplate: string;
};

export const RB_BILLING_STAGE_BLUEPRINTS: RbBillingStageBlueprint[] = [
  {
    key: "due_in_2_days",
    stageName: "A vencer (2 dias)",
    color: "#0ea5e9",
    category: "Aberto",
    classifierDescription: "Leads com parcela vencendo em 2 dias e ainda dentro da janela de lembrete.",
    classifierPositiveSignals: [
      "parcela vence em 2 dias",
      "lembrete antes do vencimento",
      "cliente ainda sem atraso",
    ],
    classifierNegativeSignals: [
      "titulo ja venceu",
      "cliente em atendimento humano",
      "fluxo de encerramento",
    ],
    classifierExamples: [
      "Cobrança preventiva antes do vencimento.",
      "Lembrete de pagamento agendado para dois dias antes.",
    ],
  },
  {
    key: "due_today",
    stageName: "Vence hoje",
    color: "#22c55e",
    category: "Aberto",
    classifierDescription: "Leads com titulo vencendo no dia corrente.",
    classifierPositiveSignals: [
      "vencimento hoje",
      "pagamento imediato",
      "alerta de vencimento do dia",
    ],
    classifierNegativeSignals: [
      "titulo atrasado",
      "cliente ja respondeu",
      "etapa de finalizacao",
    ],
    classifierExamples: [
      "Aviso de vencimento para o mesmo dia.",
      "Mensagem curta com Pix disponivel agora.",
    ],
  },
  {
    key: "overdue_1_day",
    stageName: "Atrasado (1 dia)",
    color: "#f59e0b",
    category: "Aberto",
    classifierDescription: "Leads com atraso recente de um dia.",
    classifierPositiveSignals: [
      "um dia em atraso",
      "cobranca recente",
      "titulo vencido ontem",
    ],
    classifierNegativeSignals: [
      "atraso longo",
      "acordo finalizado",
      "cliente sem saldo pendente",
    ],
    classifierExamples: [
      "Primeiro toque apos um dia de atraso.",
      "Mensagem leve para regularizacao rapida.",
    ],
  },
  {
    key: "overdue_4_days",
    stageName: "Cobranca suave (4 dias)",
    color: "#f97316",
    category: "Aberto",
    classifierDescription: "Leads com atraso intermediario que ainda podem responder a uma cobranca mais suave.",
    classifierPositiveSignals: [
      "quatro dias em atraso",
      "cobranca suave",
      "reativacao de contato",
    ],
    classifierNegativeSignals: [
      "atendimento ativo",
      "resolucao concluida",
      "bloqueio de contato",
    ],
    classifierExamples: [
      "Retomada com tom cordial.",
      "Mensagem com foco em manter a conversa aberta.",
    ],
  },
  {
    key: "overdue_10_days",
    stageName: "Atrasado (10 dias)",
    color: "#ef4444",
    category: "Aberto",
    classifierDescription: "Leads com atraso relevante de 10 dias.",
    classifierPositiveSignals: [
      "dez dias em atraso",
      "titulo em cobranca",
      "alerta de inadimplencia",
    ],
    classifierNegativeSignals: [
      "acordo ja ativo",
      "mensagem de conclusao",
      "cliente respondendo em atendimento",
    ],
    classifierExamples: [
      "Cobranca mais firme com referencia ao vencimento.",
      "Mensagem com foco em resolver pendencia longa.",
    ],
  },
  {
    key: "overdue_15_days",
    stageName: "Cobranca critica (15 dias)",
    color: "#7c3aed",
    category: "Aberto",
    classifierDescription: "Leads com atraso alto que exigem cobranca critica e acompanhamento forte.",
    classifierPositiveSignals: [
      "quinze dias em atraso",
      "cobranca critica",
      "necessidade de negociacao",
    ],
    classifierNegativeSignals: [
      "finalizado",
      "sem pendencia",
      "atendimento concluido",
    ],
    classifierExamples: [
      "Mensagem de recuperacao com maior urgencia.",
      "Cobranca critica com linguagem objetiva.",
    ],
  },
  {
    key: "attendance",
    stageName: "Atendimento",
    color: "#14b8a6",
    category: "Aberto",
    classifierDescription: "Leads com conversa humana ativa ou em atendimento operacional.",
    classifierPositiveSignals: [
      "cliente aguardando atendimento",
      "conversa em andamento",
      "resposta humana ativa",
    ],
    classifierNegativeSignals: [
      "titulo encerrado",
      "cobranca concluida",
      "fluxo de aviso automatizado",
    ],
    classifierExamples: [
      "Leads que precisam de atendimento humano.",
      "Fila operacional de contato ativo.",
    ],
  },
  {
    key: "completed",
    stageName: "Finalizado",
    color: "#64748b",
    category: "Ganho",
    classifierDescription: "Leads encerrados com sucesso ou cobranca resolvida.",
    classifierPositiveSignals: [
      "pagamento concluido",
      "acordo finalizado",
      "cobranca encerrada",
    ],
    classifierNegativeSignals: [
      "pendencia aberta",
      "retorno pendente",
      "cobranca em andamento",
    ],
    classifierExamples: [
      "Pagamento confirmado.",
      "Fluxo encerrado com sucesso.",
    ],
  },
];

export const RB_BILLING_MESSAGE_BLUEPRINTS: RbBillingMessageBlueprint[] = [
  {
    key: "due_in_2_days",
    stageName: "A vencer (2 dias)",
    journeyName: "RB Dr Oculos - A vencer (2 dias)",
    rbMessageKind: "reminder",
    rbDaysOffset: 2,
    gupshupTemplateId: "d2687393-bd72-4d1d-a652-d3e41d1830ed",
    gupshupTemplateName: "Dr Oculos | A vencer 2 dias",
    gupshupTemplateLanguage: "pt_BR",
    gupshupTemplateParams: ["nome", "vencimento"],
    messageTemplate:
      "Oi {nome}, tudo bem? Seguimos acompanhando a parcela que vence em {vencimento} e deixamos tudo pronto para sua regularizacao.",
  },
  {
    key: "due_today",
    stageName: "Vence hoje",
    journeyName: "RB Dr Oculos - Vence hoje",
    rbMessageKind: "reminder",
    rbDaysOffset: 0,
    gupshupTemplateId: "5bb297eb-c1f4-4e03-8e62-7f7ed5821782",
    gupshupTemplateName: "Dr Oculos | Vence hoje",
    gupshupTemplateLanguage: "pt_BR",
    gupshupTemplateParams: ["nome", "pix"],
    messageTemplate:
      "Oi {nome}, passando para lembrar que o vencimento e hoje. Se preferir, voce pode usar o Pix {pix} e nos enviar o comprovante.",
  },
  {
    key: "overdue_1_day",
    stageName: "Atrasado (1 dia)",
    journeyName: "RB Dr Oculos - Atrasado 1 dia",
    rbMessageKind: "charge",
    rbDaysOffset: 1,
    gupshupTemplateId: "279e2b9e-523c-4e98-a2f0-059f71cc22a4",
    gupshupTemplateName: "Dr Oculos | Atrasado 1 dia",
    gupshupTemplateLanguage: "pt_BR",
    gupshupTemplateParams: ["nome", "vencimento", "pix"],
    messageTemplate:
      "Oi {nome}, tudo bem? A parcela venceu em {vencimento}. Se quiser resolver agora, o Pix {pix} continua disponivel para facilitar.",
  },
  {
    key: "overdue_4_days",
    stageName: "Cobranca suave (4 dias)",
    journeyName: "RB Dr Oculos - Cobranca suave 4 dias",
    rbMessageKind: "charge",
    rbDaysOffset: 4,
    gupshupTemplateId: "c77f81d7-660b-488c-ba66-8312d1a69784",
    gupshupTemplateName: "Dr Oculos | Cobranca suave 4 dias",
    gupshupTemplateLanguage: "pt_BR",
    gupshupTemplateParams: ["nome"],
    messageTemplate:
      "Oi {nome}, seguimos por aqui para te ajudar a regularizar a pendencia com tranquilidade. Se precisar de uma nova orientacao, estamos disponiveis.",
  },
  {
    key: "overdue_10_days",
    stageName: "Atrasado (10 dias)",
    journeyName: "RB Dr Oculos - Atrasado 10 dias",
    rbMessageKind: "charge",
    rbDaysOffset: 10,
    gupshupTemplateId: "2e7440ac-6133-4a7c-9bb0-5be887839435",
    gupshupTemplateName: "Dr Oculos | Atrasado 10 dias",
    gupshupTemplateLanguage: "pt_BR",
    gupshupTemplateParams: ["nome", "DtVencimento", "Vl_liquido"],
    messageTemplate:
      "Oi {nome}, retomando o contato sobre o titulo vencido em {DtVencimento}. O valor liquido segue em {Vl_liquido} para conferencia.",
  },
  {
    key: "overdue_15_days",
    stageName: "Cobranca critica (15 dias)",
    journeyName: "RB Dr Oculos - Cobranca critica 15 dias",
    rbMessageKind: "charge",
    rbDaysOffset: 15,
    gupshupTemplateId: "2f37cb6d-ae16-4861-80c6-156b7624e9f5",
    gupshupTemplateName: "Dr Oculos | Cobranca critica 15 dias",
    gupshupTemplateLanguage: "pt_BR",
    gupshupTemplateParams: ["nome", "vencimento", "valor_liquido"],
    messageTemplate:
      "Oi {nome}, seguimos com a cobranca em aberto e queremos ajudar a concluir a regularizacao. O valor liquido atualizado e {valor_liquido}.",
  },
];

export function buildRbBillingStagePayload(blueprint: RbBillingStageBlueprint) {
  return {
    name: blueprint.stageName,
    color: blueprint.color,
    category: blueprint.category,
    classifier_description: blueprint.classifierDescription,
    classifier_positive_signals: blueprint.classifierPositiveSignals,
    classifier_negative_signals: blueprint.classifierNegativeSignals,
    classifier_examples: blueprint.classifierExamples,
  };
}

export function buildRbBillingJourneyPayload(params: {
  triggerStageId: string;
  instanceName: string;
  replyTargetStageId: string | null;
  journeyName: string;
}): AutomationJourneyPayload {
  return {
    name: params.journeyName,
    trigger_stage_id: params.triggerStageId,
    instance_name: params.instanceName,
    is_active: true,
    humanized_dispatch_enabled: false,
    dispatch_limit_per_hour: 40,
    humanized_dispatch_window_start: "08:00:00",
    humanized_dispatch_window_end: "19:00:00",
    daily_dispatch_enabled: false,
    daily_dispatch_weekends_enabled: false,
    daily_dispatch_time: null,
    entry_source: "rb",
    entry_rule: {
      id: globalThis.crypto?.randomUUID?.() ?? `rb-entry-${Math.random().toString(36).slice(2, 10)}`,
      type: "group",
      operator: "all",
      children: [
        {
          id: globalThis.crypto?.randomUUID?.() ?? `rb-stage-${Math.random().toString(36).slice(2, 10)}`,
          type: "predicate",
          predicate: "stage_is",
          value: params.triggerStageId,
        },
        {
          id: globalThis.crypto?.randomUUID?.() ?? `rb-instance-${Math.random().toString(36).slice(2, 10)}`,
          type: "predicate",
          predicate: "instance_is",
          value: params.instanceName,
        },
        {
          id: globalThis.crypto?.randomUUID?.() ?? `rb-visible-${Math.random().toString(36).slice(2, 10)}`,
          type: "predicate",
          predicate: "lead_visible_is_true",
          value: true,
        },
      ],
    },
    exit_rule: {
      id: globalThis.crypto?.randomUUID?.() ?? `rb-exit-${Math.random().toString(36).slice(2, 10)}`,
      type: "group",
      operator: "any",
      children: [
        {
          id: globalThis.crypto?.randomUUID?.() ?? `rb-replied-${Math.random().toString(36).slice(2, 10)}`,
          type: "predicate",
          predicate: "lead_replied",
          value: true,
        },
      ],
    },
    anchor_event: "stage_entered_at",
    reentry_mode: "restart_on_match",
    reply_target_stage_id: params.replyTargetStageId,
    builder_version: 2,
  };
}

export function buildRbBillingStepPayload(blueprint: RbBillingMessageBlueprint): AutomationStepPayload {
  return {
    label: blueprint.stageName,
    delay_minutes: 0,
    content_mode: "text",
    message_template: blueprint.messageTemplate,
    media_asset_id: null,
    media_kind: null,
    media_caption: null,
    gupshup_template_id: blueprint.gupshupTemplateId,
    gupshup_template_name: blueprint.gupshupTemplateName,
    gupshup_template_language: blueprint.gupshupTemplateLanguage,
    gupshup_template_params: blueprint.gupshupTemplateParams,
    rb_message_kind: blueprint.rbMessageKind,
    rb_days_offset: blueprint.rbDaysOffset,
    rb_payment_type_ids: RB_PAYMENT_TYPE_IDS,
    is_active: true,
    step_rule: null,
  };
}
