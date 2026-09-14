import { createHash } from "node:crypto";

export const AGENDA_SCHEMA_VERSION = "1.0" as const;

export const AGENDA_OUTBOUND_EVENT_TYPES = [
  "integration.test",
  "unit.upserted",
  "professional.upserted",
  "availability.upserted",
  "patient.upserted",
  "appointment.created",
  "appointment.rescheduled",
  "appointment.cancelled",
  "appointment.status_changed",
] as const;

export const AGENDA_INBOUND_EVENT_TYPES = ["appointment.status_reported"] as const;

export type AgendaOutboundEventType = (typeof AGENDA_OUTBOUND_EVENT_TYPES)[number];
export type AgendaInboundEventType = (typeof AGENDA_INBOUND_EVENT_TYPES)[number];
export type AgendaEventType = AgendaOutboundEventType | AgendaInboundEventType;
export type AgendaMetadata = Record<string, unknown>;

export type AgendaIntegrationTestResource = {
  message: "Its Time Agenda Universal connection test";
};

export type AgendaClosure = {
  type: "block" | "pause" | "holiday" | "vacation";
  startsAt: string;
  endsAt: string;
  reason: string | null;
};

export type AgendaUnitResource = {
  id: string;
  cnpj: string;
  name: string;
  address: string;
  city: string;
  state: string;
  isActive: boolean;
  closures: AgendaClosure[];
  metadata: AgendaMetadata;
  updatedAt: string;
  deletedAt?: string | null;
};

export type AgendaProfessionalAssignment = {
  assignmentId: string;
  unitId: string | null;
  locationName: string | null;
  isActive: boolean;
};

export type AgendaProfessionalResource = {
  id: string;
  name: string;
  specialty: string | null;
  isActive: boolean;
  assignments: AgendaProfessionalAssignment[];
  metadata: AgendaMetadata;
  updatedAt: string;
  deletedAt?: string | null;
};

export type AgendaWeeklyGridEntry = {
  weekday: number;
  startTime: string;
  endTime: string;
  validFrom: string | null;
  validUntil: string | null;
};

export type AgendaAvailabilityResource = {
  assignmentId: string;
  professionalId: string;
  unitId: string | null;
  timezone: string;
  weeklyGrid: AgendaWeeklyGridEntry[];
  exceptions: AgendaClosure[];
  updatedAt: string;
};

export type AgendaPatientResource = {
  id: string;
  name: string;
  phoneE164: string;
  birthDate?: string | null;
  document: string | null;
  homeUnitId: string | null;
  metadata: AgendaMetadata;
  updatedAt: string;
};

export type AgendaAppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "cancelled"
  | "done"
  | "no_show";

export type AgendaAppointmentResource = {
  id: string;
  status: AgendaAppointmentStatus;
  startTime: string;
  endTime: string;
  timezone: string;
  durationMinutes: number;
  unitId: string | null;
  locationName: string | null;
  professionalId: string;
  assignmentId: string;
  patientId: string;
  service: {
    id: string;
    name: string;
    durationMinutes: number;
    price: string | null;
    currency: string;
  };
  origin: "manual" | "ai" | "api" | "import" | "external";
  notes: string | null;
  cancelReason: string | null;
  metadata: AgendaMetadata;
  updatedAt: string;
};

export type AgendaAppointmentStatusReportedResource = {
  appointmentId: string;
  status: "done" | "no_show";
  reason: string | null;
  reportedAt: string;
  baseResourceVersion: number;
  metadata: AgendaMetadata;
};

export type AgendaOutboundResourceByEvent = {
  "integration.test": AgendaIntegrationTestResource;
  "unit.upserted": AgendaUnitResource;
  "professional.upserted": AgendaProfessionalResource;
  "availability.upserted": AgendaAvailabilityResource;
  "patient.upserted": AgendaPatientResource;
  "appointment.created": AgendaAppointmentResource;
  "appointment.rescheduled": AgendaAppointmentResource;
  "appointment.cancelled": AgendaAppointmentResource;
  "appointment.status_changed": AgendaAppointmentResource;
};

export type AgendaOutboundEnvelope<T extends AgendaOutboundEventType = AgendaOutboundEventType> = {
  schemaVersion: typeof AGENDA_SCHEMA_VERSION;
  eventId: string;
  eventType: T;
  occurredAt: string;
  resourceVersion: T extends "integration.test" ? undefined : number;
  resource: AgendaOutboundResourceByEvent[T];
};

