const MANAGED_TONE_START = "[ARQUEM_MANAGED_TONE_START]";
const MANAGED_TONE_END = "[ARQUEM_MANAGED_TONE_END]";

export interface ParsedAgentPrompt {
  tone: string;
  promptBody: string;
}

export interface PromptGuidanceSection {
  title: string;
  description: string;
  required: boolean;
}

export const PROMPT_GUIDANCE_INTRO =
  "Monte o prompt seguindo a ordem do template-base. Secoes opcionais devem entrar apenas quando fizerem sentido para a operacao da instancia.";

export const PROMPT_GUIDANCE_SECTIONS: PromptGuidanceSection[] = [
  {
    title: "Identidade do Agente",
    description:
      "Defina nome do agente, empresa, nicho e tom da marca antes de personalizar o restante.",
    required: true,
  },
  {
    title: "Regras Invioláveis",
    description:
      "Configure formato de mensagem, regras de preco, restricoes operacionais, LGPD e uso obrigatorio de tools.",
    required: true,
  },
  {
    title: "Diretriz Principal",
    description:
      "Descreva identidade, personalidade, tom de voz e objetivo principal do consultor virtual.",
    required: true,
  },
  {
    title: "Abertura e Coleta Inicial",
    description:
      "Defina como o agente abre a conversa no primeiro contato e como reage a saudacoes genericas ou pedidos diretos.",
    required: true,
  },
  {
    title: "Framework CARE",
    description:
      "Preencha tom, qualificacao, recomendacao, urgencia e protocolo de conversao presencial.",
    required: true,
  },
  {
    title: "Fluxos Especiais",
    description:
      "Use apenas se a operacao tiver parceiros, consultoria gratuita ou outros desvios reais de fluxo.",
    required: false,
  },
  {
    title: "Decision Matrix e Tools",
    description:
      "Mapeie intencoes do lead para tools da plataforma e valide os gatilhos de uso de cada uma.",
    required: true,
  },
  {
    title: "Objecoes",
    description:
      "Prepare respostas para preco, duvidas comuns e objecoes comerciais sem perder o tom da marca.",
    required: true,
  },
  {
    title: "Base de Conhecimento",
    description:
      "Preencha empresa, proposta de valor, produtos, diferenciais, promocoes, pagamentos, horarios e canais oficiais.",
    required: true,
  },
  {
    title: "Finalizacao e Memoria",
    description:
      "Defina encerramento, voucher e regras de uso das ferramentas cognitivas como Think e ChatMemory.",
    required: true,
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
