export function normalizeCnpj(value: string) {
  return value.replace(/[^0-9a-z]/gi, "").toUpperCase().slice(0, 14);
}

export function formatCnpj(value: string) {
  const normalized = normalizeCnpj(value);
  const parts = [
    normalized.slice(0, 2),
    normalized.slice(2, 5),
    normalized.slice(5, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 14),
  ];

  let formatted = parts[0];
  if (parts[1]) formatted += `.${parts[1]}`;
  if (parts[2]) formatted += `.${parts[2]}`;
  if (parts[3]) formatted += `/${parts[3]}`;
  if (parts[4]) formatted += `-${parts[4]}`;
  return formatted;
}

export function isValidCnpj(value: string) {
  const cnpj = normalizeCnpj(value);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const characterValue = (character: string) => character.charCodeAt(0) - 48;
  const calculateDigit = (base: string, weights: number[]) => {
    const sum = base.split("").reduce(
      (total, character, index) => total + characterValue(character) * weights[index],
      0,
    );
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstDigit = calculateDigit(
    cnpj.slice(0, 12),
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  if (firstDigit !== Number(cnpj[12])) return false;

  const secondDigit = calculateDigit(
    `${cnpj.slice(0, 12)}${firstDigit}`,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return secondDigit === Number(cnpj[13]);
}
