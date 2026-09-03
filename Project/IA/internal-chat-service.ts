import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "./sdr-agent-gemini.js";

const ATTACHMENTS_BUCKET = "chat-attachments";
const MAX_ATTACHMENT_BYTES = 104_857_600;
const MESSAGE_PAGE_SIZE = 100;
const SIGNED_DOWNLOAD_TTL_SECONDS = 900;
const UPLOAD_INTENT_TTL_MS = 15 * 60 * 1000;

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
]);
const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/opus", "audio/wav", "audio/webm",
]);
const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf", "text/plain", "text/csv", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
]);

type InternalChatContext = {
  accessToken: string;
  authUserId: string;
  crmUserId: string;
  acesId: number;
  role: string;
  name: string | null;
};

type MentionInput = {
  type: "user" | "all" | "lead";
  userId?: string | null;
  leadId?: string | null;
  start: number;
  length: number;
};

type AttachmentKind = "image" | "audio" | "document";

type InternalChatServiceConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
};

type Row = Record<string, unknown>;
type CrmSupabaseClient = SupabaseClient<any, any, any, any, any>;

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object") : [];
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sanitizeFileName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120) || "arquivo";
}

function resolveAttachmentKind(mimeType: string): AttachmentKind | null {
  if (IMAGE_MIME_TYPES.has(mimeType)) return "image";
  if (AUDIO_MIME_TYPES.has(mimeType)) return "audio";
  if (DOCUMENT_MIME_TYPES.has(mimeType)) return "document";
  return null;
}

function ensureActive(context: InternalChatContext) {
  if (context.role !== "ADMIN" && context.role !== "VENDEDOR") {
    throw new HttpError(403, "Usuario sem acesso ao Chat interno");
  }
}

function throwQueryError(message: string, error: unknown): never {
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "";
  const status = code === "42501" ? 403 : code === "23505" ? 409 : code.startsWith("22") || code.startsWith("23") ? 400 : 500;
  throw new HttpError(status, message, error);
}

function codePointSlice(value: string, start: number, end?: number) {
  return Array.from(value).slice(start, end).join("");
}

export class InternalChatService {
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;
  private readonly serviceClient: CrmSupabaseClient;

