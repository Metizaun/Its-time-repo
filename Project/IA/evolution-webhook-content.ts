export type EvolutionTemplateButtonKind = "url" | "quick_reply" | "call";

export type EvolutionTemplateButton = {
  kind: EvolutionTemplateButtonKind;
  text: string;
  target: string | null;
};

export type EvolutionTemplateCard = {
  templateId: string | null;
  title: string | null;
  body: string;
  footer: string | null;
  buttons: EvolutionTemplateButton[];
  hasMedia: boolean;
  mediaDegraded: boolean;
};

export type EvolutionWebhookContent = {
  textCandidates: string[];
  mediaKind: "audio" | "image" | "document" | null;
  mediaNode: Record<string, unknown>;
  mediaMimeType: string | null;
  mediaUrl: string | null;
  mediaBase64: string | null;
  mediaThumbnailBase64: string | null;
  fileName: string | null;
  unsupportedMediaKind: "video" | null;
  templateCard: EvolutionTemplateCard | null;
};

export type EvolutionFirstTouchAttribution = {
  channel: "whatsapp_disparo";
  provider: "evolution";
  template_id: string | null;
  cta_url: string | null;
  provider_message_id: string | null;
  external_ad_reply: Record<string, unknown> | null;
  ctwa_clid: string | null;
  captured_at: string;
};

export function inspectEvolutionWebhookContent(payload: unknown): EvolutionWebhookContent {
  const { message } = unwrapEvolutionPayload(payload);
  const templateMessage = asRecord(message.templateMessage);
  const hydratedTemplateCandidate = asRecord(templateMessage.hydratedTemplate);
  const hydratedTemplate = Object.keys(hydratedTemplateCandidate).length > 0
    ? hydratedTemplateCandidate
    : asRecord(templateMessage.hydratedFourRowTemplate);
  const interactiveMessage = asRecord(message.interactiveMessage);
  const buttonsMessage = asRecord(message.buttonsMessage);
  const listMessage = asRecord(message.listMessage);

  const rootImage = asRecord(message.imageMessage);
  const rootAudio = asRecord(message.audioMessage);
  const rootDocument = asRecord(message.documentMessage);
  const rootVideo = asRecord(message.videoMessage);
  const nestedImage = asRecord(hydratedTemplate.imageMessage);
  const nestedDocument = asRecord(hydratedTemplate.documentMessage);
  const nestedVideo = asRecord(hydratedTemplate.videoMessage);

  const imageMessage = firstRecord(rootImage, nestedImage);
  const documentMessage = firstRecord(rootDocument, nestedDocument);
  const videoMessage = firstRecord(rootVideo, nestedVideo);
  const hasAudio = Object.keys(rootAudio).length > 0;
  const hasImage = Object.keys(imageMessage).length > 0;
  const hasDocument = Object.keys(documentMessage).length > 0;
  const hasVideo = Object.keys(videoMessage).length > 0;

  const mediaKind = hasAudio
    ? "audio"
    : hasImage
      ? "image"
      : hasDocument
        ? "document"
        : null;
  const mediaNode = mediaKind === "audio"
    ? rootAudio
    : mediaKind === "image"
      ? imageMessage
      : mediaKind === "document"
        ? documentMessage
        : {};

  const textCandidates = uniqueStrings([
    asString(message.conversation),
    asString(asRecord(message.extendedTextMessage).text),
    asString(rootImage.caption),
    asString(rootVideo.caption),
    asString(hydratedTemplate.hydratedContentText),
    asString(hydratedTemplate.hydratedTitleText),
    asString(hydratedTemplate.hydratedFooterText),
    asString(asRecord(interactiveMessage.body).text),
    asString(buttonsMessage.contentText),
    asString(listMessage.description),
  ]);

  return {
    textCandidates,
    mediaKind,
    mediaNode,
    mediaMimeType:
      asString(mediaNode.mimetype) ??
      asString(mediaNode.mime_type) ??
      null,
    mediaUrl: asString(mediaNode.url) ?? asString(mediaNode.mediaUrl),
    mediaBase64: asString(mediaNode.base64),
    mediaThumbnailBase64: toBase64(mediaNode.jpegThumbnail),
    fileName: asString(mediaNode.fileName) ?? asString(mediaNode.file_name),
    unsupportedMediaKind: hasVideo ? "video" : null,
    templateCard: buildTemplateCard(templateMessage, hydratedTemplate, hasImage || hasDocument || hasVideo),
  };
}

export function extractStoredEvolutionTemplateCard(value: unknown): EvolutionTemplateCard | null {
  const summary = asRecord(value);
  const explicit = asRecord(summary.templateCard);
  const explicitBody = asString(explicit.body);
  if (explicitBody || Object.keys(explicit).length > 0) {
    const buttons = Array.isArray(explicit.buttons)
      ? explicit.buttons.map(normalizeStoredButton).filter((button): button is EvolutionTemplateButton => Boolean(button))
      : [];
    return {
      templateId: asString(explicit.templateId),
      title: asString(explicit.title),
      body: explicitBody ?? "",
      footer: asString(explicit.footer),
      buttons,
      hasMedia: explicit.hasMedia === true,
      mediaDegraded: explicit.mediaDegraded === true,
    };
  }

  const raw = Object.keys(asRecord(summary.raw)).length > 0 ? summary.raw : value;
  return inspectEvolutionWebhookContent(raw).templateCard;
}

