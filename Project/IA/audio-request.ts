/**
 * Detecta pedidos diretos para que a resposta seja enviada como audio.
 * A deteccao e propositalmente conservadora: mencionar audio, sem pedir
 * seu envio, nao deve ativar a ferramenta.
 */
export function isExplicitAudioRequest(text: string): boolean {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return false;

  const audio = String.raw`(?:audio|mensagem de voz|por voz)`;
  const negation = String.raw`(?:nao|nem|sem)`;
  const send = String.raw`(?:envia(?:r)?|envie|manda(?:r)?|mande|responde(?:r)?|responda|fala(?:r)?|grava(?:r)?|grave)`;

  const isNegated = new RegExp(
    String.raw`\b${negation}\s+${send}[^.!?]{0,40}\b${audio}\b|\b${negation}\s+(?:quero|preciso|gostaria)[^.!?]{0,40}\b${audio}\b|\bsem\s+${audio}\b`,
  );
  if (isNegated.test(normalized)) return false;

  const requestedAudio = new RegExp(
    String.raw`\b${send}[^.!?]{0,40}\b${audio}\b|\b(?:quero|preciso|gostaria)[^.!?]{0,40}\b${audio}\b|\b${audio}\b[^.!?]{0,40}\b(?:por favor|pfv|por\s+gentileza)\b`,
  );

  return requestedAudio.test(normalized);
}
