import assert from "node:assert/strict";
import test from "node:test";

import { toPublicStorageUrl } from "../storage-public-url.js";

const originalPublicUrl = process.env.SUPABASE_PUBLIC_URL;

test.after(() => {
  if (originalPublicUrl === undefined) delete process.env.SUPABASE_PUBLIC_URL;
  else process.env.SUPABASE_PUBLIC_URL = originalPublicUrl;
});

test("rewrites an internal Supabase Storage URL for the external client", () => {
  process.env.SUPABASE_PUBLIC_URL = "https://supa.itstime.pro";

  assert.equal(
    toPublicStorageUrl("http://supabase-envoy:8000/storage/v1/object/sign/chat-attachments/a.jpg?token=abc"),
    "https://supa.itstime.pro/storage/v1/object/sign/chat-attachments/a.jpg?token=abc",
  );
});

test("adds the Storage API prefix when the SDK returns a relative path", () => {
  process.env.SUPABASE_PUBLIC_URL = "https://supa.itstime.pro/";

  assert.equal(
    toPublicStorageUrl("/object/sign/chat-attachments/a.jpg?token=abc"),
    "https://supa.itstime.pro/storage/v1/object/sign/chat-attachments/a.jpg?token=abc",
  );
});

test("leaves non-Storage URLs unchanged", () => {
  process.env.SUPABASE_PUBLIC_URL = "https://supa.itstime.pro";

  assert.equal(toPublicStorageUrl("https://example.com/image.jpg"), "https://example.com/image.jpg");
});
