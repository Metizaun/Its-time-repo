export type AgendaIntent =
  | "none"
  | "company_info"
  | "professionals"
  | "price"
  | "availability"
  | "book"
  | "reschedule"
  | "cancel";

export type AgendaPeriod = "morning" | "afternoon" | "evening";

export type AgendaRequest = {
  intent: AgendaIntent;
  companyQuery?: string;
  professionalQuery?: string;
  serviceQuery?: string;
  dateFrom?: string;
  dateTo?: string;
  period?: AgendaPeriod;
  optionReference?: string;
  confirmation?: "unknown" | "yes" | "no";
};

export type AgendaPresentedOption = {
  reference: string;
  kind: "company" | "professional" | "date" | "slot" | "appointment";
  id: string;
  label: string;
  companyId?: string | null;
  professionalId?: string | null;
  professionalLocationId?: string | null;
  serviceId?: string | null;
  startTime?: string | null;
  eventId?: string | null;
};

export type AgendaConversationContext = {
  version: 1;
  updatedAt: string;
  expiresAt: string;
  selectedStoreId: string | null;
  companyId: string | null;
  companyQuery: string | null;
  professionalId: string | null;
  professionalLocationId: string | null;
  professionalQuery: string | null;
  serviceId: string | null;
  serviceQuery: string | null;
  appointmentEventId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  period: AgendaPeriod | null;
  presentedOptions: AgendaPresentedOption[];
  optionsPresentedAt: string | null;
  selectedOption: AgendaPresentedOption | null;
  confirmation: "unknown" | "yes" | "no";
};

export type CompanyLookupAttempt = {
  strategy: "strict" | "without_service" | "without_filters" | "unit_fragment" | "normalized_terms";
  query: string;
  serviceQuery: string | null;
  professionalQuery: string | null;
};

export type AgendaAvailabilityAttempt = {
  dateFrom: string;
  dateUntil: string;
  period: AgendaPeriod | null;
};

