import axios, { type AxiosInstance } from "axios";
import { readFile } from "node:fs/promises";

export type RbBillingMode = "live" | "mock";
export type RbBillingJourneyKind = "reminder" | "charge";

export type RbBillingRecord = {
  sourceBucket: string;
  ACES_ID: string | number | null;
  CLIE_ID: string | number | null;
  CLIE_NOMEPRINC: string | null;
  CLIE_NOMESEC: string | null;
  CLIE_CPFCNPJ: string | null;
  CLIE_FONE: string | null;
  FIN_VLLIQUIDO: string | number | null;
  DtVencimento: string | null;
  DiasVenc: string | number | null;
  PGTO_IDORIGEM?: string | number | null;
  FORMA_ID: string | number | null;
  EMP_ID: string | number | null;
  EMP_CPFCNPJ: string | null;
  Titulo: string | null;
  [key: string]: unknown;
};

type RbClientConfig = {
  mode: RbBillingMode;
  baseUrl: string;
  tokenApi: string;
  empresaIds: string[];
  mockFixturePath?: string | null;
  timeoutMs?: number;
};

type AuthResponse = {
  token?: string;
};

type RbApiEnvelope = {
  RESULT?: Array<{ data?: Array<Record<string, unknown>> }>;
};

function asString(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? null : String(value);
}

function asNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function flattenEnvelope(envelope: RbApiEnvelope | null | undefined, sourceBucket: RbBillingRecord["sourceBucket"]) {
  const rows: RbBillingRecord[] = [];
  for (const page of envelope?.RESULT ?? []) {
    for (const row of page?.data ?? []) {
      rows.push({
        sourceBucket,
        ...row,
      } as RbBillingRecord);
    }
  }
  return rows;
}

function matchesRule(row: RbBillingRecord, kind: RbBillingJourneyKind, qtdeDias: number) {
  const diasVenc = RbClient.normalizeMoney(row.DiasVenc);

  if (kind === "reminder") {
    return qtdeDias === 0 ? diasVenc === 0 : diasVenc === -Math.abs(qtdeDias);
  }

  return diasVenc === Math.abs(qtdeDias);
}

function buildLegacySampleRows(): RbBillingRecord[] {
  return [
    {
      sourceBucket: "due_in_2_days",
      ACES_ID: 5,
      CLIE_ID: 10146,
      CLIE_NOMEPRINC: "Ana Paula Souza",
      CLIE_NOMESEC: null,
      CLIE_CPFCNPJ: "12345678901",
      CLIE_FONE: "41999990001",
      FIN_VLLIQUIDO: 126.67,
      DtVencimento: "2026-07-09",
      DiasVenc: -2,
      PGTO_IDORIGEM: 6,
      FORMA_ID: 6,
      EMP_ID: 1,
      EMP_CPFCNPJ: "66972304000129",
      Titulo: "TIT-1001",
    },
    {
      sourceBucket: "due_in_2_days",
      ACES_ID: 5,
      CLIE_ID: 10146,
      CLIE_NOMEPRINC: "Ana Paula Souza",
      CLIE_NOMESEC: null,
      CLIE_CPFCNPJ: "12345678901",
      CLIE_FONE: "41999990001",
      FIN_VLLIQUIDO: 59.9,
      DtVencimento: "2026-07-09",
      DiasVenc: -2,
      PGTO_IDORIGEM: 6,
      FORMA_ID: 6,
      EMP_ID: 1,
      EMP_CPFCNPJ: "66972304000129",
      Titulo: "TIT-1002",
    },
    {
      sourceBucket: "overdue_4_days",
      ACES_ID: 5,
      CLIE_ID: 10350,
      CLIE_NOMEPRINC: "Antonio Carlos",
      CLIE_NOMESEC: null,
      CLIE_CPFCNPJ: "98765432100",
      CLIE_FONE: "41999990002",
      FIN_VLLIQUIDO: 214.3,
      DtVencimento: "2026-07-03",
      DiasVenc: 4,
      PGTO_IDORIGEM: 6,
      FORMA_ID: 6,
      EMP_ID: 2,
      EMP_CPFCNPJ: "66972192000106",
      Titulo: "TIT-2001",
    },
    {
      sourceBucket: "overdue_15_days",
      ACES_ID: 5,
      CLIE_ID: 10351,
      CLIE_NOMEPRINC: "Lucimar Candida de Paula",
      CLIE_NOMESEC: null,
      CLIE_CPFCNPJ: "11122233344",
      CLIE_FONE: "41999990003",
      FIN_VLLIQUIDO: 598.5,
      DtVencimento: "2026-06-21",
      DiasVenc: 16,
      PGTO_IDORIGEM: 6,
      FORMA_ID: 6,
      EMP_ID: 2,
      EMP_CPFCNPJ: "66972192000106",
      Titulo: "TIT-3001",
    },
  ];
}

