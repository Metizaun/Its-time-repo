import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createClient } from "@supabase/supabase-js";

import { WebhookCollectionAdapter } from "./adapters/webhook-adapter.js";
import { RbCollectionAdapter } from "./adapters/rb-adapter.js";
import { FileCollectionAdapter } from "./adapters/file-adapter.js";
import { CollectionValidationError } from "./domain.js";
import { CollectionIngestionService } from "./ingestion-service.js";
import { CollectionService } from "./collection-service.js";
import { CollectionSpreadsheetService } from "./spreadsheet-service.js";
import { CollectionWebhookAuthError, verifyCollectionWebhook } from "./webhook-security.js";
import { RbCanonicalService } from "./rb-collection-service.js";
import { CollectionSourceRegistry } from "./source-registry.js";
import { CollectionOnboardingService } from "./collection-onboarding-service.js";

export type CollectionApiRuntime = ReturnType<typeof createCollectionApiRuntime>;

function statusForError(error: unknown) {
  if (error instanceof CollectionWebhookAuthError) return 401;
  if (error instanceof CollectionValidationError) return 422;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("COLLECTION_IDEMPOTENCY_CONFLICT")) return 409;
  if (message.includes("COLLECTION_SOURCE_UNAVAILABLE")) return 503;
  return 500;
}

function clientIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function createCollectionApiRuntime(config: {
  supabaseUrl: string;
  serviceRoleKey: string;
}) {
  const auth = { persistSession: false, autoRefreshToken: false };
  const rootClient = createClient(config.supabaseUrl, config.serviceRoleKey, { auth });
  const collectionService = new CollectionService(config.supabaseUrl, config.serviceRoleKey);
  const onboardingService = new CollectionOnboardingService(collectionService);
  const ingestionService = new CollectionIngestionService(collectionService.collections);
  const spreadsheetService = new CollectionSpreadsheetService(
    rootClient,
    collectionService.collections,
    ingestionService,
  );
  const webhookAdapter = new WebhookCollectionAdapter();
  const sourceRegistry = new CollectionSourceRegistry()
    .register(webhookAdapter)
    .register(new RbCollectionAdapter())
    .register(new FileCollectionAdapter());
  const rbCanonicalService = new RbCanonicalService({
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
    mockFixturePath: process.env.RB_BILLING_MOCK_FIXTURE_PATH?.trim() || null,
  });

  const webhookHandler: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    const publicSourceId = String(req.params.publicSourceId ?? "").trim();
    const idempotencyKey = req.header("idempotency-key")?.trim();
    const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
    try {
      if (!publicSourceId || !rawBody) {
        res.status(400).json({ error: "Requisicao de webhook invalida", code: "invalid_request" });
        return;
      }
      if (!idempotencyKey || idempotencyKey.length > 255) {
        res.status(400).json({ error: "Idempotency-Key obrigatorio", code: "idempotency_key_required" });
        return;
      }
      const source = await collectionService.getSourceByPublicId(publicSourceId);
      if (!source || source.source_type !== "webhook" || source.delivery_mode !== "push") {
        res.status(401).json({ error: "Fonte ou assinatura invalida", code: "invalid_source" });
        return;
      }
      if (source.status !== "active") {
        res.status(503).json({ error: "Fonte temporariamente indisponivel", code: "source_unavailable" });
        return;
      }
      const { data: dispatcher, error: dispatcherError } = await collectionService.collections.rpc(
        "resolve_source_dispatcher",
        { p_source_connection_id: source.id },
      );
      if (dispatcherError) throw dispatcherError;
      if (dispatcher !== "canonical") {
        res.status(503).json({ error: "Fonte temporariamente indisponivel", code: "source_unavailable" });
        return;
      }

      const secrets = await collectionService.getCredentialSecrets(
        source.aces_id,
        source.id,
        "webhook_hmac",
      );
      verifyCollectionWebhook({
        rawBody,
        timestamp: req.header("x-collection-timestamp"),
        signature: req.header("x-collection-signature"),
        secrets,
      });

      const { data: allowed, error: rateError } = await collectionService.collections.rpc(
        "consume_webhook_rate_limit",
        { p_source_connection_id: source.id, p_ip: clientIp(req), p_limit: 120 },
      );
      if (rateError) throw rateError;
      if (!allowed) {
        res.setHeader("Retry-After", "60");
        res.status(429).json({ error: "Limite de requisicoes excedido", code: "rate_limited" });
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        res.status(400).json({ error: "JSON invalido", code: "invalid_json" });
        return;
      }
      const mapped = await webhookAdapter.map(
        { ...(payload as Record<string, unknown>), connectionId: source.id },
        { connectionId: source.id, timezone: source.timezone },
      );
      const receipt = await ingestionService.ingest(mapped, {
        idempotencyKey,
        maxRecords: 500,
      });
      console.info("[collection-webhook] accepted", {
        sourceConnectionId: source.id,
        acesId: source.aces_id,
        ingestionId: receipt.ingestionId,
        duplicate: receipt.duplicate,
        recordCount: mapped.records.length,
        elapsedMs: Date.now() - startedAt,
      });
      res.status(202).json(receipt);
    } catch (error) {
      const status = statusForError(error);
      console.warn("[collection-webhook] rejected", {
        publicSourceId,
        status,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - startedAt,
      });
      if (status === 500) {
        next(error);
        return;
      }
      res.status(status).json({
        error: status === 401 ? "Fonte ou assinatura invalida" : error instanceof Error ? error.message : "Falha na ingestao",
        code: error instanceof CollectionWebhookAuthError ? error.code : "collection_ingestion_rejected",
      });
    }
  };

  return {
    collectionService,
    onboardingService,
    ingestionService,
    spreadsheetService,
    rbCanonicalService,
    sourceRegistry,
    webhookHandler,
  };
}
