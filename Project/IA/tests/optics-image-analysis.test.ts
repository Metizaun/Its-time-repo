import assert from "node:assert/strict";
import test from "node:test";
import {
  createVisagismEditRequest,
  invokeVisagismImageEdit,
  isTransientVisagismError,
  parseOpticsImageAnalysis,
  resolveVisagismIdempotencyAction,
} from "../sdr-agent-gemini.js";
import { WhatsAppProviderError } from "../whatsapp-provider.js";

test("classifica rosto sem criar extracao de receituario", () => {
  const analysis = parseOpticsImageAnalysis(JSON.stringify({
    kind: "face",
    evidence: ["rosto frontal"],
    prescription: null,
    face: {
      face_shape: "oval",
      summary: "Rosto oval com linhas suaves",
      hair: "curto",
      skin_tone: "medio",
      visual_features: ["sobrancelhas marcadas"],
    },
  }));

  assert.equal(analysis.kind, "face");
  assert.equal(analysis.prescription, null);
  assert.equal(analysis.face?.faceShape, "oval");
});

test("extrai receituario na mesma classificacao multimodal", () => {
  const analysis = parseOpticsImageAnalysis(JSON.stringify({
    kind: "prescription",
    evidence: ["campos OD e OE"],
    prescription: {
      confidence: 0.98,
      od_sphere: "-1,25",
      od_cylinder: "-0,50",
      od_axis: 90,
      oe_sphere: "-1.00",
      oe_cylinder: 0,
      oe_axis: null,
      addition: null,
      distance_pd: 62,
      near_pd: null,
      patient_name: "Cliente",
      prescriber_name: null,
      prescriber_registration: null,
      prescription_date: "2026-06-20",
      expires_at: null,
      observations: null,
    },
    face: null,
  }));

  assert.equal(analysis.kind, "prescription");
  assert.equal(analysis.prescription?.odSphere, -1.25);
  assert.equal(analysis.prescription?.oeSphere, -1);
  assert.equal(analysis.face, null);
});

test("edicao do visagismo exige foto e armacao", () => {
  const request = createVisagismEditRequest("gpt-image-1", "aplique a armacao", ["lead", "frame"]);
  assert.equal(request.image.length, 2);
  assert.equal(request.model, "gpt-image-1");
  assert.throws(
    () => createVisagismEditRequest("gpt-image-1", "invalido", ["lead"]),
    /exatamente a foto do lead/
  );
});

test("integra duas referencias com a API de edicao simulada", async () => {
  let captured: ReturnType<typeof createVisagismEditRequest<string>> | null = null;
  const request = createVisagismEditRequest("gpt-image-1", "aplique a armacao", ["lead", "frame"]);
  const response = await invokeVisagismImageEdit(async (input: typeof request) => {
    captured = input;
    return { data: [{ b64_json: "aW1hZ2U=" }] };
  }, request);

  assert.ok(captured);
  assert.equal((captured as typeof request).image.length, 2);
  assert.equal(response.data[0]?.b64_json, "aW1hZ2U=");
});

test("idempotencia retoma somente run aguardando dados", () => {
  assert.equal(resolveVisagismIdempotencyAction(null, true), "create");
  assert.equal(resolveVisagismIdempotencyAction("waiting_input", true), "resume");
  assert.equal(resolveVisagismIdempotencyAction("waiting_input", false), "return_existing");
  assert.equal(resolveVisagismIdempotencyAction("succeeded", true), "return_existing");
  assert.equal(resolveVisagismIdempotencyAction("running", true), "return_existing");
});

test("retry fica restrito a falhas transientes", () => {
  assert.equal(isTransientVisagismError(new Error("503 temporarily unavailable")), true);
  assert.equal(isTransientVisagismError(new Error("imagem de armacao invalida")), false);
  assert.equal(isTransientVisagismError(new WhatsAppProviderError("provider indisponivel", {
    provider: "evolution",
    kind: "transient",
    statusCode: 503,
  })), true);
  assert.equal(isTransientVisagismError(new WhatsAppProviderError("timeout sem confirmacao", {
    provider: "evolution",
    kind: "transient",
    statusCode: null,
  })), false);
});