export class RbClient {
  private readonly config: RbClientConfig;
  private readonly http: AxiosInstance;

  constructor(config: RbClientConfig) {
    this.config = config;
    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/$/, ""),
      timeout: config.timeoutMs ?? 30000,
      validateStatus: () => true,
    });
  }

  private async loadMockRows() {
    if (this.config.mockFixturePath) {
      const raw = await readFile(this.config.mockFixturePath, "utf8");
      const parsed = parseJson<RbApiEnvelope | RbBillingRecord[]>(raw);
      if (Array.isArray(parsed)) {
        return parsed as RbBillingRecord[];
      }
      const flattened =
        flattenEnvelope(parsed as RbApiEnvelope, "due_in_2_days").length > 0
          ? flattenEnvelope(parsed as RbApiEnvelope, "due_in_2_days")
          : buildLegacySampleRows();
      return flattened;
    }

    return buildLegacySampleRows();
  }

  private async authenticateLive() {
    const response = await this.http.get<AuthResponse>("/auth", {
      params: {
        tokenapi: this.config.tokenApi,
      },
    });

    if (response.status < 200 || response.status >= 300 || !response.data?.token) {
      throw new Error(`Falha ao autenticar no RB (${response.status})`);
    }

    return response.data.token;
  }

  private async fetchLiveBucket(
    token: string,
    endpoint: "/apiIA/listardocreceber" | "/apiIA/listardocvencidos",
    qtdeDias: number,
    sourceBucket: RbBillingRecord["sourceBucket"]
  ) {
    const body = new URLSearchParams();
    body.set("function", "1");
    body.set("TokenAPI", this.config.tokenApi);
    body.set("qtdeDias", String(qtdeDias));
    body.set("empresa", this.config.empresaIds.join(","));
    body.set("pagenumber", "1");
    body.set("RowspPage", "100");
    body.set("CLIE_ID", "");

    const response = await this.http.request<RbApiEnvelope>({
      url: endpoint,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: body.toString(),
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Falha ao buscar ${endpoint} (${response.status})`);
    }

    return flattenEnvelope(response.data, sourceBucket);
  }

  async fetchAllOpenTitles() {
    if (this.config.mode === "mock") {
      return this.loadMockRows();
    }

    const token = await this.authenticateLive();
    const [due2, dueToday, overdue1, overdue4, overdue15] = await Promise.all([
      this.fetchLiveBucket(token, "/apiIA/listardocreceber", 2, "due_in_2_days"),
      this.fetchLiveBucket(token, "/apiIA/listardocreceber", 0, "due_today"),
      this.fetchLiveBucket(token, "/apiIA/listardocvencidos", 1, "overdue_1_day"),
      this.fetchLiveBucket(token, "/apiIA/listardocvencidos", 4, "overdue_4_days"),
      this.fetchLiveBucket(token, "/apiIA/listardocvencidos", 15, "overdue_15_days"),
    ]);

    return [...due2, ...dueToday, ...overdue1, ...overdue4, ...overdue15];
  }

  async fetchTitlesForRule(kind: RbBillingJourneyKind, qtdeDias: number) {
    const normalizedDays = Math.max(0, Math.trunc(qtdeDias));

    if (this.config.mode === "mock") {
      const rows = await this.loadMockRows();
      return rows
        .filter((row) => matchesRule(row, kind, normalizedDays))
        .map((row) => ({
          ...row,
          sourceBucket: kind === "reminder" ? `reminder_${normalizedDays}` : `charge_${normalizedDays}`,
        }));
    }

    const token = await this.authenticateLive();
    return this.fetchLiveBucket(
      token,
      kind === "reminder" ? "/apiIA/listardocreceber" : "/apiIA/listardocvencidos",
      normalizedDays,
      kind === "reminder" ? `reminder_${normalizedDays}` : `charge_${normalizedDays}`,
    );
  }

  static normalizeMoney(value: unknown) {
    return asNumber(value) ?? 0;
  }

  static normalizeString(value: unknown) {
    return asString(value)?.trim() || "";
  }
}
