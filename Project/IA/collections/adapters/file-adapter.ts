import {
  type AdapterCapabilities,
  type AdapterContext,
  type CanonicalIngestionEnvelope,
  type CollectionSourceMapper,
  validateCanonicalEnvelope,
} from "../domain.js";

export class FileCollectionAdapter implements CollectionSourceMapper<unknown> {
  readonly sourceType = "file";
  readonly capabilities: AdapterCapabilities = {
    delivery: "file",
    supportedModes: ["snapshot", "incremental"],
    supportsAuthoritativeSnapshot: true,
    suppliesFinancialStatus: true,
    suppliesPaymentInstructions: true,
  };

  async map(input: unknown, context: AdapterContext): Promise<CanonicalIngestionEnvelope> {
    return validateCanonicalEnvelope(input, {
      expectedConnectionId: context.connectionId,
      maxRecords: 50_000,
    });
  }
}