export type AgendaInboundEnvelope = {
  schemaVersion: typeof AGENDA_SCHEMA_VERSION;
  eventId: string;
  eventType: AgendaInboundEventType;
  occurredAt: string;
  resource: AgendaAppointmentStatusReportedResource;
};

export type AgendaUnknownInboundEnvelope = {
  schemaVersion: typeof AGENDA_SCHEMA_VERSION;
  eventId: string;
  eventType: string;
  occurredAt: string;
  resource: Record<string, unknown>;
};

export type AgendaInboundParseResult =
  | { kind: "known"; envelope: AgendaInboundEnvelope }
  | { kind: "unknown"; envelope: AgendaUnknownInboundEnvelope };

export class AgendaContractError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "AgendaContractError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MONEY_PATTERN = /^(?:0|[1-9]\d*)\.\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const FORBIDDEN_EXTERNAL_KEYS = new Set([
  "aces_id",
  "acesid",
  "tenant",
  "tenant_id",
  "tenantid",
  "connection_id",
  "connectionid",
  "authorization",
  "routing",
]);

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgendaContractError(`${field} deve ser um objeto`, "invalid_object", field);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string, maxItems = 10_000): unknown[] {
  if (!Array.isArray(value)) {
    throw new AgendaContractError(`${field} deve ser uma lista`, "invalid_array", field);
  }
  if (value.length > maxItems) {
    throw new AgendaContractError(`${field} excede ${maxItems} itens`, "too_many_items", field);
  }
  return value;
}

function text(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AgendaContractError(`${field} e obrigatorio`, "required", field);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new AgendaContractError(`${field} excede ${maxLength} caracteres`, "too_long", field);
  }
  return normalized;
}

function nullableText(value: unknown, field: string, maxLength = 2_000): string | null {
  if (value === null || value === undefined || value === "") return null;
  return text(value, field, maxLength);
}

function uuid(value: unknown, field: string): string {
  const result = text(value, field, 36);
  if (!UUID_PATTERN.test(result)) {
    throw new AgendaContractError(`${field} deve ser UUID`, "invalid_uuid", field);
  }
  return result.toLowerCase();
}

function timestamp(value: unknown, field: string): string {
  const result = text(value, field, 64);
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(result) || Number.isNaN(Date.parse(result))) {
    throw new AgendaContractError(`${field} deve ser ISO 8601 com timezone`, "invalid_timestamp", field);
  }
  return result;
}

function date(value: unknown, field: string): string {
  const result = text(value, field, 10);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new AgendaContractError(`${field} deve usar uma data valida em YYYY-MM-DD`, "invalid_date", field);
  }
  return result;
}

function nullableDate(value: unknown, field: string): string | null {
  return value === null || value === undefined || value === "" ? null : date(value, field);
}

function time(value: unknown, field: string): string {
  const result = text(value, field, 5);
  if (!TIME_PATTERN.test(result)) {
    throw new AgendaContractError(`${field} deve usar HH:MM`, "invalid_time", field);
  }
  return result;
}

function integer(value: unknown, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new AgendaContractError(`${field} deve ser inteiro entre ${minimum} e ${maximum}`, "invalid_integer", field);
  }
  return Number(value);
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new AgendaContractError(`${field} deve ser booleano`, "invalid_boolean", field);
  }
  return value;
}

function enumeration<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new AgendaContractError(`${field} possui valor invalido`, "invalid_enum", field);
  }
  return value as T;
}

function assertNoForbiddenExternalKeys(value: unknown, path = "payload", depth = 0): void {
  if (depth > 10 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenExternalKeys(item, `${path}[${index}]`, depth + 1));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_EXTERNAL_KEYS.has(key.toLowerCase())) {
      throw new AgendaContractError(`${path}.${key} nao e permitido`, "forbidden_external_field", `${path}.${key}`);
    }
    assertNoForbiddenExternalKeys(item, `${path}.${key}`, depth + 1);
  }
}

function sanitizeMetadataValue(value: unknown, field: string, depth: number): unknown {
  if (depth > 3) {
    throw new AgendaContractError(`${field} excede profundidade 3`, "metadata_too_deep", field);
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length > 50) {
      throw new AgendaContractError(`${field} excede 50 itens`, "metadata_too_large", field);
    }
    return value.map((item, index) => sanitizeMetadataValue(item, `${field}[${index}]`, depth + 1));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 32) {
      throw new AgendaContractError(`${field} excede 32 chaves`, "metadata_too_large", field);
    }
    return Object.fromEntries(entries.map(([key, item]) => {
      if (!key || key.length > 64 || FORBIDDEN_EXTERNAL_KEYS.has(key.toLowerCase())) {
        throw new AgendaContractError(`${field}.${key} nao e permitido`, "metadata_key_forbidden", `${field}.${key}`);
      }
      return [key, sanitizeMetadataValue(item, `${field}.${key}`, depth + 1)];
    }));
  }
  throw new AgendaContractError(`${field} contem valor nao suportado`, "metadata_invalid_value", field);
}

