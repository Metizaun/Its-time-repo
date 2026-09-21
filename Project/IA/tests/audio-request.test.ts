import assert from "node:assert/strict";
import test from "node:test";

import { isExplicitAudioRequest } from "../audio-request.js";

test("reconhece pedidos explicitos de audio", () => {
  for (const text of [
    "pode enviar \u00e1udio?",
    "manda em \u00e1udio",
    "me responde por voz",
    "quero uma mensagem de voz",
    "Por gentileza, envie um audio",
  ]) {
    assert.equal(isExplicitAudioRequest(text), true, text);
  }
});

test("rejeita negacoes e simples mencoes a audio", () => {
  for (const text of [
    "n\u00e3o envie \u00e1udio",
    "nao manda audio, responda por texto",
    "n\u00e3o quero mensagem de voz",
    "sem \u00e1udio, por favor",
    "o \u00e1udio est\u00e1 habilitado?",
    "recebi seu \u00e1udio ontem",
    "prefiro saber sobre a ferramenta de \u00e1udio",
  ]) {
    assert.equal(isExplicitAudioRequest(text), false, text);
  }
});
