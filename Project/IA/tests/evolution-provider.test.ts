import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

import { EvolutionWhatsAppProvider } from "../evolution-whatsapp-provider.js";

test("envia audio pelo endpoint de voz da Evolution", async () => {
  const originalPost = axios.post;
  const calls: Array<{ url: string; body: unknown; config: unknown }> = [];
  axios.post = (async (url: string, body: unknown, config: unknown) => {
    calls.push({ url, body, config });
    return { data: { key: { id: "evolution-audio-1" } } };
  }) as typeof axios.post;

  try {
    const provider = new EvolutionWhatsAppProvider({ evolutionApiUrl: "https://evolution.example", evolutionApiKey: "secret" });
    const result = await provider.sendVoiceNote({ instanceName: "Loja Centro", to: "11999999999", mediaUrl: "https://example.com/audio.mp3", sourceType: "ai" });

    assert.equal(calls[0]?.url, "https://evolution.example/message/sendWhatsAppAudio/Loja%20Centro");
    assert.deepEqual(calls[0]?.body, {
      number: "5511999999999@s.whatsapp.net",
      audio: "https://example.com/audio.mp3",
      delay: 1000,
      encoding: true,
    });
    assert.equal(result.providerMessageId, "evolution-audio-1");
  } finally {
    axios.post = originalPost;
  }
});