function metadata(value: unknown, field = "resource.metadata"): AgendaMetadata {
  const result = sanitizeMetadataValue(object(value, field), field, 1) as AgendaMetadata;
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 16 * 1024) {
    throw new AgendaContractError(`${field} excede 16 KiB`, "metadata_too_large", field);
  }
  return result;
}

function nullableUuid(value: unknown, field: string): string | null {
  return value === null || value === undefined || value === "" ? null : uuid(value, field);
}

function closure(value: unknown, field: string): AgendaClosure {
  const input = object(value, field);
  const startsAt = timestamp(input.startsAt, `${field}.startsAt`);
  const endsAt = timestamp(input.endsAt, `${field}.endsAt`);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new AgendaContractError(`${field}.endsAt deve ser posterior a startsAt`, "invalid_range", `${field}.endsAt`);
  }
  return {
    type: enumeration(input.type, `${field}.type`, ["block", "pause", "holiday", "vacation"] as const),
    startsAt,
    endsAt,
    reason: nullableText(input.reason, `${field}.reason`),
  };
}

function validateBaseEnvelope(input: unknown) {
  const envelope = object(input, "payload");
  if (envelope.schemaVersion !== AGENDA_SCHEMA_VERSION) {
    throw new AgendaContractError("Versao de schema nao suportada", "unsupported_schema_version", "schemaVersion");
  }
  return {
    envelope,
    eventId: uuid(envelope.eventId, "eventId"),
    eventType: text(envelope.eventType, "eventType", 100),
    occurredAt: timestamp(envelope.occurredAt, "occurredAt"),
  };
}

function validateUnitResource(value: unknown): AgendaUnitResource {
  const resource = object(value, "resource");
  const state = text(resource.state, "resource.state", 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) {
    throw new AgendaContractError("resource.state deve ter duas letras", "invalid_state", "resource.state");
  }
  const cnpj = text(resource.cnpj, "resource.cnpj", 14).replace(/\D/g, "");
  if (!/^\d{14}$/.test(cnpj)) {
    throw new AgendaContractError("resource.cnpj deve ter 14 digitos", "invalid_document", "resource.cnpj");
  }
  return {
    id: uuid(resource.id, "resource.id"),
    cnpj,
    name: text(resource.name, "resource.name"),
    address: text(resource.address, "resource.address", 2_000),
    city: text(resource.city, "resource.city"),
    state,
    isActive: boolean(resource.isActive, "resource.isActive"),
    closures: array(resource.closures, "resource.closures", 1_000).map((item, index) => closure(item, `resource.closures[${index}]`)),
    metadata: metadata(resource.metadata),
    updatedAt: timestamp(resource.updatedAt, "resource.updatedAt"),
    ...(resource.deletedAt !== undefined ? { deletedAt: resource.deletedAt === null ? null : timestamp(resource.deletedAt, "resource.deletedAt") } : {}),
  };
}

function validateProfessionalResource(value: unknown): AgendaProfessionalResource {
  const resource = object(value, "resource");
  return {
    id: uuid(resource.id, "resource.id"),
    name: text(resource.name, "resource.name"),
    specialty: nullableText(resource.specialty, "resource.specialty"),
    isActive: boolean(resource.isActive, "resource.isActive"),
    assignments: array(resource.assignments, "resource.assignments", 1_000).map((item, index) => {
      const assignment = object(item, `resource.assignments[${index}]`);
      const unitId = nullableUuid(assignment.unitId, `resource.assignments[${index}].unitId`);
      const locationName = nullableText(assignment.locationName, `resource.assignments[${index}].locationName`);
      if (unitId === null && locationName === null) {
        throw new AgendaContractError("Assignment sem unidade exige locationName", "location_required", `resource.assignments[${index}].locationName`);
      }
      return {
        assignmentId: uuid(assignment.assignmentId, `resource.assignments[${index}].assignmentId`),
        unitId,
        locationName,
        isActive: boolean(assignment.isActive, `resource.assignments[${index}].isActive`),
      };
    }),
    metadata: metadata(resource.metadata),
    updatedAt: timestamp(resource.updatedAt, "resource.updatedAt"),
    ...(resource.deletedAt !== undefined ? { deletedAt: resource.deletedAt === null ? null : timestamp(resource.deletedAt, "resource.deletedAt") } : {}),
  };
}

