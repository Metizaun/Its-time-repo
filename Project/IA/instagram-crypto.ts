import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type EncryptedInstagramToken = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: string;
};

export function sha256(value: string | Buffer): Buffer {
  return createHash("sha256").update(value).digest();
}

export function toPostgresBytea(value: Buffer): string {
  return `\\x${value.toString("hex")}`;
}

export function fromPostgresBytea(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  const text = String(value ?? "").trim();
  if (text.startsWith("\\x") && /^[0-9a-f]+$/i.test(text.slice(2))) {
    return Buffer.from(text.slice(2), "hex");
  }
  if (/^[0-9a-f]+$/i.test(text) && text.length % 2 === 0) {
    return Buffer.from(text, "hex");
  }
  return Buffer.from(text, "base64");
}

function decodeEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const candidates: Buffer[] = [];
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    candidates.push(Buffer.from(trimmed, "hex"));
  }
  candidates.push(Buffer.from(trimmed, "base64"));
  candidates.push(Buffer.from(trimmed, "base64url"));
  const key = candidates.find((candidate) => candidate.length === 32);
  if (!key) {
    throw new Error("INSTAGRAM_TOKEN_ENCRYPTION_KEY deve representar exatamente 32 bytes");
  }
  return key;
}

export class InstagramTokenCipher {
  private readonly key: Buffer;

  constructor(rawKey: string, private readonly keyVersion: string) {
    this.key = decodeEncryptionKey(rawKey);
    if (!keyVersion.trim()) throw new Error("INSTAGRAM_TOKEN_ENCRYPTION_KEY_VERSION nao configurada");
  }

  encrypt(token: string): EncryptedInstagramToken {
    if (!token.trim()) throw new Error("Token Instagram vazio");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: this.keyVersion };
  }

  decrypt(input: EncryptedInstagramToken): string {
    if (input.keyVersion !== this.keyVersion) {
      throw new Error("Versao da chave de token Instagram nao suportada");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, input.iv);
    decipher.setAuthTag(input.authTag);
    return Buffer.concat([decipher.update(input.ciphertext), decipher.final()]).toString("utf8");
  }
}

export function createSignedOAuthState(signingSecret: string) {
  const nonce = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ nonce, issuedAt: Date.now() })).toString("base64url");
  const signature = createHmac("sha256", signingSecret).update(payload).digest("base64url");
  return { state: `${payload}.${signature}`, nonce };
}

export function verifySignedOAuthState(state: string, signingSecret: string) {
  const [payload, suppliedSignature, extra] = state.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  const expected = createHmac("sha256", signingSecret).update(payload).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedSignature, "base64url");
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      nonce?: unknown;
      issuedAt?: unknown;
    };
    if (typeof parsed.nonce !== "string" || typeof parsed.issuedAt !== "number") return null;
    if (Date.now() - parsed.issuedAt > 15 * 60 * 1000 || parsed.issuedAt > Date.now() + 60_000) return null;
    return { nonce: parsed.nonce, issuedAt: parsed.issuedAt };
  } catch {
    return null;
  }
}