  constructor(config: InternalChatServiceConfig) {
    this.supabaseUrl = config.supabaseUrl;
    this.supabaseAnonKey = config.supabaseAnonKey;
    this.serviceClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "crm" },
    });
  }

  private scopedClient(accessToken: string) {
    return createClient(this.supabaseUrl, this.supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "crm" },
    });
  }

  private async assertMember(client: CrmSupabaseClient, context: InternalChatContext, conversationId: string) {
    const { data, error } = await client
      .from("internal_conversation_members")
      .select("conversation_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", context.crmUserId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throwQueryError("Nao foi possivel validar a conversa", error);
    if (!data) throw new HttpError(403, "Conversa indisponivel");
  }

  async listUsers(context: InternalChatContext, search = "") {
    ensureActive(context);
    const client = this.scopedClient(context.accessToken);
    let query = client
      .from("users")
      .select("id, auth_user_id, email, name, role")
      .eq("aces_id", context.acesId)
      .in("role", ["ADMIN", "VENDEDOR"])
      .order("name", { ascending: true })
      .limit(50);
    const term = search.trim().slice(0, 80);
    if (term) query = query.or(`name.ilike.%${term.replace(/[,%()]/g, "")}%,email.ilike.%${term.replace(/[,%()]/g, "")}%`);
    const { data, error } = await query;
    if (error) throwQueryError("Nao foi possivel listar usuarios do Time", error);
    return { users: data ?? [] };
  }

  async searchMentionableLeads(context: InternalChatContext, search: string) {
    ensureActive(context);
    const term = search.trim().slice(0, 80);
    if (!term) return { leads: [] };
    const client = this.scopedClient(context.accessToken);
    const { data, error } = await client
      .from("leads")
      .select("id, name")
      .eq("aces_id", context.acesId)
      .ilike("name", `%${term.replace(/[%,]/g, "")}%`)
      .order("name", { ascending: true })
      .limit(20);
    if (error) throwQueryError("Nao foi possivel pesquisar leads mencionaveis", error);
    return { leads: data ?? [] };
  }

  async createConversation(context: InternalChatContext, input: { kind: string; name?: string | null; memberIds?: string[] }) {
    ensureActive(context);
    const memberIds = [...new Set((input.memberIds ?? []).filter(isUuid))];
    const client = this.scopedClient(context.accessToken);
    const { data, error } = await client.rpc("rpc_create_internal_conversation", {
      p_kind: input.kind,
      p_name: input.name?.trim() || null,
      p_member_ids: memberIds,
    });
    if (error) throwQueryError("Nao foi possivel criar a conversa", error);
    return { success: true, conversationId: String(data) };
  }

  async listConversations(context: InternalChatContext, includeArchived = false) {
    ensureActive(context);
    const client = this.scopedClient(context.accessToken);
    const { data: ownMemberships, error: membershipError } = await client
      .from("internal_conversation_members")
      .select("conversation_id, is_admin, last_read_at")
      .eq("user_id", context.crmUserId)
      .eq("is_active", true);
    if (membershipError) throwQueryError("Nao foi possivel listar suas conversas", membershipError);

    const conversationIds = asRows(ownMemberships).map((item) => String(item.conversation_id));
    if (conversationIds.length === 0 && context.role !== "ADMIN") return { conversations: [] };

    let conversationQuery = client
      .from("internal_conversations")
      .select("id, kind, name, created_by, archived_at, last_message_at, created_at, updated_at");
    if (context.role !== "ADMIN") conversationQuery = conversationQuery.in("id", conversationIds);
    conversationQuery = conversationQuery.order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (!includeArchived) conversationQuery = conversationQuery.is("archived_at", null);

    const [{ data: conversations, error: conversationsError }, { data: unreadRows, error: unreadError }] = await Promise.all([
      conversationQuery,
      client.rpc("rpc_get_internal_unread_counts"),
    ]);
    if (conversationsError) throwQueryError("Nao foi possivel carregar as conversas", conversationsError);
    if (unreadError) throwQueryError("Nao foi possivel carregar as mensagens nao lidas", unreadError);

    const visibleIds = asRows(conversations).map((item) => String(item.id));
    if (visibleIds.length === 0) return { conversations: [] };
    const { data: members, error: membersError } = await client
      .from("internal_conversation_members")
      .select("conversation_id, user_id, is_admin, is_active, joined_at")
      .in("conversation_id", visibleIds)
      .eq("is_active", true);
    if (membersError) throwQueryError("Nao foi possivel carregar os participantes", membersError);
    const visibleMembers = asRows(members);
    const userIds = [...new Set(visibleMembers.map((item) => String(item.user_id)))];
    const lastMessageTimestamps = [...new Set(asRows(conversations)
      .map((item) => item.last_message_at ? String(item.last_message_at) : "")
      .filter(Boolean))];
    const recentMessagesQuery = lastMessageTimestamps.length > 0
      ? client
        .from("internal_messages")
        .select("id, conversation_id, author_id, content, created_at, deleted_at")
        .in("conversation_id", visibleIds)
        .in("created_at", lastMessageTimestamps)
      : Promise.resolve({ data: [], error: null });
    const [{ data: users, error: usersError }, { data: recentMessages, error: recentError }] = await Promise.all([
      client.from("users").select("id, name, email, role").in("id", userIds),
      recentMessagesQuery,
    ]);
    if (usersError) throwQueryError("Nao foi possivel carregar os usuarios", usersError);
    if (recentError) throwQueryError("Nao foi possivel carregar os resumos", recentError);

    const userMap = new Map(asRows(users).map((item) => [String(item.id), item]));
    const unreadMap = new Map(asRows(unreadRows).map((item) => [String(item.conversation_id), Number(item.unread_count) || 0]));
    const lastMessageMap = new Map<string, Row>();
    for (const message of asRows(recentMessages)) {
      const id = String(message.conversation_id);
      if (!lastMessageMap.has(id)) lastMessageMap.set(id, message);
    }
    const memberMap = new Map<string, Row[]>();
    for (const member of visibleMembers) {
      const id = String(member.conversation_id);
      memberMap.set(id, [...(memberMap.get(id) ?? []), member]);
    }

    return {
      conversations: asRows(conversations).map((conversation) => {
        const id = String(conversation.id);
        const conversationMembers = (memberMap.get(id) ?? []).map((member) => ({
          userId: String(member.user_id),
          isCurrentUser: String(member.user_id) === context.crmUserId,
          isAdmin: Boolean(member.is_admin),
          name: String(userMap.get(String(member.user_id))?.name ?? userMap.get(String(member.user_id))?.email ?? "Usuario"),
          email: String(userMap.get(String(member.user_id))?.email ?? ""),
          role: String(userMap.get(String(member.user_id))?.role ?? "VENDEDOR"),
        }));
        const lastMessage = lastMessageMap.get(id);
        return {
          id,
          kind: conversation.kind,
          name: conversation.name,
          createdBy: conversation.created_by,
          archivedAt: conversation.archived_at,
          lastMessageAt: conversation.last_message_at,
          createdAt: conversation.created_at,
          currentUserIsAdmin: context.role === "ADMIN" || Boolean((asRows(ownMemberships).find((item) => String(item.conversation_id) === id))?.is_admin),
          canRead: conversationIds.includes(id),
          members: conversationMembers,
          unreadCount: unreadMap.get(id) ?? 0,
          lastMessage: lastMessage ? {
            id: String(lastMessage.id),
            authorId: String(lastMessage.author_id),
            authorName: String(userMap.get(String(lastMessage.author_id))?.name ?? "Usuario"),
            preview: lastMessage.deleted_at ? "Mensagem excluida" : this.previewTokenizedContent(String(lastMessage.content ?? ""), userMap),
            createdAt: lastMessage.created_at,
          } : null,
        };
      }),
    };
  }

  private previewTokenizedContent(content: string, userMap: Map<string, Row>) {
    return content
      .replace(/@\[all\]/g, "@all")
      .replace(/@\[user:([0-9a-f-]{36})\]/gi, (_match, id: string) => `@${String(userMap.get(id)?.name ?? "Usuario")}`)
      .replace(/#\[lead:[0-9a-f-]{36}\]/gi, "#Lead")
      .slice(0, 160);
  }

  async listMessages(context: InternalChatContext, conversationId: string, before?: string | null) {
    ensureActive(context);
    if (!isUuid(conversationId)) throw new HttpError(400, "conversationId invalido");
    const client = this.scopedClient(context.accessToken);
    await this.assertMember(client, context, conversationId);

    let query = client
      .from("internal_messages")
      .select("id, conversation_id, author_id, content, reply_to_message_id, edited_at, deleted_at, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MESSAGE_PAGE_SIZE + 1);
    if (before) {
      const separator = before.lastIndexOf("|");
      const beforeCreatedAt = separator > 0 ? before.slice(0, separator) : before;
      const beforeId = separator > 0 ? before.slice(separator + 1) : null;
      if (!Number.isFinite(Date.parse(beforeCreatedAt)) || (beforeId !== null && !isUuid(beforeId))) {
        throw new HttpError(400, "Cursor de mensagens invalido");
      }
      query = beforeId && isUuid(beforeId)
        ? query.or(`created_at.lt.${beforeCreatedAt},and(created_at.eq.${beforeCreatedAt},id.lt.${beforeId})`)
        : query.lt("created_at", beforeCreatedAt);
    }
    const { data, error } = await query;
    if (error) throwQueryError("Nao foi possivel carregar as mensagens", error);

    const rows = asRows(data);
    const hasMore = rows.length > MESSAGE_PAGE_SIZE;
    const page = rows.slice(0, MESSAGE_PAGE_SIZE);
    const oldestPageRow = page[page.length - 1];
    const nextCursor = hasMore && oldestPageRow
      ? `${String(oldestPageRow.created_at)}|${String(oldestPageRow.id)}`
      : null;
    const messageIds = page.map((item) => String(item.id));
    const replyIds = [...new Set(page.map((item) => item.reply_to_message_id ? String(item.reply_to_message_id) : null).filter((item): item is string => Boolean(item)))];
    if (messageIds.length === 0) return { messages: [], hasMore: false, nextCursor: null };

    const [{ data: mentions, error: mentionsError }, { data: attachments, error: attachmentsError }, { data: replies, error: repliesError }] = await Promise.all([
      client.from("internal_message_mentions").select("message_id, mention_type, mentioned_user_id, lead_id, token_start, token_length").in("message_id", messageIds).order("token_start", { ascending: true }),
      client.from("internal_message_attachments").select("id, message_id, kind, mime_type, storage_bucket, storage_path, file_name, file_size, storage_deleted_at").in("message_id", messageIds),
      replyIds.length > 0
        ? client.from("internal_messages").select("id, author_id, content, deleted_at").in("id", replyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (mentionsError) throwQueryError("Nao foi possivel carregar as mencoes", mentionsError);
    if (attachmentsError) throwQueryError("Nao foi possivel carregar os anexos", attachmentsError);
    if (repliesError) throwQueryError("Nao foi possivel carregar as respostas", repliesError);

    const allRows = [...page, ...asRows(replies)];
    const userIds = [...new Set(allRows.map((item) => String(item.author_id)).concat(asRows(mentions).map((item) => item.mentioned_user_id ? String(item.mentioned_user_id) : "").filter(Boolean)))];
    const leadIds = [...new Set(asRows(mentions).map((item) => item.lead_id ? String(item.lead_id) : "").filter(Boolean))];
    const [{ data: users, error: usersError }, { data: leads, error: leadsError }] = await Promise.all([
      client.from("users").select("id, name, email").in("id", userIds),
      leadIds.length > 0 ? client.from("leads").select("id, name").in("id", leadIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (usersError) throwQueryError("Nao foi possivel carregar os autores", usersError);
    if (leadsError) throwQueryError("Nao foi possivel validar os leads mencionados", leadsError);

    const userMap = new Map(asRows(users).map((item) => [String(item.id), item]));
    const leadMap = new Map(asRows(leads).map((item) => [String(item.id), item]));
    const mentionMap = new Map<string, Row[]>();
    for (const mention of asRows(mentions)) {
      const id = String(mention.message_id);
      mentionMap.set(id, [...(mentionMap.get(id) ?? []), mention]);
    }
    const attachmentMap = new Map<string, Row[]>();
    for (const attachment of asRows(attachments)) {
      const id = String(attachment.message_id);
      attachmentMap.set(id, [...(attachmentMap.get(id) ?? []), attachment]);
    }
    const replyMap = new Map(asRows(replies).map((item) => [String(item.id), item]));

    const normalized = await Promise.all(page.reverse().map(async (message) => {
      const id = String(message.id);
      const reply = message.reply_to_message_id ? replyMap.get(String(message.reply_to_message_id)) : null;
      const messageAttachments = await Promise.all((attachmentMap.get(id) ?? []).map(async (attachment) => {
        let downloadUrl: string | null = null;
        if (!attachment.storage_deleted_at) {
          const { data: signed, error: signedError } = await this.serviceClient.storage
            .from(String(attachment.storage_bucket))
            .createSignedUrl(String(attachment.storage_path), SIGNED_DOWNLOAD_TTL_SECONDS);
          if (!signedError) downloadUrl = signed?.signedUrl ?? null;
        }
        return {
          id: String(attachment.id), kind: attachment.kind, mimeType: attachment.mime_type,
          fileName: attachment.file_name, fileSize: attachment.file_size, downloadUrl,
          storageDeletedAt: attachment.storage_deleted_at,
        };
      }));
      return {
        id,
        conversationId,
        authorId: String(message.author_id),
        authorName: String(userMap.get(String(message.author_id))?.name ?? userMap.get(String(message.author_id))?.email ?? "Usuario"),
        isOwn: String(message.author_id) === context.crmUserId,
        content: String(message.content ?? ""),
        segments: this.buildSegments(String(message.content ?? ""), mentionMap.get(id) ?? [], userMap, leadMap),
        replyTo: reply ? {
          id: String(reply.id),
          authorName: String(userMap.get(String(reply.author_id))?.name ?? userMap.get(String(reply.author_id))?.email ?? "Usuario"),
          preview: reply.deleted_at ? "Mensagem excluida" : this.previewTokenizedContent(String(reply.content ?? ""), userMap),
        } : null,
        attachments: messageAttachments,
        editedAt: message.edited_at,
        deletedAt: message.deleted_at,
        createdAt: message.created_at,
      };
    }));

    return {
      messages: normalized,
      hasMore,
      nextCursor,
    };
  }

  private buildSegments(content: string, mentions: Row[], users: Map<string, Row>, leads: Map<string, Row>) {
    const segments: Array<Record<string, unknown>> = [];
    let cursor = 0;
    for (const mention of [...mentions].sort((a, b) => Number(a.token_start) - Number(b.token_start))) {
      const start = Number(mention.token_start);
      const length = Number(mention.token_length);
      if (!Number.isInteger(start) || start < cursor || length <= 0) continue;
      const prefix = codePointSlice(content, cursor, start);
      if (prefix) segments.push({ type: "text", text: prefix });
      if (mention.mention_type === "all") {
        segments.push({ type: "all", text: "@all" });
      } else if (mention.mention_type === "user") {
        const userId = String(mention.mentioned_user_id);
        const user = users.get(userId);
        segments.push({ type: "user", text: `@${String(user?.name ?? user?.email ?? "Usuario")}`, userId });
      } else {
        const leadId = String(mention.lead_id);
        const lead = leads.get(leadId);
        segments.push(lead
          ? { type: "lead", text: `#${String(lead.name)}`, leadId, accessible: true }
          : { type: "lead", text: "lead mencionado", accessible: false });
      }
      cursor = start + length;
    }
    const suffix = codePointSlice(content, cursor);
    if (suffix) segments.push({ type: "text", text: suffix });
    return segments.length > 0 ? segments : [{ type: "text", text: content }];
  }

  async sendMessage(context: InternalChatContext, conversationId: string, input: {
    content?: string;
    replyToMessageId?: string | null;
    clientMessageId?: string;
    mentions?: MentionInput[];
    attachmentId?: string | null;
  }) {
    ensureActive(context);
    if (!isUuid(conversationId)) throw new HttpError(400, "conversationId invalido");
    const clientMessageId = String(input.clientMessageId ?? "");
    if (!isUuid(clientMessageId)) throw new HttpError(400, "clientMessageId invalido");
    const mentions = (input.mentions ?? []).map((mention) => ({
      type: mention.type,
      userId: mention.userId ?? null,
      leadId: mention.leadId ?? null,
      start: Number(mention.start),
      length: Number(mention.length),
    }));
    const client = this.scopedClient(context.accessToken);
    const { data: existing, error: existingError } = await client
      .from("internal_messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("author_id", context.crmUserId)
      .eq("client_message_id", clientMessageId)
      .maybeSingle();
    if (existingError) throwQueryError("Nao foi possivel validar a idempotencia da mensagem", existingError);
    if (existing) return { success: true, messageId: String(existing.id) };
    if (input.attachmentId) {
      await this.assertAttachmentUploaded(context, conversationId, input.attachmentId);
    }
    const { data, error } = await client.rpc("rpc_send_internal_message", {
      p_conversation_id: conversationId,
      p_content: input.content ?? "",
      p_reply_to_message_id: input.replyToMessageId || null,
      p_client_message_id: clientMessageId,
      p_mentions: mentions,
      p_attachment_id: input.attachmentId || null,
    });
    if (error) throwQueryError("Nao foi possivel enviar a mensagem", error);
    return { success: true, messageId: String(data) };
  }

  private async assertAttachmentUploaded(
    context: InternalChatContext,
    conversationId: string,
    attachmentId: string,
  ) {
    if (!isUuid(attachmentId)) throw new HttpError(400, "attachmentId invalido");
    const { data: intent, error: intentError } = await this.serviceClient
      .from("internal_message_attachment_upload_intents")
      .select("storage_bucket, storage_path, file_size, status, intent_expires_at")
      .eq("attachment_id", attachmentId)
      .eq("conversation_id", conversationId)
      .eq("aces_id", context.acesId)
      .eq("created_by", context.crmUserId)
      .maybeSingle();
    if (intentError) throwQueryError("Nao foi possivel validar o upload interno", intentError);
    if (!intent || intent.status !== "issued") throw new HttpError(409, "Upload interno indisponivel");
    if (Date.parse(String(intent.intent_expires_at)) <= Date.now()) {
      await this.serviceClient
        .from("internal_message_attachment_upload_intents")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("attachment_id", attachmentId);
      throw new HttpError(410, "Upload interno expirado");
    }

    const storagePath = String(intent.storage_path);
    const pathParts = storagePath.split("/");
    const objectName = pathParts.pop();
    const folder = pathParts.join("/");
    const { data: objects, error: storageError } = await this.serviceClient.storage
      .from(String(intent.storage_bucket))
      .list(folder, { search: objectName, limit: 2 });
    if (storageError) throw new HttpError(500, "Nao foi possivel confirmar o upload interno", storageError);
    const uploadedObject = objectName ? objects?.find((object) => object.name === objectName) : null;
    if (!uploadedObject) {
      throw new HttpError(409, "O arquivo ainda nao foi enviado");
    }
    const uploadedSize = Number(uploadedObject.metadata?.size);
    if (!Number.isFinite(uploadedSize) || uploadedSize <= 0 || uploadedSize > MAX_ATTACHMENT_BYTES
      || uploadedSize !== Number(intent.file_size)) {
      throw new HttpError(409, "O arquivo enviado nao corresponde ao upload solicitado");
    }
  }

  async createAttachmentUploadUrl(context: InternalChatContext, conversationId: string, input: {
    fileName?: string; mimeType?: string; fileSize?: number; kind?: string;
  }) {
    ensureActive(context);
    if (!isUuid(conversationId)) throw new HttpError(400, "conversationId invalido");
    const fileName = String(input.fileName ?? "").trim();
    const mimeType = String(input.mimeType ?? "").split(";")[0].trim().toLowerCase();
    const kind = resolveAttachmentKind(mimeType);
    const fileSize = Number(input.fileSize ?? 0);
    if (!fileName) throw new HttpError(400, "fileName e obrigatorio");
    if (!kind || kind !== input.kind) throw new HttpError(400, "Tipo de arquivo nao permitido");
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_ATTACHMENT_BYTES) {
      throw new HttpError(400, "Tamanho do arquivo invalido");
    }
    const client = this.scopedClient(context.accessToken);
    await this.assertMember(client, context, conversationId);

    const intentId = randomUUID();
    const messageId = randomUUID();
    const attachmentId = randomUUID();
    const safeName = sanitizeFileName(fileName);
    const storagePath = `internal/${context.acesId}/${conversationId}/${messageId}/${attachmentId}/${safeName}`;
    const intentExpiresAt = new Date(Date.now() + UPLOAD_INTENT_TTL_MS).toISOString();
    const { error: insertError } = await this.serviceClient.from("internal_message_attachment_upload_intents").insert({
      id: intentId, attachment_id: attachmentId, message_id: messageId,
      conversation_id: conversationId, aces_id: context.acesId, created_by: context.crmUserId,
      kind, mime_type: mimeType, storage_bucket: ATTACHMENTS_BUCKET, storage_path: storagePath,
      file_name: safeName, file_size: Math.floor(fileSize), status: "issued", intent_expires_at: intentExpiresAt,
    });
    if (insertError) throwQueryError("Nao foi possivel registrar o upload", insertError);
    const { data, error } = await this.serviceClient.storage.from(ATTACHMENTS_BUCKET).createSignedUploadUrl(storagePath);
    if (error || !data?.signedUrl) {
      await this.serviceClient.from("internal_message_attachment_upload_intents").update({ status: "failed" }).eq("id", intentId);
      throw new HttpError(500, "Nao foi possivel gerar a URL de upload", error);
    }
    return {
      success: true, bucket: ATTACHMENTS_BUCKET, storagePath, messageId, attachmentId,
      uploadUrl: data.signedUrl, uploadToken: data.token, intentExpiresAt,
      maxFileSize: MAX_ATTACHMENT_BYTES, mimeType, kind,
    };
  }

  async markRead(context: InternalChatContext, conversationId: string) {
    ensureActive(context);
    const client = this.scopedClient(context.accessToken);
    const { error } = await client.rpc("rpc_mark_internal_conversation_read", { p_conversation_id: conversationId });
    if (error) throwQueryError("Nao foi possivel marcar a conversa como lida", error);
    return { success: true };
  }

  async updateConversation(context: InternalChatContext, conversationId: string, input: { name?: string; archived?: boolean }) {
    ensureActive(context);
    const client = this.scopedClient(context.accessToken);
    const { data: conversation, error: loadError } = await client.from("internal_conversations").select("id, kind").eq("id", conversationId).maybeSingle();
    if (loadError) throwQueryError("Nao foi possivel localizar a conversa", loadError);
    if (!conversation) throw new HttpError(404, "Conversa nao encontrada");
    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) {
      if (conversation.kind !== "group" || !input.name.trim()) throw new HttpError(400, "Nome de grupo invalido");
      changes.name = input.name.trim();
    }
    if (input.archived !== undefined) changes.archived_at = input.archived ? new Date().toISOString() : null;
    const { error } = await client.from("internal_conversations").update(changes).eq("id", conversationId);
    if (error) throwQueryError("Nao foi possivel atualizar a conversa", error);
    return { success: true };
  }

  private async loadGroup(client: CrmSupabaseClient, conversationId: string) {
    const { data, error } = await client.from("internal_conversations").select("id, kind, aces_id").eq("id", conversationId).maybeSingle();
    if (error) throwQueryError("Nao foi possivel localizar o grupo", error);
    if (!data) throw new HttpError(404, "Conversa nao encontrada");
    if (data.kind !== "group") throw new HttpError(409, "Participantes de conversa direta nao podem ser alterados");
    return data;
  }

  async addMember(context: InternalChatContext, conversationId: string, input: { userId?: string; isAdmin?: boolean }) {
    ensureActive(context);
    const userId = String(input.userId ?? "");
    if (!isUuid(userId)) throw new HttpError(400, "userId invalido");
    const client = this.scopedClient(context.accessToken);
    await this.loadGroup(client, conversationId);
    const { data: existing, error: existingError } = await client.from("internal_conversation_members").select("user_id, is_active").eq("conversation_id", conversationId).eq("user_id", userId).maybeSingle();
    if (existingError) throwQueryError("Nao foi possivel validar o participante", existingError);
    const rejoinedAt = new Date().toISOString();
    const payload = {
      is_active: true,
      is_admin: Boolean(input.isAdmin),
      removed_at: null,
      joined_at: rejoinedAt,
      last_read_at: rejoinedAt,
      updated_at: rejoinedAt,
    };
    const result = existing
      ? await client.from("internal_conversation_members").update(payload).eq("conversation_id", conversationId).eq("user_id", userId)
      : await client.from("internal_conversation_members").insert({ conversation_id: conversationId, user_id: userId, aces_id: context.acesId, ...payload });
    if (result.error) throwQueryError("Nao foi possivel adicionar o participante", result.error);
    return { success: true };
  }

  async updateMember(context: InternalChatContext, conversationId: string, userId: string, input: { isAdmin?: boolean; isActive?: boolean }) {
    ensureActive(context);
    const client = this.scopedClient(context.accessToken);
    await this.loadGroup(client, conversationId);
    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.isAdmin !== undefined) changes.is_admin = input.isAdmin;
    if (input.isActive !== undefined) {
      changes.is_active = input.isActive;
      changes.removed_at = input.isActive ? null : new Date().toISOString();
    }
    const { data, error } = await client.from("internal_conversation_members").update(changes).eq("conversation_id", conversationId).eq("user_id", userId).select("user_id").maybeSingle();
    if (error) throwQueryError("Nao foi possivel atualizar o participante", error);
    if (!data) throw new HttpError(404, "Participante nao encontrado");
    return { success: true };
  }

  removeMember(context: InternalChatContext, conversationId: string, userId: string) {
    return this.updateMember(context, conversationId, userId, { isActive: false });
  }
}
