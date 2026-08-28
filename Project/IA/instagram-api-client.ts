export type InstagramTokenResult = {
  accessToken: string;
  userId: string | null;
  expiresIn: number;
};

export type InstagramApiErrorDetails = {
  status: number;
  code: string | null;
  subcode: string | null;
  transient: boolean;
};

export class InstagramApiError extends Error {
  constructor(message: string, public readonly details: InstagramApiErrorDetails) {
    super(message);
    this.name = "InstagramApiError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (response.ok) return asRecord(payload);
  const error = asRecord(asRecord(payload).error);
  throw new InstagramApiError(
    typeof error.message === "string" ? error.message : "Falha na API do Instagram",
    {
      status: response.status,
      code: error.code === undefined ? null : String(error.code),
      subcode: error.error_subcode === undefined ? null : String(error.error_subcode),
      transient: error.is_transient === true || response.status >= 500 || response.status === 429,
    },
  );
}

export class InstagramApiClient {
  private readonly version: string;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    graphApiVersion: string,
  ) {
    this.version = graphApiVersion.trim().replace(/^V/, "v").replace(/^(?!v)/, "v");
  }

  buildAuthorizationUrl(redirectUri: string, state: string) {
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", this.appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "instagram_business_basic,instagram_business_manage_messages");
    url.searchParams.set("state", state);
    url.searchParams.set("enable_fb_login", "0");
    url.searchParams.set("force_authentication", "1");
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string, redirectUri: string): Promise<InstagramTokenResult> {
    const body = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });
    const response = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await readResponse(response);
    const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
    if (!accessToken) throw new Error("A Meta nao retornou um token Instagram");
    return {
      accessToken,
      userId: payload.user_id === undefined ? null : String(payload.user_id),
      expiresIn: Number(payload.expires_in ?? 3600),
    };
  }

  async exchangeLongLivedToken(shortLivedToken: string): Promise<InstagramTokenResult> {
    const url = new URL("https://graph.instagram.com/access_token");
    url.searchParams.set("grant_type", "ig_exchange_token");
    url.searchParams.set("client_secret", this.appSecret);
    url.searchParams.set("access_token", shortLivedToken);
    const payload = await readResponse(await fetch(url, { signal: AbortSignal.timeout(15_000) }));
    const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
    if (!accessToken) throw new Error("A Meta nao retornou o token Instagram de longa duracao");
    return {
      accessToken,
      userId: null,
      expiresIn: Math.max(3600, Number(payload.expires_in ?? 5_184_000)),
    };
  }

  async getProfile(accessToken: string) {
    const url = new URL(`https://graph.instagram.com/${this.version}/me`);
    url.searchParams.set("fields", "user_id,username");
    const payload = await readResponse(await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    }));
    const id = payload.user_id === undefined ? (payload.id === undefined ? "" : String(payload.id)) : String(payload.user_id);
    if (!id) throw new Error("A Meta nao retornou o ID da conta Instagram");
    return { id, username: typeof payload.username === "string" ? payload.username : null };
  }

  async subscribeToWebhooks(accessToken: string, igUserId: string) {
    const url = new URL(`https://graph.instagram.com/${this.version}/${encodeURIComponent(igUserId)}/subscribed_apps`);
    url.searchParams.set("subscribed_fields", "messages");
    const payload = await readResponse(await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    }));
    if (payload.success !== true) throw new Error("A Meta nao confirmou a inscricao do webhook Instagram");
    return true;
  }

  async getMessagingUserProfile(accessToken: string, providerUserId: string) {
    const url = new URL(`https://graph.instagram.com/${this.version}/${encodeURIComponent(providerUserId)}`);
    url.searchParams.set("fields", "name,username,profile_pic");
    const payload = await readResponse(await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    }));
    return {
      name: typeof payload.name === "string" ? payload.name.trim() || null : null,
      username: typeof payload.username === "string" ? payload.username.trim() || null : null,
      profilePictureUrl: typeof payload.profile_pic === "string" ? payload.profile_pic.trim() || null : null,
    };
  }

  async refreshAccessToken(accessToken: string): Promise<InstagramTokenResult> {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", accessToken);
    const payload = await readResponse(await fetch(url, { signal: AbortSignal.timeout(15_000) }));
    const refreshedToken = typeof payload.access_token === "string" ? payload.access_token : "";
    if (!refreshedToken) throw new Error("A Meta nao retornou o token Instagram renovado");
    return {
      accessToken: refreshedToken,
      userId: null,
      expiresIn: Math.max(3600, Number(payload.expires_in ?? 5_184_000)),
    };
  }

  async sendText(input: {
    accessToken: string;
    igUserId: string;
    recipientId: string;
    text: string;
    tag?: "HUMAN_AGENT";
  }) {
    const body: {
      recipient: { id: string };
      message: { text: string };
      tag?: "HUMAN_AGENT";
    } = {
      recipient: { id: input.recipientId },
      message: { text: input.text },
    };
    if (input.tag) body.tag = input.tag;
    const response = await fetch(
      `https://graph.instagram.com/${this.version}/${encodeURIComponent(input.igUserId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const payload = await readResponse(response);
    const messageId = payload.message_id === undefined ? null : String(payload.message_id);
    return {
      messageId,
      recipientId: payload.recipient_id === undefined ? null : String(payload.recipient_id),
      tag: input.tag ?? null,
    };
  }

  async sendMedia(input: {
    accessToken: string;
    igUserId: string;
    recipientId: string;
    kind: "image" | "audio";
    mediaUrl: string;
    tag?: "HUMAN_AGENT";
  }) {
    const body: {
      recipient: { id: string };
      message: { attachment: { type: "image" | "audio"; payload: { url: string } } };
      tag?: "HUMAN_AGENT";
    } = {
      recipient: { id: input.recipientId },
      message: {
        attachment: {
          type: input.kind,
          payload: { url: input.mediaUrl },
        },
      },
    };
    if (input.tag) body.tag = input.tag;
    const response = await fetch(
      `https://graph.instagram.com/${this.version}/${encodeURIComponent(input.igUserId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const payload = await readResponse(response);
    return {
      messageId: payload.message_id === undefined ? null : String(payload.message_id),
      recipientId: payload.recipient_id === undefined ? null : String(payload.recipient_id),
      tag: input.tag ?? null,
    };
  }
}