function validateAvailabilityResource(value: unknown): AgendaAvailabilityResource {
  const resource = object(value, "resource");
  return {
    assignmentId: uuid(resource.assignmentId, "resource.assignmentId"),
    professionalId: uuid(resource.professionalId, "resource.professionalId"),
    unitId: nullableUuid(resource.unitId, "resource.unitId"),
    timezone: text(resource.timezone, "resource.timezone", 100),
    weeklyGrid: array(resource.weeklyGrid, "resource.weeklyGrid", 1_000).map((item, index) => {
      const entry = object(item, `resource.weeklyGrid[${index}]`);
      const validFrom = nullableDate(entry.validFrom, `resource.weeklyGrid[${index}].validFrom`);
      const validUntil = nullableDate(entry.validUntil, `resource.weeklyGrid[${index}].validUntil`);
      if (validFrom && validUntil && validUntil < validFrom) {
        throw new AgendaContractError("validUntil deve ser posterior a validFrom", "invalid_range", `resource.weeklyGrid[${index}].validUntil`);
      }
      const startTime = time(entry.startTime, `resource.weeklyGrid[${index}].startTime`);
      const endTime = time(entry.endTime, `resource.weeklyGrid[${index}].endTime`);
      if (endTime <= startTime) {
        throw new AgendaContractError("endTime deve ser posterior a startTime", "invalid_range", `resource.weeklyGrid[${index}].endTime`);
      }
      return {
        weekday: integer(entry.weekday, `resource.weeklyGrid[${index}].weekday`, 0, 6),
        startTime,
        endTime,
        validFrom,
        validUntil,
      };
    }),
    exceptions: array(resource.exceptions, "resource.exceptions", 1_000).map((item, index) => closure(item, `resource.exceptions[${index}]`)),
    updatedAt: timestamp(resource.updatedAt, "resource.updatedAt"),
  };
}

function validatePatientResource(value: unknown): AgendaPatientResource {
  const resource = object(value, "resource");
  const phoneE164 = text(resource.phoneE164, "resource.phoneE164", 16);
  if (!PHONE_PATTERN.test(phoneE164)) {
    throw new AgendaContractError("resource.phoneE164 deve usar E.164", "invalid_phone", "resource.phoneE164");
  }
  return {
    id: uuid(resource.id, "resource.id"),
    name: text(resource.name, "resource.name"),
    phoneE164,
    ...(resource.birthDate !== undefined ? { birthDate: nullableDate(resource.birthDate, "resource.birthDate") } : {}),
    document: nullableText(resource.document, "resource.document", 32),
    homeUnitId: nullableUuid(resource.homeUnitId, "resource.homeUnitId"),
    metadata: metadata(resource.metadata),
    updatedAt: timestamp(resource.updatedAt, "resource.updatedAt"),
  };
}

function validateAppointmentResource(value: unknown): AgendaAppointmentResource {
  const resource = object(value, "resource");
  const service = object(resource.service, "resource.service");
  const startTime = timestamp(resource.startTime, "resource.startTime");
  const endTime = timestamp(resource.endTime, "resource.endTime");
  if (Date.parse(endTime) <= Date.parse(startTime)) {
    throw new AgendaContractError("resource.endTime deve ser posterior a startTime", "invalid_range", "resource.endTime");
  }
  const unitId = nullableUuid(resource.unitId, "resource.unitId");
  const locationName = nullableText(resource.locationName, "resource.locationName");
  if (unitId === null && locationName === null) {
    throw new AgendaContractError("Agendamento sem unidade exige locationName", "location_required", "resource.locationName");
  }
  const rawPrice = service.price;
  const price = rawPrice === null || rawPrice === undefined ? null : text(rawPrice, "resource.service.price", 64);
  if (price !== null && !MONEY_PATTERN.test(price)) {
    throw new AgendaContractError("resource.service.price deve possuir duas casas decimais", "invalid_money", "resource.service.price");
  }
  const currency = text(service.currency, "resource.service.currency", 3);
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new AgendaContractError("resource.service.currency deve usar ISO 4217", "invalid_currency", "resource.service.currency");
  }
  return {
    id: uuid(resource.id, "resource.id"),
    status: enumeration(resource.status, "resource.status", ["scheduled", "confirmed", "cancelled", "done", "no_show"] as const),
    startTime,
    endTime,
    timezone: text(resource.timezone, "resource.timezone", 100),
    durationMinutes: integer(resource.durationMinutes, "resource.durationMinutes", 1, 1_440),
    unitId,
    locationName,
    professionalId: uuid(resource.professionalId, "resource.professionalId"),
    assignmentId: uuid(resource.assignmentId, "resource.assignmentId"),
    patientId: uuid(resource.patientId, "resource.patientId"),
    service: {
      id: uuid(service.id, "resource.service.id"),
      name: text(service.name, "resource.service.name"),
      durationMinutes: integer(service.durationMinutes, "resource.service.durationMinutes", 1, 1_440),
      price,
      currency,
    },
    origin: enumeration(resource.origin, "resource.origin", ["manual", "ai", "api", "import", "external"] as const),
    notes: nullableText(resource.notes, "resource.notes"),
    cancelReason: nullableText(resource.cancelReason, "resource.cancelReason"),
    metadata: metadata(resource.metadata),
    updatedAt: timestamp(resource.updatedAt, "resource.updatedAt"),
  };
}

