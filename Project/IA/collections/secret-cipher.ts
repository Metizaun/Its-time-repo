import {
  AesGcmSecretCipher,
  fromPostgresBytea,
  toPostgresBytea,
  type EncryptedSecret,
} from "../integrations/secret-cipher.js";

export type { EncryptedSecret };

export class SecretCipher extends AesGcmSecretCipher {
  constructor(rawKey: string, keyVersion: string) {
    super(
      rawKey,
      keyVersion,
      "COLLECTION_SECRETS_ENCRYPTION_KEY",
      "COLLECTION_SECRETS_ENCRYPTION_KEY_VERSION",
    );
  }
}

export const toBytea = toPostgresBytea;
export const fromBytea = fromPostgresBytea;
