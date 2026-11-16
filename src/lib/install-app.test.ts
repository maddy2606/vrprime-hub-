import assert from "node:assert/strict";
import { test } from "node:test";
import { installKind, isChromium } from "./install-app.ts";

const base = { standalone: false, installed: false, hidden: false, ios: false, offered: false, chromium: true };

test("prompt when offered, steps in Chrome or Edge otherwise, iPhone steps, nothing elsewhere", () => {
  assert.equal(installKind({ ...base, offered: true }), "prompt");
  assert.equal(installKind(base), "steps");
  assert.equal(installKind({ ...base, ios: true, chromium: false }), "ios");
  assert.equal(installKind({ ...base, chromium: false }), "none");
});

test("hidden inside the app, once installed, and after Not now", () => {
  assert.equal(installKind({ ...base, offered: true, standalone: true }), "none");
  assert.equal(installKind({ ...base, offered: true, installed: true }), "none");
  assert.equal(installKind({ ...base, offered: true, hidden: true }), "none");
  assert.equal(installKind({ ...base, ios: true, hidden: true }), "none");
});

test("Chromium browsers by brand list or user agent", () => {
  assert.equal(isChromium("", [{ brand: "Not=A?Brand" }, { brand: "Microsoft Edge" }]), true);
  assert.equal(isChromium("", [{ brand: "Not=A?Brand" }, { brand: "Google Chrome" }]), true);
  assert.equal(isChromium("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"), true);
  assert.equal(isChromium("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"), false);
  assert.equal(isChromium("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"), false);
});
