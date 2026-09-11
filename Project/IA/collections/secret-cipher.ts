import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: string;
};

function decodeKey(raw: string) {
  const value = raw.trim();
  const candidates = [
    /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.alloc(0),
    Buffer.from(value, "base64"),
    Buffer.from(value, "base64url"),
  ];
  const key = candidates.find((candidate) => candidate.length === 32);
  if (!key) throw new Error("COLLECTION_SECRETS_ENCRYPTION_KEY deve representar exatamente 32 bytes");
  return key;
}

export class SecretCipher {
  private readonly key: Buffer;

  constructor(rawKey: string, private readonly keyVersion: string) {
    this.key = decodeKey(rawKey);
    if (!keyVersion.trim()) throw new Error("COLLECTION_SECRETS_ENCRYPTION_KEY_VERSION nao configurada");
  }

  encrypt(secret: string): EncryptedSecret {
    if (!secret.trim()) throw new Error("Segredo vazio");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: this.keyVersion };
  }

  decrypt(input: EncryptedSecret) {
    if (input.keyVersion !== this.keyVersion) {
      throw new Error(`Versao de chave nao suportada: ${input.keyVersion}`);
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, input.iv);
    decipher.setAuthTag(input.authTag);
    return Buffer.concat([decipher.update(input.ciphertext), decipher.final()]).toString("utf8");
  }
}

export function toBytea(value: Buffer) {
  return `\\x${value.toString("hex")}`;
}

export function fromBytea(value: unknown) {
  if (Buffer.isBuffer(value)) return value;
  const text = String(value ?? "").trim();
  if (text.startsWith("\\x") && /^[0-9a-f]+$/i.test(text.slice(2))) {
    return Buffer.from(text.slice(2), "hex");
  }
  return Buffer.from(text, "base64");
}