const VALID_INTENTS = new Set<AgendaIntent>([
  "none",
  "company_info",
  "professionals",
  "price",
  "availability",
  "book",
  "reschedule",
  "cancel",
]);
const VALID_PERIODS = new Set<AgendaPeriod>(["morning", "afternoon", "evening"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
export const AGENDA_OPTIONS_TTL_MS = 30 * 60 * 1000;
const GENERIC_SERVICE_QUERIES = new Set([
  "agenda",
  "agendamento",
  "agendar",
  "atendimento",
  "consulta",
  "consultas",
  "horario",
  "marcar",
]);
const GENERIC_OPTION_TERMS = new Set([
  "a",
  "as",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "em",
  "empresa",
  "filial",
  "loja",
  "o",
  "os",
  "unidade",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalText(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function optionalDate(value: unknown): string | undefined {
  const text = optionalText(value, 10);
  if (!text || !DATE_PATTERN.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    return undefined;
  }
  return text;
}

export function normalizeAgendaText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function referencesSameCompany(left: string, right: string) {
  const normalizedLeft = normalizeAgendaText(left);
  const normalizedRight = normalizeAgendaText(right);
  if (normalizedLeft === normalizedRight) return true;
  const leftTerms = normalizedLeft.split(" ").filter((term) => term.length > 1 && !GENERIC_OPTION_TERMS.has(term));
  const rightTerms = normalizedRight.split(" ").filter((term) => term.length > 1 && !GENERIC_OPTION_TERMS.has(term));
  if (!leftTerms.length || !rightTerms.length) return false;
  const shorter = leftTerms.length <= rightTerms.length ? leftTerms : rightTerms;
  const longer = new Set(leftTerms.length <= rightTerms.length ? rightTerms : leftTerms);
  return shorter.every((term) => longer.has(term));
}

export function buildCompanyLookupAttempts(
  companyQuery: string,
  serviceQuery?: string | null,
  professionalQuery?: string | null,
): CompanyLookupAttempt[] {
  const query = companyQuery.trim().replace(/\s+/g, " ");
  const fragments = query.split(/\s*(?:-|–|—|,|\/)\s*/u).map((item) => item.trim()).filter(Boolean);
  const unitFragment = fragments.at(-1) ?? query;
  const normalizedTerms = normalizeAgendaText(query)
    .split(" ")
    .filter((term) => term.length > 1 && !GENERIC_OPTION_TERMS.has(term))
    .join(" ") || normalizeAgendaText(query);
  const strictService = isGenericAgendaServiceQuery(serviceQuery) ? null : serviceQuery?.trim() || null;

  return [
    { strategy: "strict", query, serviceQuery: strictService, professionalQuery: professionalQuery?.trim() || null },
    { strategy: "without_service", query, serviceQuery: null, professionalQuery: professionalQuery?.trim() || null },
    { strategy: "without_filters", query, serviceQuery: null, professionalQuery: null },
    { strategy: "unit_fragment", query: unitFragment, serviceQuery: null, professionalQuery: null },
    { strategy: "normalized_terms", query: normalizedTerms, serviceQuery: null, professionalQuery: null },
  ];
}

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildAgendaAvailabilityAttempts(input: {
  today: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  period?: AgendaPeriod | null;
  horizonDays?: number;
}): AgendaAvailabilityAttempt[] {
  const horizonDays = Math.min(730, Math.max(1, Math.trunc(input.horizonDays ?? 90)));
  const horizonUntil = addIsoDays(input.today, horizonDays - 1);
  const dateFrom = input.dateFrom ?? input.today;
  const requestedUntil = input.dateTo ?? input.dateFrom ?? addIsoDays(input.today, 6);
  const effectiveHorizonUntil = horizonUntil < dateFrom ? dateFrom : horizonUntil;
  const clampUntil = (candidate: string) => candidate > effectiveHorizonUntil ? effectiveHorizonUntil : candidate;
  const expansionDays = input.dateFrom ? [0, 0, 7, 14, 30] : [6, 13, 29, 59, horizonDays - 1];

  return expansionDays.map((days, index) => ({
    dateFrom,
    dateUntil: clampUntil(index === 0 ? requestedUntil : addIsoDays(dateFrom, days)),
    period: index === 0 ? input.period ?? null : null,
  }));
}

export type AgendaSlotLocationBatch = {
  professionalLocationId: string;
  locationLabel: string;
  slots: Array<Record<string, unknown>>;
};

export function mergeAgendaSlotsByProfessionalLocation(batches: AgendaSlotLocationBatch[]) {
  const merged = new Map<string, Record<string, unknown>>();
  for (const batch of batches) {
    for (const slot of batch.slots) {
      const key = [
        batch.professionalLocationId,
        String(slot.professional_id ?? ""),
        String(slot.service_id ?? ""),
        String(slot.slot_start ?? ""),
      ].join(":");
      merged.set(key, {
        ...slot,
        professional_location_id: batch.professionalLocationId,
        location_label: batch.locationLabel,
      });
    }
  }

  return [...merged.values()].sort((left, right) => {
    const byStart = String(left.slot_start ?? "").localeCompare(String(right.slot_start ?? ""));
    return byStart || String(left.location_label ?? "").localeCompare(String(right.location_label ?? ""));
  });
}

export function isGenericAgendaServiceQuery(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = normalizeAgendaText(value);
  if (GENERIC_SERVICE_QUERIES.has(normalized)) return true;
  const terms = normalized.split(" ").filter(Boolean);
  return terms.length > 0 && terms.every((term) => GENERIC_SERVICE_QUERIES.has(term));
}

export function parseAgendaRequest(value: unknown): AgendaRequest {
  const input = record(value);
  const rawIntent = optionalText(input.intent, 40) as AgendaIntent | undefined;
  const rawPeriod = optionalText(input.period, 20) as AgendaPeriod | undefined;
  const rawConfirmation = optionalText(input.confirmation, 10);

  return {
    intent: rawIntent && VALID_INTENTS.has(rawIntent) ? rawIntent : "none",
    companyQuery: optionalText(input.companyQuery),
    professionalQuery: optionalText(input.professionalQuery),
    serviceQuery: optionalText(input.serviceQuery),
    dateFrom: optionalDate(input.dateFrom),
    dateTo: optionalDate(input.dateTo),
    period: rawPeriod && VALID_PERIODS.has(rawPeriod) ? rawPeriod : undefined,
    optionReference: optionalText(input.optionReference, 40),
    confirmation:
      rawConfirmation === "yes" || rawConfirmation === "no" || rawConfirmation === "unknown"
        ? rawConfirmation
        : "unknown",
  };
}

export function createAgendaContext(now = new Date()): AgendaConversationContext {
  return {
    version: 1,
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CONTEXT_TTL_MS).toISOString(),
    selectedStoreId: null,
    companyId: null,
    companyQuery: null,
    professionalId: null,
    professionalLocationId: null,
    professionalQuery: null,
    serviceId: null,
    serviceQuery: null,
    appointmentEventId: null,
    dateFrom: null,
    dateTo: null,
    period: null,
    presentedOptions: [],
    optionsPresentedAt: null,
    selectedOption: null,
    confirmation: "unknown",
  };
}

export function readAgendaContext(value: unknown, now = new Date()): AgendaConversationContext {
  const input = record(value);
  const expiresAt = optionalText(input.expiresAt, 40);
  if (Number(input.version) !== 1 || !expiresAt || Date.parse(expiresAt) <= now.getTime()) {
    return createAgendaContext(now);
  }

  const options = Array.isArray(input.presentedOptions)
    ? input.presentedOptions
        .map((item) => record(item))
        .filter((item) => optionalText(item.reference) && optionalText(item.id) && optionalText(item.label))
        .slice(0, 4)
        .map((item) => ({
          reference: optionalText(item.reference, 20)!,
          kind: (optionalText(item.kind, 20) ?? "slot") as AgendaPresentedOption["kind"],
          id: optionalText(item.id, 80)!,
          label: optionalText(item.label, 240)!,
          companyId: optionalText(item.companyId, 80) ?? null,
          professionalId: optionalText(item.professionalId, 80) ?? null,
          professionalLocationId: optionalText(item.professionalLocationId, 80) ?? null,
          serviceId: optionalText(item.serviceId, 80) ?? null,
          startTime: optionalText(item.startTime, 40) ?? null,
          eventId: optionalText(item.eventId, 80) ?? null,
        }))
    : [];
  const selectedRecord = record(input.selectedOption);
  const selectedReference = optionalText(selectedRecord.reference, 20);
  const selectedOption = selectedReference
    ? options.find((option) => option.reference === selectedReference) ?? null
    : null;

  const base = createAgendaContext(now);
  return {
    ...base,
    selectedStoreId: optionalText(input.selectedStoreId, 80) ?? null,
    companyId: optionalText(input.companyId, 80) ?? null,
    companyQuery: optionalText(input.companyQuery) ?? null,
    professionalId: optionalText(input.professionalId, 80) ?? null,
    professionalLocationId: optionalText(input.professionalLocationId, 80) ?? null,
    professionalQuery: optionalText(input.professionalQuery) ?? null,
    serviceId: optionalText(input.serviceId, 80) ?? null,
    serviceQuery: optionalText(input.serviceQuery) ?? null,
    appointmentEventId: optionalText(input.appointmentEventId, 80) ?? null,
    dateFrom: optionalDate(input.dateFrom) ?? null,
    dateTo: optionalDate(input.dateTo) ?? null,
    period:
      typeof input.period === "string" && VALID_PERIODS.has(input.period as AgendaPeriod)
        ? (input.period as AgendaPeriod)
        : null,
    presentedOptions: options,
    optionsPresentedAt: optionalText(input.optionsPresentedAt, 40) ?? null,
    confirmation:
      input.confirmation === "yes" || input.confirmation === "no" ? input.confirmation : "unknown",
    selectedOption,
  };
}

export function setAgendaSelectedStore(context: AgendaConversationContext, selectedStoreId: string) {
  if (context.selectedStoreId === selectedStoreId) return context;

  return {
    ...context,
    selectedStoreId,
    companyId: null,
    companyQuery: null,
    professionalId: null,
    professionalLocationId: null,
    serviceId: null,
    appointmentEventId: null,
    presentedOptions: [],
    optionsPresentedAt: null,
    selectedOption: null,
    confirmation: "unknown" as const,
  };
}

function optionNumber(reference: string): number | null {
  const normalized = reference.trim().toLocaleLowerCase("pt-BR");
  const withoutArticle = normalized.replace(/^(?:o|a)\s+/u, "");
  const aliases: Record<string, number> = {
    primeiro: 1,
    primeira: 1,
    segundo: 2,
    segunda: 2,
    terceiro: 3,
    terceira: 3,
    quarto: 4,
    quarta: 4,
  };
  if (aliases[withoutArticle]) return aliases[withoutArticle];
  const match = normalized.match(/(?:op[cç][aã]o\s*)?(\d+)/u);
  return match ? Number(match[1]) : null;
}

export function resolveAgendaOption(
  context: AgendaConversationContext,
  reference: string | undefined,
  now = new Date(),
  kind?: AgendaPresentedOption["kind"],
): AgendaPresentedOption | null {
  if (!reference || !context.optionsPresentedAt) return null;
  const age = now.getTime() - Date.parse(context.optionsPresentedAt);
  if (!Number.isFinite(age) || age < 0 || age > AGENDA_OPTIONS_TTL_MS) return null;
  const options = kind
    ? context.presentedOptions.filter((option) => option.kind === kind)
    : context.presentedOptions;
  const ordinal = optionNumber(reference);
  if (ordinal && context.presentedOptions[ordinal - 1]) {
    const selected = context.presentedOptions[ordinal - 1];
    return !kind || selected.kind === kind ? selected : null;
  }
  const normalized = normalizeAgendaText(reference);
  if (!normalized) return null;
  const exactMatches = options.filter((option) => normalizeAgendaText(option.label) === normalized);
  if (exactMatches.length === 1) return exactMatches[0];
  const referenceTerms = normalized
    .split(" ")
    .filter((term) => term.length > 1 && !GENERIC_OPTION_TERMS.has(term));
  if (!referenceTerms.length) return null;
  const semanticMatches = options.filter((option) => {
    const labelTerms = new Set(normalizeAgendaText(option.label).split(" ").filter(Boolean));
    return referenceTerms.every((term) => labelTerms.has(term));
  });
  return semanticMatches.length === 1 ? semanticMatches[0] : null;
}

function resolveOptionFromCustomerMessage(
  context: AgendaConversationContext,
  message: string,
  now: Date,
  kind: AgendaPresentedOption["kind"],
): AgendaPresentedOption | null {
  const normalized = normalizeAgendaText(message);
  const optionNumberMatch = normalized.match(/\b(?:opcao|horario|agendamento|evento)(?: numero)? ([1-4])\b/u);
  const ordinalNames: Record<string, number> = {
    primeiro: 1,
    primeira: 1,
    segundo: 2,
    segunda: 2,
    terceiro: 3,
    terceira: 3,
    quarto: 4,
    quarta: 4,
  };
  const ordinalMatch = normalized.match(
    /^(?:quero )?(?:(?:o|a) )?(primeiro|primeira|segundo|segunda|terceiro|terceira|quarto|quarta)(?: (?:opcao|horario|agendamento|evento))?$/u,
  );
  const ordinal = Number(optionNumberMatch?.[1]) || ordinalNames[ordinalMatch?.[1] ?? ""];
  if (ordinal) return resolveAgendaOption(context, String(ordinal), now, kind);

  const compactMessage = normalized.replace(/^(?:quero|escolho|prefiro) /u, "").replace(/^(?:o|a) /u, "");
  if (!/\d/u.test(compactMessage)) {
    const directMatch = resolveAgendaOption(context, compactMessage, now, kind);
    if (directMatch) return directMatch;
  }

  const timeMatch = message.match(/\b(?:as?\s*)?([01]?\d|2[0-3])(?:(?::|h)\s*([0-5]\d)?)\b/iu)
    ?? message.match(/\b(?:as|às)\s+([01]?\d|2[0-3])(?:\s*horas?)?\b/iu);
  if (!timeMatch) return null;
  const requestedTime = `${timeMatch[1].padStart(2, "0")}:${(timeMatch[2] ?? "00").padStart(2, "0")}`;
  const timeMatches = context.presentedOptions.filter((option) => {
    if (option.kind !== kind || !resolveAgendaOption(context, option.reference, now, kind)) return false;
    const optionTime = option.label.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/u);
    return optionTime?.[0] === requestedTime;
  });
  return timeMatches.length === 1
    ? resolveAgendaOption(context, timeMatches[0].reference, now, kind)
    : null;
}

const AFFIRMATIVE_CONFIRMATIONS = new Set([
  "sim",
  "sim por favor",
  "isso",
  "confirmo",
  "pode",
  "pode ser",
  "pode confirmar",
  "esta certo",
  "e esse",
  "e esse mesmo",
  "quero esse",
  "ok",
  "certo",
]);
const NEGATIVE_CONFIRMATIONS = new Set([
  "nao",
  "nao quero",
  "nao esse",
  "prefiro outro",
  "prefiro nao",
  "quero outro",
  "melhor outro",
]);

export function validateRescheduleRequest(
  contextValue: unknown,
  request: AgendaRequest,
  customerMessage: string | null | undefined,
  now = new Date(),
): AgendaRequest {
  if (request.intent !== "reschedule") return request;
  const context = readAgendaContext(contextValue, now);
  const normalizedMessage = normalizeAgendaText(customerMessage ?? "");
  const requestedOption = resolveAgendaOption(context, request.optionReference, now);
  const messageOption = requestedOption
    ? resolveOptionFromCustomerMessage(context, customerMessage ?? "", now, requestedOption.kind)
    : null;
  const optionReference = requestedOption && messageOption?.id === requestedOption.id
    ? requestedOption.reference
    : undefined;

  let confirmation = request.confirmation ?? "unknown";
  if (confirmation !== "unknown") {
    const pendingOption = context.selectedOption
      ? resolveAgendaOption(context, context.selectedOption.reference, now, context.selectedOption.kind)
      : null;
    const customerConfirmed = confirmation === "yes"
      ? AFFIRMATIVE_CONFIRMATIONS.has(normalizedMessage)
      : NEGATIVE_CONFIRMATIONS.has(normalizedMessage);
    if (!pendingOption || pendingOption.id !== context.selectedOption?.id || !customerConfirmed) {
      confirmation = "unknown";
    }
  }

  return { ...request, optionReference, confirmation };
}

export function buildRescheduleAppointmentStep(options: AgendaPresentedOption[]): {
  status: "empty" | "needs_input" | "needs_confirmation";
  message: string;
  selectedOption: AgendaPresentedOption | null;
} {
  if (!options.length) {
    return {
      status: "empty",
      message: "Não encontrei agendamentos ativos para alterar.",
      selectedOption: null,
    };
  }
  if (options.length === 1) {
    return {
      status: "needs_confirmation",
      message: `Encontrei seu agendamento para ${options[0].label}. É esse que você quer alterar?`,
      selectedOption: options[0],
    };
  }
  return {
    status: "needs_input",
    message: `Encontrei mais de um agendamento. Qual deles você quer alterar? ${options.map((option) => `${option.reference}. ${option.label}`).join(" ")}`,
    selectedOption: null,
  };
}

export function mergeAgendaRequest(
  current: AgendaConversationContext,
  request: AgendaRequest,
  now = new Date(),
): AgendaConversationContext {
  const context = readAgendaContext(current, now);
  const companyChanged = Boolean(
    request.companyQuery
    && context.companyQuery
    && !referencesSameCompany(request.companyQuery, context.companyQuery),
  );
  const professionalChanged = Boolean(
    request.professionalQuery && request.professionalQuery !== context.professionalQuery,
  );
  const serviceChanged = Boolean(request.serviceQuery && request.serviceQuery !== context.serviceQuery);

  if (companyChanged) {
    context.companyId = null;
    context.professionalId = null;
    context.professionalLocationId = null;
    context.professionalQuery = null;
    context.serviceId = null;
    context.serviceQuery = null;
  } else if (professionalChanged) {
    context.professionalId = null;
    context.professionalLocationId = null;
    context.serviceId = null;
  } else if (serviceChanged) {
    context.serviceId = null;
  }

  const selectedCandidate =
    resolveAgendaOption(context, request.optionReference, now)
    ?? resolveAgendaOption(context, request.companyQuery, now, "company")
    ?? resolveAgendaOption(context, request.professionalQuery, now, "professional");
  const candidateOrPendingConfirmation = selectedCandidate
    ?? (request.confirmation === "yes" || request.confirmation === "no" ? context.selectedOption : null);
  const selected =
    context.companyId
      && candidateOrPendingConfirmation?.kind !== "company"
      && candidateOrPendingConfirmation?.companyId
      && candidateOrPendingConfirmation.companyId !== context.companyId
      ? null
      : candidateOrPendingConfirmation;
  context.companyQuery = request.companyQuery ?? context.companyQuery;
  context.professionalQuery = request.professionalQuery ?? context.professionalQuery;
  context.serviceQuery = request.serviceQuery ?? context.serviceQuery;
  context.dateFrom = request.dateFrom ?? context.dateFrom;
  context.dateTo = request.dateTo ?? request.dateFrom ?? context.dateTo;
  context.period = request.period ?? context.period;
  context.selectedOption = selected;
  context.confirmation = request.confirmation ?? "unknown";
  context.updatedAt = now.toISOString();
  context.expiresAt = new Date(now.getTime() + CONTEXT_TTL_MS).toISOString();

  if ((selected?.companyId || selected?.kind === "company") && request.confirmation !== "no") {
    context.companyId = selected.companyId ?? selected.id;
  }
  if (selected?.professionalId || selected?.kind === "professional") {
    context.professionalId = selected.professionalId ?? selected.id;
    context.professionalLocationId = selected.professionalLocationId ?? null;
  }
  if (selected?.serviceId) context.serviceId = selected.serviceId;
  if (selected?.kind === "appointment") {
    context.appointmentEventId = selected.eventId ?? selected.id;
  }
  if (selected?.kind === "date" && DATE_PATTERN.test(selected.id)) {
    context.dateFrom = selected.id;
    context.dateTo = selected.id;
  }
  return context;
}

export function setPresentedAgendaOptions(
  context: AgendaConversationContext,
  options: AgendaPresentedOption[],
  now = new Date(),
): AgendaConversationContext {
  return {
    ...context,
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CONTEXT_TTL_MS).toISOString(),
    presentedOptions: options.slice(0, 4).map((option, index) => ({
      ...option,
      reference: String(index + 1),
    })),
    optionsPresentedAt: options.length ? now.toISOString() : null,
    selectedOption: null,
    confirmation: "unknown",
  };
}
