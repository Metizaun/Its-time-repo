import { createHash } from "node:crypto";

import axios, { type AxiosInstance } from "axios";
import type { SupabaseClient } from "@supabase/supabase-js";

export type StoreGeocodeStatus = "pending" | "ready" | "failed" | "needs_review";

export type StoreHours = Record<string, Array<{ opensAt: string; closesAt: string }>>;

export type StoreInput = {
  id?: string;
  displayName: string;
  addressLine: string;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  phone?: string | null;
  weeklyHours?: StoreHours;
  hoursExceptions?: Array<Record<string, unknown>>;
  hoursNotes?: string | null;
  isActive?: boolean;
};

export type StoreRecord = {
  id: string;
  displayName: string;
  addressLine: string;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string | null;
  weeklyHours: StoreHours;
  hoursExceptions: Array<Record<string, unknown>>;
  hoursNotes: string | null;
  formattedAddress: string | null;
  addressHash: string;
  geocodeStatus: StoreGeocodeStatus;
  geocodeAccuracy: string | null;
  geocodeError: string | null;
  geocodedAt: string | null;
  isActive: boolean;
  aiVisible: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StoreRecommendation = StoreRecord & {
  latitude: number;
  longitude: number;
  straightLineDistanceMeters: number;
  routeDistanceMeters: number;
  routeDurationSeconds: number;
};

export type StoreLocatorRecommendationResult = {
  status: "succeeded" | "reused_favorite" | "reused_recommendation" | "needs_input" | "empty";
  normalizedLocation: string | null;
  recommendation: StoreRecommendation | null;
  alternatives: StoreRecommendation[];
  message: string;
  externalCalls: { geocoding: number; routes: number };
};

type GeocodeResult = {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  accuracy: string;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
};

type NearestStoreRow = {
  id: string;
  display_name: string;
  address_line: string;
  address_number: string | null;
  address_complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  postal_code: string;
  phone: string | null;
  address_hash: string;
  weekly_hours: StoreHours;
  hours_exceptions: Array<Record<string, unknown>>;
  hours_notes: string | null;
  latitude: number;
  longitude: number;
  straight_line_distance_meters: number;
};

type RouteMetric = {
  storeId: string;
  distanceMeters: number;
  durationSeconds: number;
};

export class StoreLocatorError extends Error {
  constructor(
    public readonly code: "invalid_input" | "provider_unavailable" | "database_error" | "not_found",
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "StoreLocatorError";
  }
}

export function normalizeLocationText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizePostalCode(value: string) {
  return value.replace(/\D/g, "");
}

export function normalizeState(value: string) {
  return value.trim().toUpperCase();
}

export function buildStoreAddress(input: StoreInput) {
  return [
    [input.addressLine.trim(), input.addressNumber?.trim()].filter(Boolean).join(", "),
    input.neighborhood.trim(),
    input.city.trim(),
    normalizeState(input.state),
    normalizePostalCode(input.postalCode),
    "Brasil",
  ]
    .filter(Boolean)
    .join(" - ");
}

export function buildAddressHash(input: StoreInput) {
  return createHash("sha256").update(normalizeLocationText(buildStoreAddress(input))).digest("hex");
}

export function buildOriginKey(latitude: number, longitude: number) {
  const rounded = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  return createHash("sha256").update(rounded).digest("hex");
}

function parseDurationSeconds(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  return match ? Math.round(Number(match[1])) : null;
}

function safeProviderDetails(error: unknown) {
  if (!axios.isAxiosError(error)) return undefined;
  const payload = error.response?.data;
  const providerStatus = payload && typeof payload === "object" && "status" in payload
    ? String((payload as { status?: unknown }).status ?? "")
    : null;
  return {
    httpStatus: error.response?.status ?? null,
    providerStatus,
    code: error.code ?? null,
  };
}

function mapStore(row: Record<string, unknown>): StoreRecord {
  return {
    id: String(row.id),
    displayName: String(row.display_name ?? ""),
    addressLine: String(row.address_line ?? ""),
    addressNumber: row.address_number ? String(row.address_number) : null,
    addressComplement: row.address_complement ? String(row.address_complement) : null,
    neighborhood: String(row.neighborhood ?? ""),
    city: String(row.city ?? ""),
    state: String(row.state ?? ""),
    postalCode: String(row.postal_code ?? ""),
    phone: row.phone ? String(row.phone) : null,
    weeklyHours: (row.weekly_hours ?? {}) as StoreHours,
    hoursExceptions: Array.isArray(row.hours_exceptions)
      ? (row.hours_exceptions as Array<Record<string, unknown>>)
      : [],
    hoursNotes: row.hours_notes ? String(row.hours_notes) : null,
    formattedAddress: row.formatted_address ? String(row.formatted_address) : null,
    addressHash: String(row.address_hash ?? ""),
    geocodeStatus: String(row.geocode_status ?? "pending") as StoreGeocodeStatus,
    geocodeAccuracy: row.geocode_accuracy ? String(row.geocode_accuracy) : null,
    geocodeError: row.geocode_error ? String(row.geocode_error) : null,
    geocodedAt: row.geocoded_at ? String(row.geocoded_at) : null,
    isActive: row.is_active !== false,
    aiVisible: row.ai_visible === true,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function assertStoreInput(input: StoreInput) {
  const postalCode = normalizePostalCode(input.postalCode);
  const state = normalizeState(input.state);
  if (input.displayName.trim().length < 2) throw new StoreLocatorError("invalid_input", "Informe o nome da filial");
  if (!input.addressLine.trim()) throw new StoreLocatorError("invalid_input", "Informe o endereco da filial");
  if (!input.neighborhood.trim()) throw new StoreLocatorError("invalid_input", "Informe o bairro da filial");
  if (!input.city.trim()) throw new StoreLocatorError("invalid_input", "Informe a cidade da filial");
  if (!/^[A-Z]{2}$/.test(state)) throw new StoreLocatorError("invalid_input", "Informe uma UF valida");
  if (!/^[0-9]{8}$/.test(postalCode)) throw new StoreLocatorError("invalid_input", "Informe um CEP com 8 digitos");
}

export class StoreLocatorService {
  private readonly googleClient: AxiosInstance;

  constructor(
    private readonly locatorClient: SupabaseClient<any, any, any>,
    private readonly googleMapsApiKey: string | null,
    private readonly routeCacheMinutes = 30,
    googleClient?: AxiosInstance,
  ) {
    this.googleClient = googleClient ?? axios.create({ timeout: 15_000 });
  }

  async listStores(acesId: number, input: { search?: string; status?: string } = {}) {
    let query = this.locatorClient
      .from("stores")
      .select("*")
      .eq("aces_id", acesId)
      .order("display_name", { ascending: true });

    const search = input.search?.trim();
    if (search) {
      const escaped = search.replace(/[^\p{L}\p{N}\s-]/gu, "");
      if (escaped) {
        query = query.or(`display_name.ilike.%${escaped}%,neighborhood.ilike.%${escaped}%,city.ilike.%${escaped}%`);
      }
    }
    if (input.status === "active") query = query.eq("is_active", true);
    if (input.status === "inactive") query = query.eq("is_active", false);
    if (input.status === "pending") query = query.neq("geocode_status", "ready");

    const { data, error } = await query;
    if (error) throw new StoreLocatorError("database_error", "Nao foi possivel carregar as filiais", error);
    return (data ?? []).map((row) => mapStore(row as Record<string, unknown>));
  }

  async saveStore(acesId: number, authUserId: string, input: StoreInput) {
    assertStoreInput(input);
    const addressHash = buildAddressHash(input);
    let current: Record<string, unknown> | null = null;

    if (input.id) {
      const { data, error } = await this.locatorClient
        .from("stores")
        .select("*")
        .eq("id", input.id)
        .eq("aces_id", acesId)
        .maybeSingle();
      if (error) throw new StoreLocatorError("database_error", "Nao foi possivel validar a filial", error);
      if (!data) throw new StoreLocatorError("not_found", "Filial nao encontrada");
      current = data as Record<string, unknown>;
    }

    const addressChanged = !current || String(current.address_hash) !== addressHash;
    const isActive = input.isActive !== false;
    const basePayload: Record<string, unknown> = {
      aces_id: acesId,
      display_name: input.displayName.trim(),
      address_line: input.addressLine.trim(),
      address_number: input.addressNumber?.trim() || null,
      address_complement: input.addressComplement?.trim() || null,
      neighborhood: input.neighborhood.trim(),
      city: input.city.trim(),
      state: normalizeState(input.state),
      postal_code: normalizePostalCode(input.postalCode),
      phone: input.phone?.trim() || null,
      weekly_hours: input.weeklyHours ?? {},
      hours_exceptions: input.hoursExceptions ?? [],
      hours_notes: input.hoursNotes?.trim() || null,
      address_hash: addressHash,
      is_active: isActive,
      updated_by: authUserId,
    };

    if (!current) basePayload.created_by = authUserId;
    if (addressChanged) {
      Object.assign(basePayload, {
        location: null,
        formatted_address: null,
        geocode_status: "pending",
        geocode_provider: null,
        geocode_accuracy: null,
        geocode_error: null,
        geocoded_at: null,
        ai_visible: false,
      });
    } else {
      basePayload.ai_visible = current?.geocode_status === "ready" && isActive;
    }

    const write = input.id
      ? this.locatorClient.from("stores").update(basePayload).eq("id", input.id).eq("aces_id", acesId).select("*").single()
      : this.locatorClient.from("stores").insert(basePayload).select("*").single();
    const { data: saved, error: saveError } = await write;
    if (saveError) throw new StoreLocatorError("database_error", "Nao foi possivel salvar a filial", saveError);

    if (!addressChanged) return mapStore(saved as Record<string, unknown>);

    try {
      const geocode = await this.geocode(buildStoreAddress(input));
      const ready = ["ROOFTOP", "RANGE_INTERPOLATED", "GEOMETRIC_CENTER"].includes(geocode.accuracy);
      const { data, error } = await this.locatorClient
        .from("stores")
        .update({
          formatted_address: geocode.formattedAddress,
          location: `SRID=4326;POINT(${geocode.longitude} ${geocode.latitude})`,
          geocode_status: ready ? "ready" : "needs_review",
          geocode_provider: "google_geocoding",
          geocode_accuracy: geocode.accuracy,
          geocode_error: ready ? null : "Geocodificacao aproximada; revise o endereco antes de ativar para a IA.",
          geocoded_at: new Date().toISOString(),
          ai_visible: ready && isActive,
        })
        .eq("id", String(saved.id))
        .eq("aces_id", acesId)
        .select("*")
        .single();
      if (error) throw new StoreLocatorError("database_error", "A filial foi salva, mas o geocode nao foi persistido", error);
      return mapStore(data as Record<string, unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida no geocode";
      const { data } = await this.locatorClient
        .from("stores")
        .update({ geocode_status: "failed", geocode_error: message, ai_visible: false })
        .eq("id", String(saved.id))
        .eq("aces_id", acesId)
        .select("*")
        .single();
      return mapStore((data ?? saved) as Record<string, unknown>);
    }
  }

  async deactivateStore(acesId: number, authUserId: string, storeId: string) {
    const { data, error } = await this.locatorClient
      .from("stores")
      .update({ is_active: false, ai_visible: false, updated_by: authUserId })
      .eq("id", storeId)
      .eq("aces_id", acesId)
      .select("*")
      .maybeSingle();
    if (error) throw new StoreLocatorError("database_error", "Nao foi possivel desativar a filial", error);
    if (!data) throw new StoreLocatorError("not_found", "Filial nao encontrada");
    return mapStore(data as Record<string, unknown>);
  }

  async recommend(input: {
    acesId: number;
    leadId: string;
    agentId: string;
    locationText: string;
    sourceMessageId?: string | null;
    candidateLimit?: number;
  }): Promise<StoreLocatorRecommendationResult> {
    const locationText = input.locationText.trim();
    if (!locationText) {
      return {
        status: "needs_input",
        normalizedLocation: null,
        recommendation: null,
        alternatives: [],
        message: "Qual e o seu bairro, CEP ou endereco?",
        externalCalls: { geocoding: 0, routes: 0 },
      };
    }

    const normalizedLocation = normalizeLocationText(locationText);
    const reused = await this.tryReuseRecommendation(input.acesId, input.leadId, normalizedLocation);
    if (reused) {
      return {
        status: reused.isFavorite ? "reused_favorite" : "reused_recommendation",
        normalizedLocation,
        recommendation: reused.store,
        alternatives: [],
        message: this.buildRecommendationMessage(reused.store),
        externalCalls: { geocoding: 0, routes: 0 },
      };
    }

    const origin = await this.geocode(`${locationText}, Brasil`);
    const limit = Math.min(Math.max(input.candidateLimit ?? 5, 1), 10);
    const { data: nearestRows, error: nearestError } = await this.locatorClient.rpc("find_nearest_stores", {
      p_aces_id: input.acesId,
      p_latitude: origin.latitude,
      p_longitude: origin.longitude,
      p_limit: limit,
    });
    if (nearestError) throw new StoreLocatorError("database_error", "Nao foi possivel comparar as filiais", nearestError);
    const nearest = (nearestRows ?? []) as NearestStoreRow[];
    if (nearest.length === 0) {
      return {
        status: "empty",
        normalizedLocation,
        recommendation: null,
        alternatives: [],
        message: "Ainda nao temos uma filial cadastrada para essa regiao.",
        externalCalls: { geocoding: 1, routes: 0 },
      };
    }

    const originKey = buildOriginKey(origin.latitude, origin.longitude);
    const routeMetrics = await this.getRouteMetrics(input.acesId, originKey, origin, nearest);
    const metricMap = new Map(routeMetrics.metrics.map((metric) => [metric.storeId, metric]));
    const ranked = nearest
      .map((store) => {
        const metric = metricMap.get(store.id);
        if (!metric) return null;
        const base = mapStore({
          ...store,
          geocode_status: "ready",
          geocode_accuracy: null,
          geocode_error: null,
          geocoded_at: null,
          is_active: true,
          ai_visible: true,
          created_at: "",
          updated_at: "",
        });
        return {
          ...base,
          latitude: Number(store.latitude),
          longitude: Number(store.longitude),
          straightLineDistanceMeters: Number(store.straight_line_distance_meters),
          routeDistanceMeters: metric.distanceMeters,
          routeDurationSeconds: metric.durationSeconds,
        } satisfies StoreRecommendation;
      })
      .filter((store): store is StoreRecommendation => store !== null)
      .sort((left, right) => left.routeDurationSeconds - right.routeDurationSeconds);

    const recommendation = ranked[0] ?? null;
    if (!recommendation) throw new StoreLocatorError("provider_unavailable", "Nao foi possivel calcular as rotas das filiais");

    const { error: eventError } = await this.locatorClient.from("lead_location_events").insert({
      aces_id: input.acesId,
      lead_id: input.leadId,
      agent_id: input.agentId,
      source_message_id: input.sourceMessageId ?? null,
      raw_location_text: locationText,
      normalized_location_text: normalizedLocation,
      latitude: origin.latitude,
      longitude: origin.longitude,
      location: `SRID=4326;POINT(${origin.longitude} ${origin.latitude})`,
      neighborhood: origin.neighborhood,
      city: origin.city,
      state: origin.state,
      recommended_store_id: recommendation.id,
      recommended_store_address_hash: recommendation.addressHash,
      candidate_store_ids: ranked.map((store) => store.id),
      route_distance_meters: recommendation.routeDistanceMeters,
      route_duration_seconds: recommendation.routeDurationSeconds,
    });
    if (eventError) throw new StoreLocatorError("database_error", "A recomendacao foi calculada, mas a localizacao nao foi registrada", eventError);

    return {
      status: "succeeded",
      normalizedLocation,
      recommendation,
      alternatives: ranked.slice(1, 5),
      message: this.buildRecommendationMessage(recommendation),
      externalCalls: { geocoding: 1, routes: routeMetrics.calledProvider ? 1 : 0 },
    };
  }

  async confirmStore(input: {
    acesId: number;
    leadId: string;
    storeId: string;
    preferenceType: "favorite" | "secondary";
    sourceMessageId?: string | null;
  }) {
    const { data: store, error: storeError } = await this.locatorClient
      .from("stores")
      .select("*")
      .eq("id", input.storeId)
      .eq("aces_id", input.acesId)
      .eq("is_active", true)
      .maybeSingle();
    if (storeError) throw new StoreLocatorError("database_error", "Nao foi possivel validar a filial", storeError);
    if (!store) throw new StoreLocatorError("not_found", "Filial nao encontrada ou inativa");

    const { data, error } = await this.locatorClient.rpc("set_lead_store_preference", {
      p_aces_id: input.acesId,
      p_lead_id: input.leadId,
      p_store_id: input.storeId,
      p_preference_type: input.preferenceType,
      p_confirmed_by: "lead",
      p_source_message_id: input.sourceMessageId ?? null,
    });
    if (error) throw new StoreLocatorError("database_error", "Nao foi possivel salvar a filial preferida", error);

    const { data: latestEvent } = await this.locatorClient
      .from("lead_location_events")
      .select("id")
      .eq("aces_id", input.acesId)
      .eq("lead_id", input.leadId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestEvent?.id) {
      await this.locatorClient
        .from("lead_location_events")
        .update({ selected_store_id: input.storeId })
        .eq("id", latestEvent.id)
        .eq("aces_id", input.acesId);
    }

    return { preference: Array.isArray(data) ? data[0] : data, store: mapStore(store as Record<string, unknown>) };
  }

  async getLeadPreferences(acesId: number, leadId: string) {
    const { data: preferences, error: preferenceError } = await this.locatorClient
      .from("lead_store_preferences")
      .select("id,store_id,preference_type,confirmed_by,confirmed_at")
      .eq("aces_id", acesId)
      .eq("lead_id", leadId)
      .is("superseded_at", null)
      .order("preference_type", { ascending: true });
    if (preferenceError) throw new StoreLocatorError("database_error", "Nao foi possivel carregar as preferencias de filial", preferenceError);

    const storeIds = (preferences ?? []).map((preference) => String(preference.store_id));
    if (storeIds.length === 0) return [];
    const { data: stores, error: storesError } = await this.locatorClient
      .from("stores")
      .select("*")
      .eq("aces_id", acesId)
      .in("id", storeIds);
    if (storesError) throw new StoreLocatorError("database_error", "Nao foi possivel carregar as filiais preferidas", storesError);
    const storeMap = new Map((stores ?? []).map((store) => [String(store.id), mapStore(store as Record<string, unknown>)]));
    return (preferences ?? []).map((preference) => ({
      id: String(preference.id),
      preferenceType: String(preference.preference_type) as "favorite" | "secondary",
      confirmedBy: String(preference.confirmed_by),
      confirmedAt: String(preference.confirmed_at),
      store: storeMap.get(String(preference.store_id)) ?? null,
    }));
  }

  async recommendAlternative(acesId: number, leadId: string) {
    const { data: event, error: eventError } = await this.locatorClient
      .from("lead_location_events")
      .select("id,recommended_store_id,candidate_store_ids")
      .eq("aces_id", acesId)
      .eq("lead_id", leadId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (eventError) throw new StoreLocatorError("database_error", "Nao foi possivel recuperar as alternativas", eventError);
    const candidates = Array.isArray(event?.candidate_store_ids) ? event.candidate_store_ids.map(String) : [];
    const currentIndex = candidates.indexOf(String(event?.recommended_store_id ?? ""));
    const nextId = candidates[currentIndex + 1] ?? candidates.find((id) => id !== event?.recommended_store_id);
    if (!event?.id || !nextId) return null;

    const { data: store, error: storeError } = await this.locatorClient
      .from("stores")
      .select("*")
      .eq("id", nextId)
      .eq("aces_id", acesId)
      .eq("is_active", true)
      .eq("ai_visible", true)
      .maybeSingle();
    if (storeError) throw new StoreLocatorError("database_error", "Nao foi possivel carregar a filial alternativa", storeError);
    if (!store) return null;

    const { error: updateError } = await this.locatorClient
      .from("lead_location_events")
      .update({ recommended_store_id: nextId, recommended_store_address_hash: store.address_hash })
      .eq("id", event.id)
      .eq("aces_id", acesId);
    if (updateError) throw new StoreLocatorError("database_error", "Nao foi possivel registrar a alternativa apresentada", updateError);
    return mapStore(store as Record<string, unknown>);
  }

  async confirmLatestStore(input: {
    acesId: number;
    leadId: string;
    requestedPreferenceType: "favorite" | "secondary";
    sourceMessageId?: string | null;
  }) {
    const { data: event, error: eventError } = await this.locatorClient
      .from("lead_location_events")
      .select("recommended_store_id")
      .eq("aces_id", input.acesId)
      .eq("lead_id", input.leadId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (eventError) throw new StoreLocatorError("database_error", "Nao foi possivel recuperar a filial apresentada", eventError);
    const storeId = event?.recommended_store_id ? String(event.recommended_store_id) : null;
    if (!storeId) throw new StoreLocatorError("not_found", "Nenhuma filial esta aguardando confirmacao");

    let preferenceType = input.requestedPreferenceType;
    if (preferenceType === "secondary") {
      const { count, error } = await this.locatorClient
        .from("lead_store_preferences")
        .select("id", { count: "exact", head: true })
        .eq("aces_id", input.acesId)
        .eq("lead_id", input.leadId)
        .eq("preference_type", "favorite")
        .is("superseded_at", null);
      if (error) throw new StoreLocatorError("database_error", "Nao foi possivel validar a filial favorita", error);
      if (Number(count ?? 0) === 0) preferenceType = "favorite";
    }

    return this.confirmStore({
      acesId: input.acesId,
      leadId: input.leadId,
      storeId,
      preferenceType,
      sourceMessageId: input.sourceMessageId,
    });
  }

  private async tryReuseRecommendation(acesId: number, leadId: string, normalizedLocation: string) {
    const { data: event, error: eventError } = await this.locatorClient
      .from("lead_location_events")
      .select("normalized_location_text,recommended_store_id,recommended_store_address_hash,latitude,longitude,route_distance_meters,route_duration_seconds")
      .eq("aces_id", acesId)
      .eq("lead_id", leadId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (eventError) throw new StoreLocatorError("database_error", "Nao foi possivel validar a ultima localizacao", eventError);
    if (!event || String(event.normalized_location_text) !== normalizedLocation) return null;

    const eventStoreId = event.recommended_store_id ? String(event.recommended_store_id) : null;
    if (!eventStoreId) return null;

    const { data: preferences, error: preferenceError } = await this.locatorClient
      .from("lead_store_preferences")
      .select("store_id")
      .eq("aces_id", acesId)
      .eq("lead_id", leadId)
      .eq("preference_type", "favorite")
      .is("superseded_at", null)
      .limit(1);
    if (preferenceError) throw new StoreLocatorError("database_error", "Nao foi possivel validar a filial favorita", preferenceError);
    const favoriteStoreId = preferences?.[0]?.store_id ? String(preferences[0].store_id) : null;
    const storeIdToReuse = favoriteStoreId ?? eventStoreId;

    const { data: store, error: storeError } = await this.locatorClient
      .from("stores")
      .select("*")
      .eq("id", storeIdToReuse)
      .eq("aces_id", acesId)
      .eq("is_active", true)
      .eq("ai_visible", true)
      .maybeSingle();
    if (storeError) throw new StoreLocatorError("database_error", "Nao foi possivel reutilizar a filial favorita", storeError);
    if (!store) return null;
    if (!favoriteStoreId && String(store.address_hash) !== String(event.recommended_store_address_hash ?? "")) return null;

    return { store: {
      ...mapStore(store as Record<string, unknown>),
      latitude: Number(event.latitude),
      longitude: Number(event.longitude),
      straightLineDistanceMeters: 0,
      routeDistanceMeters: favoriteStoreId && favoriteStoreId !== eventStoreId ? 0 : Number(event.route_distance_meters ?? 0),
      routeDurationSeconds: favoriteStoreId && favoriteStoreId !== eventStoreId ? 0 : Number(event.route_duration_seconds ?? 0),
    } satisfies StoreRecommendation, isFavorite: Boolean(favoriteStoreId) };
  }

  private async geocode(address: string): Promise<GeocodeResult> {
    if (!this.googleMapsApiKey) {
      throw new StoreLocatorError("provider_unavailable", "GOOGLE_MAPS_API_KEY nao configurada");
    }
    try {
      const response = await this.googleClient.get("https://maps.googleapis.com/maps/api/geocode/json", {
        params: { address, key: this.googleMapsApiKey, region: "br", language: "pt-BR" },
      });
      const payload = response.data as {
        status?: string;
        error_message?: string;
        results?: Array<{
          formatted_address?: string;
          geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
          address_components?: Array<{ long_name?: string; short_name?: string; types?: string[] }>;
        }>;
      };
      const result = payload.results?.[0];
      const latitude = result?.geometry?.location?.lat;
      const longitude = result?.geometry?.location?.lng;
      if (payload.status !== "OK" || !result || latitude === undefined || longitude === undefined) {
        throw new Error(payload.error_message || `Google Geocoding retornou ${payload.status ?? "sem status"}`);
      }
      const component = (type: string, short = false) => {
        const found = result.address_components?.find((item) => item.types?.includes(type));
        return found ? String(short ? found.short_name ?? found.long_name : found.long_name ?? found.short_name) : null;
      };
      return {
        latitude,
        longitude,
        formattedAddress: result.formatted_address ?? address,
        accuracy: result.geometry?.location_type ?? "APPROXIMATE",
        neighborhood: component("sublocality_level_1") ?? component("neighborhood"),
        city: component("administrative_area_level_2") ?? component("locality"),
        state: component("administrative_area_level_1", true),
      };
    } catch (error) {
      if (error instanceof StoreLocatorError) throw error;
      throw new StoreLocatorError(
        "provider_unavailable",
        "Nao foi possivel geocodificar o endereco",
        safeProviderDetails(error),
      );
    }
  }

  private async getRouteMetrics(
    acesId: number,
    originKey: string,
    origin: GeocodeResult,
    stores: NearestStoreRow[],
  ) {
    const storeIds = stores.map((store) => store.id);
    const { data: cached, error: cacheError } = await this.locatorClient
      .from("route_cache")
      .select("store_id,distance_meters,duration_seconds")
      .eq("aces_id", acesId)
      .eq("origin_key", originKey)
      .eq("travel_mode", "DRIVE")
      .gt("expires_at", new Date().toISOString())
      .in("store_id", storeIds);
    if (cacheError) throw new StoreLocatorError("database_error", "Nao foi possivel consultar o cache de rotas", cacheError);

    const metrics = new Map<string, RouteMetric>();
    for (const row of cached ?? []) {
      metrics.set(String(row.store_id), {
        storeId: String(row.store_id),
        distanceMeters: Number(row.distance_meters),
        durationSeconds: Number(row.duration_seconds),
      });
    }
    const missing = stores.filter((store) => !metrics.has(store.id));
    if (missing.length === 0) return { metrics: [...metrics.values()], calledProvider: false };
    if (!this.googleMapsApiKey) throw new StoreLocatorError("provider_unavailable", "GOOGLE_MAPS_API_KEY nao configurada");

    try {
      const response = await this.googleClient.post(
        "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
        {
          origins: [{ waypoint: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } } }],
          destinations: missing.map((store) => ({
            waypoint: { location: { latLng: { latitude: store.latitude, longitude: store.longitude } } },
          })),
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
        },
        {
          headers: {
            "X-Goog-Api-Key": this.googleMapsApiKey,
            "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,distanceMeters,duration",
          },
        },
      );
      const rows = Array.isArray(response.data) ? response.data : [];
      for (const row of rows as Array<Record<string, unknown>>) {
        const destinationIndex = Number(row.destinationIndex);
        const store = missing[destinationIndex];
        const durationSeconds = parseDurationSeconds(row.duration);
        const distanceMeters = Number(row.distanceMeters);
        if (!store || durationSeconds === null || !Number.isFinite(distanceMeters)) continue;
        metrics.set(store.id, { storeId: store.id, distanceMeters, durationSeconds });
      }
    } catch (error) {
      throw new StoreLocatorError(
        "provider_unavailable",
        "Nao foi possivel calcular o tempo de carro",
        safeProviderDetails(error),
      );
    }

    const expiresAt = new Date(Date.now() + this.routeCacheMinutes * 60_000).toISOString();
    const newMetrics = missing.map((store) => metrics.get(store.id)).filter((metric): metric is RouteMetric => Boolean(metric));
    if (newMetrics.length > 0) {
      const { error: upsertError } = await this.locatorClient.from("route_cache").upsert(
        newMetrics.map((metric) => ({
          aces_id: acesId,
          origin_key: originKey,
          store_id: metric.storeId,
          travel_mode: "DRIVE",
          distance_meters: metric.distanceMeters,
          duration_seconds: metric.durationSeconds,
          expires_at: expiresAt,
        })),
        { onConflict: "aces_id,origin_key,store_id,travel_mode" },
      );
      if (upsertError) throw new StoreLocatorError("database_error", "Nao foi possivel atualizar o cache de rotas", upsertError);
    }
    return { metrics: [...metrics.values()], calledProvider: true };
  }

  private buildRecommendationMessage(store: StoreRecommendation) {
    const number = store.addressNumber ? `, ${store.addressNumber}` : "";
    return `A unidade mais indicada para voce e a ${store.displayName}, na ${store.addressLine}${number}, ${store.neighborhood}.`;
  }
}
