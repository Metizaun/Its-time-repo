export type ChatQuickReplyOption = {
  id: string | null;
  title: string;
};

export type ChatQuickReplyInteraction =
  | {
      kind: "options";
      options: ChatQuickReplyOption[];
    }
  | {
      kind: "selection";
      selectedOption: ChatQuickReplyOption;
      replyToMessageId: string | null;
    };

export type QuickReplyMessageInput = {
  id: string;
  content: string;
  direction: string;
  provider_message_id?: string | null;
  provider_payload_summary?: unknown;
};

export type NormalizedQuickReplyMessage = {
  content: string;
  quickReply: ChatQuickReplyInteraction | null;
};

export type ProviderQuickReplySelection = {
  selectedOption: ChatQuickReplyOption;
  contextMessageIds: string[];
};

type ParsedQuickReplyPrompt = {
  content: string;
  options: ChatQuickReplyOption[];
};

const QUICK_REPLY_SUFFIX = /((?:\s*\|\s*\[[^\]\r\n]{1,80}\]){1,3})\s*$/u;
const QUICK_REPLY_OPTION = /\|\s*\[([^\]\r\n]{1,80})\]/gu;

export function parseQuickReplyPrompt(content: string): ParsedQuickReplyPrompt | null {
  const suffix = content.match(QUICK_REPLY_SUFFIX);
  if (!suffix || suffix.index === undefined) return null;

  const body = content.slice(0, suffix.index).trimEnd();
  if (!body) return null;

  const options = Array.from(suffix[1].matchAll(QUICK_REPLY_OPTION), (match, index) => ({
    id: `quick-reply-${index + 1}`,
    title: match[1].trim(),
  })).filter((option) => option.title.length > 0);

  if (options.length === 0 || options.length > 3) return null;
  return { content: body, options };
}

export function extractProviderQuickReplySelection(
  payloadSummary: unknown,
): ProviderQuickReplySelection | null {
  const summary = asRecord(payloadSummary);
  const explicit = asRecord(summary.chatInteraction);
  if (explicit.kind === "quick_reply_selection") {
    const title = asString(explicit.title);
    if (title) {
      return {
        selectedOption: { id: asString(explicit.id), title },
        contextMessageIds: asStringArray(explicit.contextMessageIds),
      };
    }
  }

  const raw = Object.keys(asRecord(summary.raw)).length > 0 ? asRecord(summary.raw) : summary;
  const v2Message = asRecord(raw.payload);
  const v2Payload = asRecord(v2Message.payload);
  const v2Context = mergeRecords(asRecord(v2Message.context), asRecord(v2Payload.context));
  const v2MessageType = asString(v2Message.type)?.toLowerCase();
  const v2PayloadType = asString(v2Payload.type)?.toLowerCase();
  if (v2PayloadType === "button" || v2MessageType === "button") {
    const title = asString(v2Payload.text) ?? asString(asRecord(v2Message.button).text);
    if (title) {
      return {
        selectedOption: {
          id: asString(v2Payload.id) ?? asString(v2Payload.postbackText),
          title,
        },
        contextMessageIds: extractContextMessageIds(v2Context),
      };
    }
  }

  const metaMessageCandidate = asRecord(raw._gupshupMetaMessage);
  const metaMessage = Object.keys(metaMessageCandidate).length > 0 ? metaMessageCandidate : raw;
  const metaType = asString(metaMessage.type)?.toLowerCase();
  const metaContext = asRecord(metaMessage.context);

  if (metaType === "button") {
    const button = asRecord(metaMessage.button);
    const title = asString(button.text);
    if (title) {
      return {
        selectedOption: { id: asString(button.payload), title },
        contextMessageIds: extractContextMessageIds(metaContext),
      };
    }
  }

  if (metaType === "interactive") {
    const interactive = asRecord(metaMessage.interactive);
    const reply = Object.keys(asRecord(interactive.button_reply)).length > 0
      ? asRecord(interactive.button_reply)
      : asRecord(interactive.list_reply);
    const title = asString(reply.title);
    if (title) {
      return {
        selectedOption: { id: asString(reply.id), title },
        contextMessageIds: extractContextMessageIds(metaContext),
      };
    }
  }

  return null;
}

export function toStoredQuickReplyInteraction(selection: ProviderQuickReplySelection) {
  return {
    kind: "quick_reply_selection",
    id: selection.selectedOption.id,
    title: selection.selectedOption.title,
    contextMessageIds: selection.contextMessageIds,
  } as const;
}

export function normalizeQuickReplyMessages(
  messages: QuickReplyMessageInput[],
): Map<string, NormalizedQuickReplyMessage> {
  const outboundByProviderId = new Map<string, string>();
  for (const message of messages) {
    if (isOutbound(message.direction) && message.provider_message_id) {
      outboundByProviderId.set(message.provider_message_id, message.id);
    }
  }

  const result = new Map<string, NormalizedQuickReplyMessage>();
  const previousPrompts: Array<{
    messageId: string;
    options: ChatQuickReplyOption[];
  }> = [];

  for (const message of messages) {
    if (isOutbound(message.direction)) {
      const prompt = parseQuickReplyPrompt(message.content);
      if (!prompt) {
        result.set(message.id, { content: message.content, quickReply: null });
        continue;
      }

      previousPrompts.push({ messageId: message.id, options: prompt.options });
      result.set(message.id, {
        content: prompt.content,
        quickReply: { kind: "options", options: prompt.options },
      });
      continue;
    }

    const providerSelection = extractProviderQuickReplySelection(message.provider_payload_summary);
    const matchedPrompt = findLatestMatchingPrompt(
      previousPrompts,
      providerSelection?.selectedOption.title ?? message.content,
    );
    const inferredSelection = providerSelection ?? (matchedPrompt
      ? {
          selectedOption: matchedPrompt.option,
          contextMessageIds: [],
        }
      : null);

    if (!inferredSelection) {
      result.set(message.id, { content: message.content, quickReply: null });
      continue;
    }

    const contextualMessageId = inferredSelection.contextMessageIds
      .map((contextId) => outboundByProviderId.get(contextId) ?? null)
      .find((messageId): messageId is string => Boolean(messageId));
    const replyToMessageId = contextualMessageId ?? matchedPrompt?.messageId ?? null;

    result.set(message.id, {
      content: inferredSelection.selectedOption.title,
      quickReply: {
        kind: "selection",
        selectedOption: inferredSelection.selectedOption,
        replyToMessageId,
      },
    });
  }

  return result;
}

function findLatestMatchingPrompt(
  prompts: Array<{ messageId: string; options: ChatQuickReplyOption[] }>,
  selectedTitle: string,
) {
  const normalizedSelection = normalizeOptionTitle(selectedTitle);
  if (!normalizedSelection) return null;

  for (let index = prompts.length - 1; index >= 0; index -= 1) {
    const prompt = prompts[index];
    const option = prompt.options.find(
      (candidate) => normalizeOptionTitle(candidate.title) === normalizedSelection,
    );
    if (option) return { messageId: prompt.messageId, option };
  }

  return null;
}

function normalizeOptionTitle(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractContextMessageIds(context: Record<string, unknown>) {
  return uniqueStrings([
    asString(context.gsId),
    asString(context.gs_id),
    asString(context.gsid),
    asString(context.id),
  ]);
}

function uniqueStrings(values: Array<string | null>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map(asString));
}

function isOutbound(direction: string) {
  return direction.toLowerCase() === "outbound";
}

function mergeRecords(...records: Array<Record<string, unknown>>) {
  return Object.assign({}, ...records);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}
