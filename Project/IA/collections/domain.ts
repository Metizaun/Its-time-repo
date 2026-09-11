import { createHash } from "node:crypto";

import { normalizePhoneForStorage } from "../phone-normalization.js";

export const COLLECTION_SCHEMA_VERSION = "1.0" as const;

export type CanonicalFinancialStatus =
  | "open"
  | "settled"
  | "cancelled"
  | "suspended"
  | "unknown";

export type CanonicalPaymentMethod =
  | "pix"
  | "boleto"
  | "card"
  | "cash"
  | "bank_transfer"
  | "store_credit"
  | "other";

export type CanonicalReceivable = {
  schemaVersion: typeof COLLECTION_SCHEMA_VERSION;
  source: {
    connectionId: string;
    externalEventId?: string;
    sourceUpdatedAt: string;
  };
  customer: {
    externalId: string;
    name: string;
    phone: string;
    document?: string;
    email?: string;
  };
  creditor: {
    externalId: string;
    name?: string;
    document?: string;
  };
  receivable: {
    externalId: string;
    description?: string;
    originalAmount?: string;
    remainingAmount: string;
    currency: string;
    dueDate: string;
    status: CanonicalFinancialStatus;
  };
  payment?: {
    method?: CanonicalPaymentMethod;
    pixKey?: string;
    paymentUrl?: string;
    expiresAt?: string;
  };
  metadata?: Record<string, unknown>;
};

export type CanonicalIngestionEnvelope = {
  schemaVersion: typeof COLLECTION_SCHEMA_VERSION;
  connectionId: string;
  ingestionId: string;
  mode: "snapshot" | "incremental";
  occurredAt: string;
  scope?: {
    creditorExternalId?: string;
    sourcePartition?: string;
  };
  records: CanonicalReceivable[];
};

export type AdapterCapabilities = {
  delivery: "pull" | "push" | "file";
  supportedModes: Array<"snapshot" | "incremental">;
  supportsAuthoritativeSnapshot: boolean;
  suppliesFinancialStatus: boolean;
  suppliesPaymentInstructions: boolean;
};

export type AdapterContext = {
  connectionId: string;
  timezone: string;
  occurredAt?: string;
  ingestionId?: string;
};

export interface CollectionSourceMapper<TInput> {
  readonly sourceType: string;
  readonly capabilities: AdapterCapabilities;
  map(input: TInput, context: AdapterContext): Promise<CanonicalIngestionEnvelope>;
}

export interface PullCollectionConnector<TInput> {
  collect(context: AdapterContext): Promise<TInput>;
}

export type IngestionReceipt = {
  accepted: boolean;
  duplicate: boolean;
  ingestionId: string;
  status: string;
  receivedCount?: number;
  createdCount?: number;
  updatedCount?: number;
  unchangedCount?: number;
  notPresentCount?: number;
  affectedCasesCount?: number;
};

export interface CollectionIngestionPort {
  ingest(
    envelope: CanonicalIngestionEnvelope,
    options?: { idempotencyKey?: string; maxRecords?: number }
  ): Promise<IngestionReceipt>;
}

export class CollectionValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field?: string
  ) {
    super(message);
    this.name = "CollectionValidationError";
  }
}

const FINANCIAL_STATUSES = new Set<CanonicalFinancialStatus>([
  "open",
  "settled",
  "cancelled",
  "suspended",
  "unknown",
]);
const PAYMENT_METHODS = new Set<CanonicalPaymentMethod>([
  "pix",
  "boleto",
  "card",
  "cash",
  "bank_transfer",
  "store_credit",
  "other",
]);
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const FORBIDDEN_EXTERNAL_KEYS = new Set([
  "aces_id",
  "agent_id",
  "lead_id",
  "communication_status",
]);

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CollectionValidationError(`${field} deve ser um objeto`, "invalid_object", field);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, maxLength = 255) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new CollectionValidationError(`${field} e obrigatorio`, "required", field);
  }
  if (text.length > maxLength) {
    throw new CollectionValidationError(`${field} excede ${maxLength} caracteres`, "too_long", field);
  }
  return text;
}

function optionalText(value: unknown, field: string, maxLength = 500) {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  return requiredText(value, field, maxLength);
}

function isoTimestamp(value: unknown, field: string) {
  const text = requiredText(value, field, 64);
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new CollectionValidationError(`${field} deve ser ISO 8601 com timezone`, "invalid_timestamp", field);
  }
  return new Date(text).toISOString();
}

