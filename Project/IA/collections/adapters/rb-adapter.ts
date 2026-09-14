import { randomUUID } from "node:crypto";

import { RbClient, type RbBillingRecord } from "../../rb-client.js";
import { normalizePhoneForStorage } from "../../phone-normalization.js";
import type {
  AdapterCapabilities,
  AdapterContext,
  CanonicalIngestionEnvelope,
  CanonicalPaymentMethod,
  CollectionSourceMapper,
} from "../domain.js";

export type RbCollectionAdapterInput = {
  records: RbBillingRecord[];
  sourcePartition: string;
  creditorNames?: Record<string, string>;
  pixByCreditor?: Record<string, string>;
  paymentMethodById?: Record<string, CanonicalPaymentMethod>;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function digits(value: unknown) {
  return text(value).replace(/\D/g, "");
}

function parseDate(value: unknown) {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Data RB invalida: ${raw}`);
  return parsed.toISOString().slice(0, 10);
}

function money(value: unknown) {
  const amount = RbClient.normalizeMoney(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`Valor RB invalido: ${String(value)}`);
  return amount.toFixed(2);
}

function paymentId(record: RbBillingRecord) {
  return text(record.PGTO_IDORIGEM ?? record.FORMA_ID);
}

export class RbCollectionAdapter implements CollectionSourceMapper<RbCollectionAdapterInput> {
  readonly sourceType = "rb";
  readonly capabilities: AdapterCapabilities = {
    delivery: "pull",
    supportedModes: ["incremental"],
    supportsAuthoritativeSnapshot: false,
    suppliesFinancialStatus: true,
    suppliesPaymentInstructions: true,
  };

  async map(input: RbCollectionAdapterInput, context: AdapterContext): Promise<CanonicalIngestionEnvelope> {
    const occurredAt = context.occurredAt ?? new Date().toISOString();
    return {
      schemaVersion: "1.0",
      connectionId: context.connectionId,
      ingestionId: context.ingestionId ?? randomUUID(),
      mode: "incremental",
      occurredAt,
      scope: { sourcePartition: input.sourcePartition },
      records: input.records.map((record) => {
        const customerId = text(record.CLIE_ID);
        const receivableId = text(record.Titulo);
        const creditorId = text(record.EMP_ID) || digits(record.EMP_CPFCNPJ);
        const phone = normalizePhoneForStorage(record.CLIE_FONE);
        if (!customerId || !receivableId || !creditorId || !phone) {
          throw new Error(`Registro RB sem identidade obrigatoria no bucket ${record.sourceBucket}`);
        }
        const method = input.paymentMethodById?.[paymentId(record)] ?? "other";
        const pixKey = input.pixByCreditor?.[creditorId]
          ?? input.pixByCreditor?.[digits(record.EMP_CPFCNPJ)];
        return {
          schemaVersion: "1.0" as const,
          source: {
            connectionId: context.connectionId,
            externalEventId: `${record.sourceBucket}:${receivableId}:${occurredAt}`,
            sourceUpdatedAt: occurredAt,
          },
          customer: {
            externalId: customerId,
            name: text(record.CLIE_NOMEPRINC) || `Cliente ${customerId}`,
            phone,
            document: digits(record.CLIE_CPFCNPJ) || undefined,
          },
          creditor: {
            externalId: creditorId,
            name: input.creditorNames?.[creditorId],
            document: digits(record.EMP_CPFCNPJ) || undefined,
          },
          receivable: {
            externalId: receivableId,
            remainingAmount: money(record.FIN_VLLIQUIDO),
            currency: "BRL",
            dueDate: parseDate(record.DtVencimento),
            status: "open" as const,
          },
          payment: {
            method,
            pixKey: pixKey || undefined,
          },
          metadata: {
            rbSourceBucket: record.sourceBucket,
            rbDaysDue: RbClient.normalizeMoney(record.DiasVenc),
            rbPaymentTypeId: paymentId(record) || null,
          },
        };
      }),
    };
  }
}
