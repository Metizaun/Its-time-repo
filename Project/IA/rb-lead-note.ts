const RB_NOTE_HEADING = "Dados do Registro Base";

export type RbLeadNoteInput = {
  clieId: string;
  companyName?: string | null;
  storeEmpId?: string | null;
  storeCnpj?: string | null;
};

function formatCnpj(value?: string | null) {
  const normalized = String(value ?? "").replace(/\D/g, "");
  if (normalized.length !== 14) return normalized || "Não informado";

  return normalized.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5",
  );
}

export function buildRbLeadNote(input: RbLeadNoteInput) {
  const company = input.companyName?.trim()
    || (input.storeEmpId?.trim() ? `Loja ${input.storeEmpId.trim()}` : "Não informada");

  return [
    RB_NOTE_HEADING,
    "",
    `Código RB: ${input.clieId.trim()}`,
    `Empresa: ${company}`,
    `CNPJ: ${formatCnpj(input.storeCnpj)}`,
  ].join("\n");
}

export function upsertRbLeadNote(existingNotes: string | null, input: RbLeadNoteInput) {
  const block = buildRbLeadNote(input);
  const notes = existingNotes?.trim() ?? "";
  const rbBlockPattern = /(?:^|\n{2,})Dados do Registro Base\n\nCódigo RB:[^\n]*\nEmpresa:[^\n]*\nCNPJ:[^\n]*(?=\n{2,}|$)/m;
  const preservedNotes = notes.replace(rbBlockPattern, "").trim();

  return [block, preservedNotes].filter(Boolean).join("\n\n");
}

export const rbLeadNoteInternals = { formatCnpj };
