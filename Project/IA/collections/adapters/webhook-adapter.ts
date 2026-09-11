import {
  type AdapterCapabilities,
  type AdapterContext,
  type CanonicalIngestionEnvelope,
  type CollectionSourceMapper,
  validateCanonicalEnvelope,
} from "../domain.js";

export class WebhookCollectionAdapter implements CollectionSourceMapper<unknown> {
  readonly sourceType = "webhook";
  readonly capabilities: AdapterCapabilities = {
    delivery: "push",
    supportedModes: ["snapshot", "incremental"],
    supportsAuthoritativeSnapshot: true,
    suppliesFinancialStatus: true,
    suppliesPaymentInstructions: true,
  };

  async map(input: unknown, context: AdapterContext): Promise<CanonicalIngestionEnvelope> {
    const envelope = input && typeof input === "object" && !Array.isArray(input)
      ? input as Record<string, unknown> : {};
    const records = Array.isArray(envelope.records)
      ? envelope.records.map((item) => {
        const receivable = item && typeof item === "object" && !Array.isArray(item)
          ? item as Record<string, unknown> : {};
        const source = receivable.source && typeof receivable.source === "object"
          && !Array.isArray(receivable.source) ? receivable.source as Record<string, unknown> : {};
        return { ...receivable, source: { ...source, connectionId: context.connectionId } };
      })
      : envelope.records;
    return validateCanonicalEnvelope({ ...envelope, connectionId: context.connectionId, records }, {
      expectedConnectionId: context.connectionId,
      maxRecords: 500,
    });
  }
}
