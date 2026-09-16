import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import type { AxiosInstance } from "axios";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseInstitutoStores,
} from "../store-locator-import.js";
import {
  buildAddressHash,
  buildOriginKey,
  normalizeLocationText,
  normalizePostalCode,
  StoreLocatorService,
} from "../store-locator-service.js";

const NEAREST_STORES = [
  {
    id: "10000000-0000-0000-0000-000000000001",
    display_name: "Loja A",
    address_line: "Rua A",
    address_number: "10",
    address_complement: null,
    neighborhood: "Centro",
    city: "Curitiba",
    state: "PR",
    postal_code: "80000000",
    phone: "+554130000001",
    address_hash: "hash-a",
    weekly_hours: {},
    hours_exceptions: [],
    hours_notes: null,
    latitude: -25.43,
    longitude: -49.27,
    straight_line_distance_meters: 1000,
  },
  {
    id: "10000000-0000-0000-0000-000000000002",
    display_name: "Loja B",
    address_line: "Rua B",
    address_number: "20",
    address_complement: null,
    neighborhood: "Boqueirão",
    city: "Curitiba",
    state: "PR",
    postal_code: "81730000",
    phone: "+554130000002",
    address_hash: "hash-b",
    weekly_hours: {},
    hours_exceptions: [],
    hours_notes: null,
    latitude: -25.50,
    longitude: -49.24,
    straight_line_distance_meters: 2000,
  },
];

function createLocatorClient(cacheRows: Array<Record<string, unknown>> = []) {
  const insertedEvents: Array<Record<string, unknown>> = [];
  const cachedWrites: Array<Record<string, unknown>> = [];
  const client = {
    rpc: async (name: string) => name === "find_nearest_stores"
      ? { data: NEAREST_STORES, error: null }
      : { data: null, error: { message: "RPC inesperada" } },
    from: (table: string) => {
      const builder: Record<string, unknown> & { then?: unknown } = {};
      const chain = () => builder;
      for (const method of ["select", "eq", "gt", "in", "order", "limit", "is"]) {
        builder[method] = chain;
      }
      builder.maybeSingle = async () => ({ data: null, error: null });
      builder.insert = async (payload: Record<string, unknown>) => {
        if (table === "lead_location_events") insertedEvents.push(payload);
        return { data: null, error: null };
      };
      builder.upsert = async (payload: Array<Record<string, unknown>>) => {
        if (table === "route_cache") cachedWrites.push(...payload);
        return { data: null, error: null };
      };
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(
        table === "route_cache"
          ? { data: cacheRows, error: null }
          : { data: [], error: null },
      ).then(resolve, reject);
      return builder;
    },
  };
  return {
    client: client as unknown as SupabaseClient<any, any, any>,
    insertedEvents,
    cachedWrites,
  };
}

function createGoogleClient() {
  const calls = { geocoding: 0, routes: 0, destinationCount: 0 };
  const client = {
    get: async () => {
      calls.geocoding += 1;
      return {
        data: {
          status: "OK",
          results: [{
            formatted_address: "Boqueirão, Curitiba - PR, Brasil",
            geometry: { location: { lat: -25.5, lng: -49.25 }, location_type: "GEOMETRIC_CENTER" },
            address_components: [],
          }],
        },
      };
    },
    post: async (_url: string, payload: { destinations: unknown[] }) => {
      calls.routes += 1;
      calls.destinationCount = payload.destinations.length;
      return {
        data: [
          { destinationIndex: 0, distanceMeters: 3500, duration: "600s", condition: "ROUTE_EXISTS" },
          { destinationIndex: 1, distanceMeters: 2800, duration: "480s", condition: "ROUTE_EXISTS" },
        ],
      };
    },
  };
  return { client: client as unknown as AxiosInstance, calls };
}

test("normaliza localizacao para reutilizar a mesma consulta", () => {
  assert.equal(normalizeLocationText("  Boqueirão, Curitiba! "), "boqueirao curitiba");
  assert.equal(normalizePostalCode("81.730-000"), "81730000");
  assert.equal(buildOriginKey(-25.500001, -49.250001), buildOriginKey(-25.500002, -49.250002));
});

test("hash de endereco muda somente quando o endereco de geocode muda", () => {
  const base = {
    displayName: "Boqueirão",
    addressLine: "Av. Marechal Floriano Peixoto",
    addressNumber: "10147",
    neighborhood: "Boqueirão",
    city: "Curitiba",
    state: "PR",
    postalCode: "81730000",
    phone: "4132872000",
  };
  assert.equal(buildAddressHash(base), buildAddressHash({ ...base, phone: "4132872001" }));
  assert.notEqual(buildAddressHash(base), buildAddressHash({ ...base, addressNumber: "10148" }));
});

test("prepara as filiais reais do Instituto e sinaliza o CEP suspeito de Castro", async () => {
  const markdown = await readFile(
    resolve(process.cwd(), "../../referencias/IA Instituto/Lojas Instituto.md"),
    "utf8",
  );
  const result = parseInstitutoStores(markdown);
  assert.equal(result.stores.length, 56);
  assert.ok(result.stores.some((store) => store.displayName === "BOQUEIRÃO" && store.phone === "+554132872000"));
  assert.ok(result.stores.every((store) => Boolean(store.hoursNotes)));
  assert.ok(result.issues.some((issue) => issue.storeName === "UNIDADE CASTRO" && issue.field === "postalCode"));
});

test("consulta Routes somente para as candidatas do PostGIS e persiste o ranking", async () => {
  const locator = createLocatorClient();
  const google = createGoogleClient();
  const service = new StoreLocatorService(locator.client, "test-key", 30, google.client);
  const result = await service.recommend({
    acesId: 1,
    leadId: "20000000-0000-0000-0000-000000000001",
    agentId: "30000000-0000-0000-0000-000000000001",
    locationText: "Boqueirão",
  });

  assert.equal(result.recommendation?.displayName, "Loja B");
  assert.equal(google.calls.geocoding, 1);
  assert.equal(google.calls.routes, 1);
  assert.equal(google.calls.destinationCount, NEAREST_STORES.length);
  assert.equal(locator.cachedWrites.length, NEAREST_STORES.length);
  assert.deepEqual(locator.insertedEvents[0]?.candidate_store_ids, [
    "10000000-0000-0000-0000-000000000002",
    "10000000-0000-0000-0000-000000000001",
  ]);
});

test("usa o cache de rota sem chamar Google Routes novamente", async () => {
  const locator = createLocatorClient([
    { store_id: NEAREST_STORES[0].id, distance_meters: 3500, duration_seconds: 600 },
    { store_id: NEAREST_STORES[1].id, distance_meters: 2800, duration_seconds: 480 },
  ]);
  const google = createGoogleClient();
  const service = new StoreLocatorService(locator.client, "test-key", 30, google.client);
  const result = await service.recommend({
    acesId: 1,
    leadId: "20000000-0000-0000-0000-000000000001",
    agentId: "30000000-0000-0000-0000-000000000001",
    locationText: "Boqueirão",
  });

  assert.equal(result.recommendation?.displayName, "Loja B");
  assert.equal(google.calls.geocoding, 1);
  assert.equal(google.calls.routes, 0);
  assert.equal(locator.cachedWrites.length, 0);
});
