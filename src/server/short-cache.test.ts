import assert from "node:assert/strict";
import { test } from "node:test";
import { clearShortCache, shortCache, shortCacheSize } from "./short-cache.ts";

test("a second call within the lifetime gets the stored promise, after it loads again", async () => {
  clearShortCache();
  let t = 1000;
  let calls = 0;
  const load = () => Promise.resolve(++calls);
  assert.equal(await shortCache("u1:f:[]", 30_000, load, () => t), 1);
  t += 29_999;
  assert.equal(await shortCache("u1:f:[]", 30_000, load, () => t), 1);
  t += 1;
  assert.equal(await shortCache("u1:f:[]", 30_000, load, () => t), 2);
});

test("different keys (another user) never share a result", async () => {
  clearShortCache();
  assert.equal(await shortCache("u1:f:[]", 30_000, () => Promise.resolve("one")), "one");
  assert.equal(await shortCache("u2:f:[]", 30_000, () => Promise.resolve("two")), "two");
});

test("a rejected load is removed at once, so the next call tries again", async () => {
  clearShortCache();
  await assert.rejects(shortCache("u1:bad:[]", 30_000, () => Promise.reject(new Error("down"))));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(shortCacheSize(), 0);
  assert.equal(await shortCache("u1:bad:[]", 30_000, () => Promise.resolve("ok")), "ok");
});

test("never holds more than 500 keys, dropping the oldest", async () => {
  clearShortCache();
  for (let i = 0; i < 520; i++) await shortCache(`k${i}`, 30_000, () => Promise.resolve(i));
  assert.equal(shortCacheSize(), 500);
  let called = false;
  await shortCache("k0", 30_000, () => {
    called = true;
    return Promise.resolve(0);
  });
  assert.equal(called, true, "the oldest key was dropped");
});

test("clearShortCache forgets everything", async () => {
  await shortCache("x", 30_000, () => Promise.resolve(1));
  clearShortCache();
  assert.equal(shortCacheSize(), 0);
});