export function extractEvolutionFirstTouchAttribution(params: {
  payload: unknown;
  providerMessageId: string | null;
  capturedAt: string;
}): EvolutionFirstTouchAttribution | null {
  const { message } = unwrapEvolutionPayload(params.payload);
  const inspection = inspectEvolutionWebhookContent(params.payload);
  const card = inspection.templateCard;
  if (!card) return null;

  const contextCandidates = [
    asRecord(asRecord(message.templateMessage).contextInfo),
    asRecord(asRecord(asRecord(message.templateMessage).hydratedTemplate).contextInfo),
    asRecord(inspection.mediaNode.contextInfo),
    asRecord(asRecord(message.extendedTextMessage).contextInfo),
    asRecord(message.contextInfo),
  ];
  const externalAdReply = contextCandidates
    .map((context) => asRecord(context.externalAdReply))
    .find((candidate) => Object.keys(candidate).length > 0) ?? null;
  const ctwaClid = firstString([
    ...contextCandidates.map((context) => context.ctwaClid),
    ...contextCandidates.map((context) => context.ctwa_clid),
    externalAdReply?.ctwaClid,
    externalAdReply?.ctwa_clid,
  ]);

  return {
    channel: "whatsapp_disparo",
    provider: "evolution",
    template_id: card.templateId,
    cta_url: card.buttons.find((button) => button.kind === "url")?.target ?? null,
    provider_message_id: params.providerMessageId,
    external_ad_reply: externalAdReply,
    ctwa_clid: ctwaClid,
    captured_at: params.capturedAt,
  };
}

export function inferLeadNameFromEvolutionTemplate(value: unknown): string | null {
  const body = inspectEvolutionWebhookContent(value).templateCard?.body.trim();
  if (!body) return null;

  const firstLine = body.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const match = firstLine.match(/^(?:ol[aá]|oi)[,!]?\s+([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,2})[,!]/iu);
  const candidate = match?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  if (!candidate || candidate.length < 2 || candidate.length > 60) return null;

  const normalized = candidate.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (["cliente", "amigo", "amiga", "voce", "senhor", "senhora"].includes(normalized)) {
    return null;
  }

  return candidate;
}

function buildTemplateCard(
  templateMessage: Record<string, unknown>,
  hydratedTemplate: Record<string, unknown>,
  hasMedia: boolean,
): EvolutionTemplateCard | null {
  if (Object.keys(templateMessage).length === 0 && Object.keys(hydratedTemplate).length === 0) {
    return null;
  }

  const buttons = Array.isArray(hydratedTemplate.hydratedButtons)
    ? hydratedTemplate.hydratedButtons
        .map(normalizeHydratedButton)
        .filter((button): button is EvolutionTemplateButton => Boolean(button))
    : [];

  return {
    templateId:
      asString(templateMessage.templateId) ??
      asString(hydratedTemplate.templateId) ??
      asString(hydratedTemplate.hydratedTemplateId),
    title: asString(hydratedTemplate.hydratedTitleText),
    body: asString(hydratedTemplate.hydratedContentText) ?? "",
    footer: asString(hydratedTemplate.hydratedFooterText),
    buttons,
    hasMedia,
    mediaDegraded: false,
  };
}

function normalizeHydratedButton(value: unknown): EvolutionTemplateButton | null {
  const button = asRecord(value);
  const url = asRecord(button.urlButton);
  const quickReply = asRecord(button.quickReplyButton);
  const call = asRecord(button.callButton);

  if (Object.keys(url).length > 0) {
    const text = asString(url.displayText);
    return text ? { kind: "url", text, target: asString(url.url) } : null;
  }
  if (Object.keys(quickReply).length > 0) {
    const text = asString(quickReply.displayText);
    return text ? { kind: "quick_reply", text, target: asString(quickReply.id) } : null;
  }
  if (Object.keys(call).length > 0) {
    const text = asString(call.displayText);
    return text ? { kind: "call", text, target: asString(call.phoneNumber) } : null;
  }
  return null;
}

function normalizeStoredButton(value: unknown): EvolutionTemplateButton | null {
  const button = asRecord(value);
  const kind = button.kind;
  const text = asString(button.text);
  if ((kind !== "url" && kind !== "quick_reply" && kind !== "call") || !text) return null;
  return { kind, text, target: asString(button.target) };
}

function unwrapEvolutionPayload(value: unknown) {
  const original = asRecord(value);
  const root = Object.keys(asRecord(original.raw)).length > 0 ? asRecord(original.raw) : original;
  const data = asRecord(root.data);
  const messageFromData = asRecord(data.message);
  const message = Object.keys(messageFromData).length > 0 ? messageFromData : asRecord(root.message);
  return { root, data, message };
}

function firstRecord(...values: Array<Record<string, unknown>>) {
  return values.find((value) => Object.keys(value).length > 0) ?? {};
}

function toBase64(value: unknown): string | null {
  const direct = asString(value);
  if (direct) return direct;
  const record = asRecord(value);
  if (record.type === "Buffer" && Array.isArray(record.data)) {
    const bytes = record.data.filter((item): item is number => typeof item === "number" && item >= 0 && item <= 255);
    return bytes.length === record.data.length ? Buffer.from(bytes).toString("base64") : null;
  }
  return null;
}

function uniqueStrings(values: Array<string | null>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function firstString(values: unknown[]) {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}
