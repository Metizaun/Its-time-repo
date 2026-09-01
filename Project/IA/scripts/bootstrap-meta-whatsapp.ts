import "../load-env.js";
import { MetaBootstrapError, MetaBootstrapService } from "../meta-bootstrap-service.js";

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} e obrigatorio`);
  return value;
}

function optionalEnv(name: string) {
  return process.env[name]?.trim() || null;
}

async function main() {
  const onboardingMode = process.env.META_WHATSAPP_ONBOARDING_MODE?.trim() || "internal_bootstrap";
  if (onboardingMode !== "internal_bootstrap") {
    throw new Error("META_WHATSAPP_ONBOARDING_MODE deve ser internal_bootstrap");
  }

  const service = new MetaBootstrapService({
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    graphApiVersion: requireEnv("META_GRAPH_API_VERSION"),
    metaAppId: requireEnv("META_APP_ID"),
    resolveSecret: (secretRef) => process.env[secretRef] ?? null,
  });

  const result = await service.bootstrap({
    acesId: Number(requireEnv("META_BOOTSTRAP_ACES_ID")),
    instanceName: requireEnv("META_BOOTSTRAP_INSTANCE_NAME"),
    wabaId: requireEnv("META_BOOTSTRAP_WABA_ID"),
    phoneNumberId: requireEnv("META_BOOTSTRAP_PHONE_NUMBER_ID"),
    businessId: optionalEnv("META_BOOTSTRAP_BUSINESS_ID"),
    accessTokenSecretRef: requireEnv("META_BOOTSTRAP_ACCESS_TOKEN_SECRET_REF"),
    appSecretRef: requireEnv("META_BOOTSTRAP_APP_SECRET_REF"),
    webhookVerifyTokenSecretRef: requireEnv("META_BOOTSTRAP_VERIFY_TOKEN_SECRET_REF"),
    actorId: requireEnv("META_BOOTSTRAP_ACTOR_ID"),
  });

  console.log(JSON.stringify(result));
}

main().catch((error: unknown) => {
  const safeError =
    error instanceof MetaBootstrapError
      ? { code: error.code, message: error.message }
      : { code: "META_BOOTSTRAP_FAILED", message: "Bootstrap Meta falhou" };
  console.error(JSON.stringify({ success: false, error: safeError }));
  process.exitCode = 1;
});
