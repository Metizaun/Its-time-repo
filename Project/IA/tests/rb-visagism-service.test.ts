import assert from "node:assert/strict";
import test from "node:test";

import { RbVisagismService, rbVisagismInternals } from "../rb-visagism-service.js";

function createDeleteService(options: { storageError?: Error } = {}) {
  const events: string[] = [];
  const service = new RbVisagismService({
    supabaseUrl: "http://127.0.0.1:54321",
    supabaseServiceRoleKey: "service-role-test",
  });

  (service as any).findCatalogItem = async () => ({
    id: "item-1",
    storage_bucket: "visagism-catalog",
    storage_path: "5/modelo/frame.webp",
    display_order: 0,
  });
  (service as any).supabase = {
    storage: {
      from: () => ({
        remove: async () => {
          events.push("storage:remove");
          return { error: options.storageError ?? null };
        },
      }),
    },
  };
  (service as any).agentsClient = {
    from: () => ({
      update: (values: { is_active: boolean }) => {
        events.push(values.is_active ? "catalog:restore" : "catalog:deactivate");
        let filters = 0;
        const query = {
          eq: () => (++filters === 2 ? Promise.resolve({ error: null }) : query),
        };
        return query;
      },
      delete: () => {
        events.push("catalog:delete");
        let filters = 0;
        const query = {
          eq: () => (++filters === 2 ? Promise.resolve({ error: null }) : query),
        };
        return query;
      },
    }),
  };
  return { service, events };
}

test("decodifica imagem base64 pura ou em data URI", () => {
  const encoded = Buffer.from("frame").toString("base64");
  assert.equal(rbVisagismInternals.decodeBase64Image(encoded).toString(), "frame");
  assert.equal(
    rbVisagismInternals.decodeBase64Image(`data:image/jpeg;base64,${encoded}`).toString(),
    "frame",
  );
});

test("normaliza a resposta estruturada do visagismo reverso", () => {
  const analysis = rbVisagismInternals.parseAnalysis(`\`\`\`json
  {
    "product_name": "Modelo A",
    "color": "Preto",
    "shape": "Quadrado",
    "material": "Acetato",
    "style": "Contemporaneo",
    "recommended_face_shapes": ["oval"],
    "recommended_personality_traits": ["confiante"],
    "recommended_perception": ["autoridade"],
    "recommended_style_profiles": ["executivo"],
    "recommendation_description": "Favorece rostos ovais e comunica confianca."
  }
  \`\`\``);

  assert.equal(analysis.material, "Acetato");
  assert.deepEqual(analysis.recommended_perception, ["autoridade"]);
});

test("desativa o item antes de apagar a imagem e o registro", async () => {
  const { service, events } = createDeleteService();
  await service.deleteByModel({ aces_id: 5 } as any, "SKU-10");
  assert.deepEqual(events, ["catalog:deactivate", "storage:remove", "catalog:delete"]);
});

test("restaura o item quando a exclusao da imagem falha", async () => {
  const { service, events } = createDeleteService({ storageError: new Error("storage indisponivel") });
  await assert.rejects(
    service.deleteByModel({ aces_id: 5 } as any, "SKU-10"),
    /storage indisponivel/,
  );
  assert.deepEqual(events, ["catalog:deactivate", "storage:remove", "catalog:restore"]);
});

test("gera descricao compativel com o contrato legado", () => {
  const analysis = rbVisagismInternals.parseAnalysis(JSON.stringify({
    product_name: "Modelo A",
    color: "Preto",
    shape: "Quadrado",
    material: "Acetato",
    style: "Contemporaneo",
    recommended_face_shapes: ["oval"],
    recommended_personality_traits: ["confiante"],
    recommended_perception: ["autoridade"],
    recommended_style_profiles: ["executivo"],
    recommendation_description: "Favorece rostos ovais e comunica confianca.",
  }));
  const description = rbVisagismInternals.buildDescription("SKU-10", analysis);

  assert.match(description, /Nome\/Modelo: SKU-10/);
  assert.match(description, /Descricao visagista:/);
  assert.equal(rbVisagismInternals.safePathSegment("Óculos Harry Potter 2.jpg"), "oculos-harry-potter-2-jpg");
});
