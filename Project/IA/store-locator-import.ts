import type { StoreInput } from "./store-locator-service.js";

export type StoreImportIssue = {
  storeName: string;
  field: "city" | "state" | "postalCode" | "phone" | "address";
  value: string;
  reason: string;
};

export type StoreImportDraft = StoreInput & {
  sourceCity: string;
  sourceState: string;
};

const CITY_AREA_CODES: Record<string, string> = {
  "almirante tamandare": "41",
  arapoti: "43",
  araucaria: "41",
  avare: "14",
  cambe: "43",
  "campina grande do sul": "41",
  "campo largo": "41",
  castro: "42",
  colombo: "41",
  "cornelio procopio": "43",
  curitiba: "41",
  "fazenda rio grande": "41",
  florianopolis: "48",
  "francisco beltrao": "46",
  guarapuava: "42",
  indaial: "47",
  itajai: "47",
  "jaragua do sul": "47",
  joinville: "47",
  londrina: "43",
  "lucas do rio verde": "66",
  maringa: "44",
  matinhos: "41",
  paranagua: "41",
  "patos de minas": "34",
  pinhais: "41",
  piraquara: "41",
  "pocos de caldas": "35",
  "ponta grossa": "42",
  salvador: "71",
  "sao jose dos pinhais": "41",
  vilhena: "69",
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseAddress(value: string) {
  const commaMatch = value.match(/^(.*?),\s*([0-9]+)(.*)$/);
  const spaceMatch = value.match(/^(.*\D)\s+([0-9]+)(.*)$/);
  const match = commaMatch ?? spaceMatch;
  if (!match) return { addressLine: value.trim(), addressNumber: null, addressComplement: null };
  return {
    addressLine: match[1].trim(),
    addressNumber: match[2].trim(),
    addressComplement: match[3].replace(/^[\s,-]+/, "").trim() || null,
  };
}

function normalizePhone(value: string, city: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
  if (digits.length === 8 || digits.length === 9) {
    const areaCode = CITY_AREA_CODES[normalize(city)];
    if (!areaCode) return null;
    digits = `${areaCode}${digits}`;
  }
  return digits.length === 10 || digits.length === 11 ? `+55${digits}` : null;
}

function currentValue(fields: Record<string, string>, key: string) {
  return fields[normalize(key)]?.trim() ?? "";
}

export function parseInstitutoStores(markdown: string) {
  const stores: StoreImportDraft[] = [];
  const issues: StoreImportIssue[] = [];
  let city = "";
  let state = "";
  let storeName = "";
  let fields: Record<string, string> = {};

  const flush = () => {
    if (!storeName) return;
    const rawAddress = currentValue(fields, "Endereço");
    const neighborhood = currentValue(fields, "Bairro");
    const rawPostalCode = currentValue(fields, "CEP");
    const postalCode = rawPostalCode.replace(/\D/g, "");
    const rawPhone = currentValue(fields, "Telefone");
    const phone = normalizePhone(rawPhone, city);
    const businessHours = currentValue(fields, "Horário de Funcionamento");
    const weekendHours = currentValue(fields, "FIM DE SEMANA");
    const parsedAddress = parseAddress(rawAddress);

    if (!city) issues.push({ storeName, field: "city", value: city, reason: "Cidade ausente no cabecalho" });
    if (!/^[A-Z]{2}$/.test(state)) issues.push({ storeName, field: "state", value: state, reason: "UF ausente ou invalida" });
    if (postalCode.length !== 8) issues.push({ storeName, field: "postalCode", value: rawPostalCode, reason: "CEP deve ter 8 digitos" });
    if (!phone) issues.push({ storeName, field: "phone", value: rawPhone, reason: "Telefone ou DDD invalido" });
    if (!parsedAddress.addressNumber) issues.push({ storeName, field: "address", value: rawAddress, reason: "Numero nao identificado" });

    stores.push({
      displayName: storeName.replace(/^UNIDADE\s+/i, "").trim(),
      ...parsedAddress,
      neighborhood: neighborhood || "Centro",
      city,
      state,
      postalCode,
      phone,
      weeklyHours: {},
      hoursExceptions: [],
      hoursNotes: [businessHours, weekendHours].filter(Boolean).join(" · ") || null,
      isActive: true,
      sourceCity: city,
      sourceState: state,
    });
    storeName = "";
    fields = {};
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^###\s+(.+?)\s+-\s+([A-Z]{2})$/);
    if (heading) {
      flush();
      city = heading[1].trim();
      state = heading[2].trim();
      continue;
    }
    if (/^\*\s+\*\*UNIDADE\s+/i.test(line)) {
      flush();
      storeName = line.replace(/^\*\s+\*\*/, "").replace(/\*\*$/, "").trim();
      continue;
    }
    if (!storeName) continue;
    const field = line.match(/^\*\s+([^:]+):\s*(.*)$/);
    if (field) fields[normalize(field[1])] = field[2].trim();
  }
  flush();

  return { stores, issues };
}