function isoDate(value: unknown, field: string) {
  const text = requiredText(value, field, 10);
  if (!DATE_PATTERN.test(text)) {
    throw new CollectionValidationError(`${field} deve usar YYYY-MM-DD`, "invalid_date", field);
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new CollectionValidationError(`${field} e uma data invalida`, "invalid_date", field);
  }
  return text;
}

function decimal(value: unknown, field: string) {
  const text = requiredText(value, field, 64);
  if (!DECIMAL_PATTERN.test(text)) {
    throw new CollectionValidationError(`${field} deve ser decimal nao negativo com ponto`, "invalid_decimal", field);
  }
  return text;
}

function sanitizeMetadataValue(value: unknown, depth: number): unknown {
  if (depth > 3) {
    throw new CollectionValidationError("metadata excede a profundidade permitida", "metadata_too_deep", "metadata");
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 1000);
  if (Array.isArray(value)) {
    if (value.length > 50) {
      throw new CollectionValidationError("metadata possui lista excessiva", "metadata_too_large", "metadata");
    }
    return value.map((item) => sanitizeMetadataValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 32) {
      throw new CollectionValidationError("metadata possui chaves excessivas", "metadata_too_large", "metadata");
    }
    return Object.fromEntries(
      entries.map(([key, item]) => {
        if (key.length > 64 || FORBIDDEN_EXTERNAL_KEYS.has(key.toLowerCase())) {
          throw new CollectionValidationError(`metadata contem chave nao permitida: ${key}`, "metadata_key_forbidden", "metadata");
        }
        return [key, sanitizeMetadataValue(item, depth + 1)];
      })
    );
  }
  throw new CollectionValidationError("metadata contem valor nao suportado", "metadata_invalid_value", "metadata");
}

