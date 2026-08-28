import assert from "node:assert/strict";
import test from "node:test";

import {
  createSignedOAuthState,
  InstagramTokenCipher,
  verifySignedOAuthState,
} from "../instagram-crypto.js";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

test("AES-256-GCM cifra e decifra o token sem armazenar texto puro", () => {
  const cipher = new InstagramTokenCipher(TEST_KEY, "test-v1");
  const encrypted = cipher.encrypt("token-sensivel-instagram");

  assert.equal(encrypted.iv.length, 12);
  assert.equal(encrypted.authTag.length, 16);
  assert.notEqual(encrypted.ciphertext.toString("utf8"), "token-sensivel-instagram");
  assert.equal(cipher.decrypt(encrypted), "token-sensivel-instagram");
});

test("AES-256-GCM rejeita adulteracao e versao de chave incorreta", () => {
  const cipher = new InstagramTokenCipher(TEST_KEY, "test-v1");
  const encrypted = cipher.encrypt("token-sensivel-instagram");
  const tampered = { ...encrypted, ciphertext: Buffer.from(encrypted.ciphertext) };
  tampered.ciphertext[0] ^= 1;

  assert.throws(() => cipher.decrypt(tampered));
  assert.throws(() => cipher.decrypt({ ...encrypted, keyVersion: "test-v2" }));
});

test("state OAuth valida assinatura e expira", () => {
  const originalNow = Date.now;
  let currentTime = 1_800_000_000_000;
  Date.now = () => currentTime;

  try {
    const { state, nonce } = createSignedOAuthState("segredo-de-teste");
    assert.equal(verifySignedOAuthState(state, "segredo-de-teste")?.nonce, nonce);
    assert.equal(verifySignedOAuthState(`${state}x`, "segredo-de-teste"), null);

    currentTime += 16 * 60 * 1_000;
    assert.equal(verifySignedOAuthState(state, "segredo-de-teste"), null);
  } finally {
    Date.now = originalNow;
  }
});
