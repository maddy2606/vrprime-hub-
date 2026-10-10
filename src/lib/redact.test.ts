// Run with: npm test
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { redactSecrets, safeError } from "./redact.ts";

afterEach(() => {
  delete process.env.SUPABASE_SECRET_KEY;
});

test("removes a mis-pasted secret key that contains a space", () => {
  const message = 'Headers.append: "Bearer sb_secret_abc 123" is an invalid header value.';
  const out = redactSecrets(message);
  assert.ok(!out.includes("sb_secret_"), out);
  assert.ok(!out.includes("abc"), out);
  assert.ok(!out.includes("123"), out);
  assert.equal(out, "Headers.append: [redacted] is an invalid header value.");
});

test("removes an unquoted Bearer token", () => {
  const out = redactSecrets("request failed with Bearer xyz today");
  assert.ok(!out.includes("xyz"), out);
  assert.equal(out, "request failed with [redacted] today");
});

test("removes Supabase keys and JWTs anywhere in the text", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl";
  const out = redactSecrets(`key sb_secret_FAKEfake1234 and sb_publishable_FAKE5678 and ${jwt} end`);
  assert.equal(out, "key [redacted] and [redacted] and [redacted] end");
});

test("removes the configured secret even when it does not look like a key", () => {
  process.env.SUPABASE_SECRET_KEY = " not-a-normal-key with-a-space ";
  const out = redactSecrets("bad value: not-a-normal-key with-a-space; also with-a-space alone");
  assert.ok(!out.includes("not-a-normal-key"), out);
  assert.ok(!out.includes("with-a-space"), out);
});

test("leaves ordinary messages alone", () => {
  const message = "Could not save post VR-1042 (error 400: duplicate key)";
  assert.equal(redactSecrets(message), message);
});

test("safeError redacts the message and keeps status and code", () => {
  const out = safeError({ status: 401, code: "bad_key", message: 'header "Bearer sb_secret_abc 123" rejected' });
  assert.deepEqual(out, { status: 401, code: "bad_key", message: "header [redacted] rejected" });
});