export function validateAgendaOutboundEnvelope(input: unknown): AgendaOutboundEnvelope {
  const base = validateBaseEnvelope(input);
  const eventType = enumeration(base.eventType, "eventType", AGENDA_OUTBOUND_EVENT_TYPES);
  let resource: AgendaOutboundResourceByEvent[AgendaOutboundEventType];
  switch (eventType) {
    case "integration.test": {
      const raw = object(base.envelope.resource, "resource");
      if (raw.message !== "Its Time Agenda Universal connection test") {
        throw new AgendaContractError("Mensagem de teste invalida", "invalid_test_message", "resource.message");
      }
      if (base.envelope.resourceVersion !== undefined) {
        throw new AgendaContractError("Evento de teste nao possui resourceVersion", "unexpected_field", "resourceVersion");
      }
      resource = { message: raw.message };
      break;
    }
    case "unit.upserted": resource = validateUnitResource(base.envelope.resource); break;
    case "professional.upserted": resource = validateProfessionalResource(base.envelope.resource); break;
    case "availability.upserted": resource = validateAvailabilityResource(base.envelope.resource); break;
    case "patient.upserted": resource = validatePatientResource(base.envelope.resource); break;
    case "appointment.created":
    case "appointment.rescheduled":
    case "appointment.cancelled":
    case "appointment.status_changed": {
      resource = validateAppointmentResource(base.envelope.resource);
      const status = resource.status;
      const allowed = eventType === "appointment.cancelled"
        ? ["cancelled"]
        : eventType === "appointment.status_changed"
          ? ["confirmed", "done", "no_show"]
          : ["scheduled", "confirmed"];
      if (!allowed.includes(status)) {
        throw new AgendaContractError(`Status ${status} incompativel com ${eventType}`, "event_status_mismatch", "resource.status");
      }
      break;
    }
  }
  const resourceVersion = eventType === "integration.test"
    ? undefined
    : integer(base.envelope.resourceVersion, "resourceVersion", 1);
  return {
    schemaVersion: AGENDA_SCHEMA_VERSION,
    eventId: base.eventId,
    eventType,
    occurredAt: base.occurredAt,
    resourceVersion,
    resource,
  } as AgendaOutboundEnvelope;
}

export function parseAgendaInboundEnvelope(input: unknown): AgendaInboundParseResult {
  assertNoForbiddenExternalKeys(input);
  const base = validateBaseEnvelope(input);
  const rawResource = object(base.envelope.resource, "resource");
  if (base.eventType !== "appointment.status_reported") {
    return {
      kind: "unknown",
      envelope: {
        schemaVersion: AGENDA_SCHEMA_VERSION,
        eventId: base.eventId,
        eventType: base.eventType,
        occurredAt: base.occurredAt,
        resource: rawResource,
      },
    };
  }
  const envelope: AgendaInboundEnvelope = {
    schemaVersion: AGENDA_SCHEMA_VERSION,
    eventId: base.eventId,
    eventType: "appointment.status_reported",
    occurredAt: base.occurredAt,
    resource: {
      appointmentId: uuid(rawResource.appointmentId, "resource.appointmentId"),
      status: enumeration(rawResource.status, "resource.status", ["done", "no_show"] as const),
      reason: nullableText(rawResource.reason, "resource.reason"),
      reportedAt: timestamp(rawResource.reportedAt, "resource.reportedAt"),
      baseResourceVersion: integer(rawResource.baseResourceVersion, "resource.baseResourceVersion", 1),
      metadata: metadata(rawResource.metadata),
    },
  };
  return { kind: "known", envelope };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

export function agendaPayloadHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
