const MANAGED_TONE_START = "[ARQUEM_MANAGED_TONE_START]";
const MANAGED_TONE_END = "[ARQUEM_MANAGED_TONE_END]";

export interface ParsedAgentPrompt {
  tone: string;
  promptBody: string;
}

export interface PromptGuidanceSection {
  title: string;
  description: string;
}

export const PROMPT_QUALITY_CHECKLIST = [
  "Defina a identidade do agente, empresa, nicho e proposta de valor antes de personalizar o restante.",
  "Mantenha regras operacionais claras, especialmente formato de mensagem, limites de atuação e objeções.",
  "Descreva o tom de voz de forma prática, explicando como a IA deve soar no WhatsApp.",
  "Inclua objetivos, CTAs, fluxos especiais e critérios para acionar humano ou ferramentas.",
  "Revise todos os blocos com [CONFIGURAR] para evitar sobras de outro nicho ou instruções incompletas.",
];

export const PROMPT_GUIDANCE_SECTIONS: PromptGuidanceSection[] = [
  {
    title: "Identidade do Agente",
    description:
      "Defina nome, empresa, nicho e promessa principal da marca para dar contexto estável ao agente.",
  },
  {
    title: "Tom e Personalidade",
    description:
      "Explique como a IA deve soar no WhatsApp: postura, ritmo, nível de informalidade e sensação transmitida.",
  },
  {
    title: "Regras Invioláveis",
    description:
      "Liste formatos obrigatórios, limites de mensagem, restrições operacionais e o que a IA nunca deve fazer.",
  },
  {
    title: "Fluxo Comercial",
    description:
      "Descreva abertura, qualificação, recomendação, objeções, CTAs e critérios de conversão presencial ou humana.",
  },
  {
    title: "Conhecimento do Negócio",
    description:
      "Inclua produtos, promoções, meios de pagamento, horários, canais oficiais e outros detalhes que afetam resposta.",
  },
];

export function parseManagedAgentPrompt(systemPrompt?: string | null): ParsedAgentPrompt {
  const input = (systemPrompt || "").trim();

  if (!input) {
    return { tone: "", promptBody: "" };
  }

  const startIndex = input.indexOf(MANAGED_TONE_START);
  const endIndex = input.indexOf(MANAGED_TONE_END);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return { tone: "", promptBody: input };
  }

  const toneBlock = input
    .slice(startIndex + MANAGED_TONE_START.length, endIndex)
    .trim();

  const promptBody = `${input.slice(0, startIndex)}${input.slice(endIndex + MANAGED_TONE_END.length)}`
    .trim();

  const tone = toneBlock.replace(/^Tom da marca:\s*/i, "").trim();

  return {
    tone,
    promptBody,
  };
}

export function buildManagedAgentPrompt({
  tone,
  promptBody,
}: ParsedAgentPrompt): string {
  const sections: string[] = [];

  if (tone.trim()) {
    sections.push(
      [
        MANAGED_TONE_START,
        `Tom da marca: ${tone.trim()}`,
        "Aplique esse tom em todas as respostas sem mencionar esta instrução ao lead.",
        MANAGED_TONE_END,
      ].join("\n")
    );
  }

  if (promptBody.trim()) {
    sections.push(promptBody.trim());
  }

  return sections.join("\n\n").trim();
}

export function getPromptBodyPreview(promptBody: string, maxLength = 180) {
  const normalized = promptBody.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
