import type { SupabaseClient } from "@supabase/supabase-js";

import {
  canonicalPayloadHash,
  type CanonicalIngestionEnvelope,
  type CollectionIngestionPort,
  type IngestionReceipt,
  validateCanonicalEnvelope,
} from "./domain.js";

export class CollectionIngestionService implements CollectionIngestionPort {
  constructor(private readonly client: SupabaseClient<any, "collections", any>) {}

  async ingest(
    input: CanonicalIngestionEnvelope,
    options: { idempotencyKey?: string; maxRecords?: number } = {}
  ): Promise<IngestionReceipt> {
    const envelope = validateCanonicalEnvelope(input, {
      expectedConnectionId: input.connectionId,
      maxRecords: options.maxRecords,
    });
    const payloadHash = canonicalPayloadHash(envelope);
    const { data, error } = await this.client.rpc("ingest_envelope", {
      p_source_connection_id: envelope.connectionId,
      p_external_idempotency_key: options.idempotencyKey ?? envelope.ingestionId,
      p_payload_hash: payloadHash,
      p_mode: envelope.mode,
      p_scope: envelope.scope ?? {},
      p_records: envelope.records,
    });
    if (error) throw new Error(`Falha ao aplicar ingestao canonica: ${error.message}`);
    const receipt = data as IngestionReceipt & { errorCode?: string; errorMessage?: string };
    if (!receipt?.accepted) {
      const errorCode = receipt?.errorCode ?? "collection_ingestion_failed";
      const errorMessage = receipt?.errorMessage ?? "Falha sem detalhe retornada pelo banco";
      const { error: auditError } = await this.client.rpc("record_ingestion_failure", {
        p_source_connection_id: envelope.connectionId,
        p_external_idempotency_key: options.idempotencyKey ?? envelope.ingestionId,
        p_payload_hash: payloadHash,
        p_mode: envelope.mode,
        p_scope: envelope.scope ?? {},
        p_received_count: envelope.records.length,
        p_error_code: errorCode,
        p_error_message: errorMessage,
      });
      if (auditError) {
        console.error("[collections] ingestion_failure_audit_failed", {
          sourceConnectionId: envelope.connectionId,
          errorCode,
          auditError: auditError.message,
        });
      }
      throw new Error(
        `Falha ao aplicar ingestao canonica: ${errorCode} (${errorMessage})`
      );
    }
    const observation = receipt.duplicate
      ? { type: "ingestion.duplicate", details: { ingestionId: receipt.ingestionId } }
      : Number(receipt.unchangedCount ?? 0) > 0
        ? { type: "ingestion.out_of_order", details: {
          ingestionId: receipt.ingestionId, ignoredRecords: receipt.unchangedCount,
        } }
        : null;
    if (observation) {
      const { error: observationError } = await this.client.rpc("record_ingestion_observation", {
        p_source_connection_id: envelope.connectionId,
        p_event_type: observation.type,
        p_details: observation.details,
      });
      if (observationError) {
        console.error("[collections] ingestion_observation_audit_failed", {
          sourceConnectionId: envelope.connectionId,
          eventType: observation.type,
          error: observationError.message,
        });
      }
    }
    return receipt;
  }
}