function assertNoForbiddenKeys(value: unknown, path = "payload", depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`, depth + 1));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_EXTERNAL_KEYS.has(key.toLowerCase())) {
      throw new CollectionValidationError(`${path}.${key} nao pode ser informado pela fonte`, "forbidden_external_field", `${path}.${key}`);
    }
    assertNoForbiddenKeys(item, `${path}.${key}`, depth + 1);
  }
}

export function validateCanonicalReceivable(
  input: unknown,
  expectedConnectionId: string
): CanonicalReceivable {
  assertNoForbiddenKeys(input);
  const record = asRecord(input, "record");
  if (record.schemaVersion !== COLLECTION_SCHEMA_VERSION) {
    throw new CollectionValidationError("Versao do registro nao suportada", "unsupported_schema_version", "schemaVersion");
  }
  const source = asRecord(record.source, "source");
  const customer = asRecord(record.customer, "customer");
  const creditor = asRecord(record.creditor, "creditor");
  const receivable = asRecord(record.receivable, "receivable");
  const payment = record.payment === undefined ? undefined : asRecord(record.payment, "payment");
  const connectionId = requiredText(source.connectionId, "source.connectionId", 128);
  if (connectionId !== expectedConnectionId) {
    throw new CollectionValidationError("Conexao do registro difere do envelope autenticado", "connection_mismatch", "source.connectionId");
  }
  const phone = normalizePhoneForStorage(requiredText(customer.phone, "customer.phone", 40));
  if (phone.replace(/\D/g, "").length < 10) {
    throw new CollectionValidationError("Telefone invalido", "invalid_phone", "customer.phone");
  }
  const financialStatus = requiredText(receivable.status, "receivable.status", 32) as CanonicalFinancialStatus;
  if (!FINANCIAL_STATUSES.has(financialStatus)) {
    throw new CollectionValidationError("Situacao financeira nao suportada", "invalid_financial_status", "receivable.status");
  }
  const paymentMethod = payment?.method
    ? (requiredText(payment.method, "payment.method", 32) as CanonicalPaymentMethod)
    : undefined;
  if (paymentMethod && !PAYMENT_METHODS.has(paymentMethod)) {
    throw new CollectionValidationError("Forma de pagamento nao suportada", "invalid_payment_method", "payment.method");
  }
  const currency = requiredText(receivable.currency, "receivable.currency", 3).toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new CollectionValidationError("Moeda deve usar ISO 4217", "invalid_currency", "receivable.currency");
  }
  const metadata = record.metadata === undefined
    ? undefined
    : (sanitizeMetadataValue(asRecord(record.metadata, "metadata"), 0) as Record<string, unknown>);
  if (metadata && Buffer.byteLength(JSON.stringify(metadata), "utf8") > 16 * 1024) {
    throw new CollectionValidationError("metadata excede 16 KiB", "metadata_too_large", "metadata");
  }
  const paymentUrl = optionalText(payment?.paymentUrl, "payment.paymentUrl", 2048);
  if (paymentUrl) {
    let url: URL;
    try { url = new URL(paymentUrl); } catch {
      throw new CollectionValidationError("URL de pagamento invalida", "invalid_payment_url", "payment.paymentUrl");
    }
    if (url.protocol !== "https:") {
      throw new CollectionValidationError("URL de pagamento deve usar HTTPS", "invalid_payment_url", "payment.paymentUrl");
    }
  }
  return {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    source: {
      connectionId,
      externalEventId: optionalText(source.externalEventId, "source.externalEventId", 255),
      sourceUpdatedAt: isoTimestamp(source.sourceUpdatedAt, "source.sourceUpdatedAt"),
    },
    customer: {
      externalId: requiredText(customer.externalId, "customer.externalId", 255),
      name: requiredText(customer.name, "customer.name", 255),
      phone,
      document: optionalText(customer.document, "customer.document", 32)?.replace(/\D/g, ""),
      email: optionalText(customer.email, "customer.email", 320),
    },
    creditor: {
      externalId: requiredText(creditor.externalId, "creditor.externalId", 255),
      name: optionalText(creditor.name, "creditor.name", 255),
      document: optionalText(creditor.document, "creditor.document", 32)?.replace(/\D/g, ""),
    },
    receivable: {
      externalId: requiredText(receivable.externalId, "receivable.externalId", 255),
      description: optionalText(receivable.description, "receivable.description", 500),
      originalAmount: receivable.originalAmount === undefined
        ? undefined
        : decimal(receivable.originalAmount, "receivable.originalAmount"),
      remainingAmount: decimal(receivable.remainingAmount, "receivable.remainingAmount"),
      currency,
      dueDate: isoDate(receivable.dueDate, "receivable.dueDate"),
      status: financialStatus,
    },
    payment: payment ? {
      method: paymentMethod,
      pixKey: optionalText(payment.pixKey, "payment.pixKey", 255),
      paymentUrl,
      expiresAt: payment.expiresAt === undefined
        ? undefined
        : isoTimestamp(payment.expiresAt, "payment.expiresAt"),
    } : undefined,
    metadata,
  };
}

export function validateCanonicalEnvelope(
  input: unknown,
  options: { expectedConnectionId: string; maxRecords?: number }
): CanonicalIngestionEnvelope {
  assertNoForbiddenKeys(input);
  const envelope = asRecord(input, "envelope");
  if (envelope.schemaVersion !== COLLECTION_SCHEMA_VERSION) {
    throw new CollectionValidationError("Versao do envelope nao suportada", "unsupported_schema_version", "schemaVersion");
  }
  const connectionId = requiredText(envelope.connectionId, "connectionId", 128);
  if (connectionId !== options.expectedConnectionId) {
    throw new CollectionValidationError("Conexao do envelope nao corresponde a conexao autenticada", "connection_mismatch", "connectionId");
  }
  if (envelope.mode !== "snapshot" && envelope.mode !== "incremental") {
    throw new CollectionValidationError("Modo de ingestao invalido", "invalid_mode", "mode");
  }
  if (!Array.isArray(envelope.records)) {
    throw new CollectionValidationError("records deve ser uma lista", "invalid_records", "records");
  }
  const maxRecords = Math.max(1, options.maxRecords ?? 50_000);
  if (envelope.records.length > maxRecords) {
    throw new CollectionValidationError(`O lote deve conter no maximo ${maxRecords} registros`, "records_limit", "records");
  }
  const scope = envelope.scope === undefined ? undefined : asRecord(envelope.scope, "scope");
  return {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    connectionId,
    ingestionId: requiredText(envelope.ingestionId, "ingestionId", 255),
    mode: envelope.mode,
    occurredAt: isoTimestamp(envelope.occurredAt, "occurredAt"),
    scope: scope ? {
      creditorExternalId: optionalText(scope.creditorExternalId, "scope.creditorExternalId", 255),
      sourcePartition: optionalText(scope.sourcePartition, "scope.sourcePartition", 255),
    } : undefined,
    records: envelope.records.map((record) => validateCanonicalReceivable(record, connectionId)),
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

export function canonicalPayloadHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}
