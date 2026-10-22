import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { actionId, amountReply, BOT_CATEGORIES, botKey, cleanRead, isBotKey, parseAction, parseSenders, signatureOk, spentAt, summary, type BotAction } from "./expense-bot.ts";

const ID = "00000000-0000-4000-8000-000000000001";
const WH = "00000000-0000-4000-8000-000000000b01";

test("reads the senders setting: 10-digit numbers get India's code, a missing name becomes the last 4 digits", () => {
  const s = parseSenders("919876543210:Fake Jigar, 98765 00000 ; +91 99999-11111:Fake: Owner\nbad:Nope");
  assert.deepEqual([...s], [
    ["919876543210", "Fake Jigar"],
    ["919876500000", "…0000"],
    ["919999911111", "Fake: Owner"],
  ]);
  assert.equal(parseSenders(undefined).size, 0);
});

test("an amount on its own is an amount; anything with words is a note", () => {
  assert.equal(amountReply("1250"), 1250);
  assert.equal(amountReply(" ₹1,250 "), 1250);
  assert.equal(amountReply("Rs 1250/-"), 1250);
  assert.equal(amountReply("1.5k"), 1500);
  assert.equal(amountReply("Delhi tempo 1250"), null);
  assert.equal(amountReply("0"), null);
  assert.equal(amountReply(""), null);
});

test("button ids round-trip, and anything else is refused", () => {
  const actions: BotAction[] = [
    { kind: "warehouse", expenseId: ID, warehouseId: WH, askType: true },
    { kind: "warehouse", expenseId: ID, warehouseId: null, askType: false },
    { kind: "type", expenseId: ID, category: "Fuel" },
    { kind: "save", expenseId: ID },
    { kind: "change", expenseId: ID },
    { kind: "payment", expenseId: ID },
    { kind: "skip", expenseId: ID },
  ];
  for (const a of actions) {
    assert.deepEqual(parseAction(actionId(a)), a);
    assert.ok(actionId(a).length <= 200);
  }
  assert.equal(parseAction("ok|not-a-uuid"), null);
  assert.equal(parseAction(`ty|${ID}|99`), null);
  assert.equal(parseAction(`wh|${ID}|drop table`), null);
  assert.equal(parseAction(`zz|${ID}`), null);
  assert.equal(parseAction(undefined), null);
});

test("the type list fits WhatsApp: 10 rows, titles of 24 characters or less", () => {
  assert.equal(BOT_CATEGORIES.length, 10);
  for (const c of BOT_CATEGORIES) assert.ok(c.length <= 24, c);
});

test("cleans what the model answered", () => {
  assert.deepEqual(cleanRead({ payment: true, amount: "₹5,000", paid_to: "  Sumit  Kumar Singh ", reference: "T2610181925", paid_at: "2026-10-18T20:25:00+05:30" }), {
    payment: true,
    amount: 5000,
    paidTo: "Sumit Kumar Singh",
    reference: "T2610181925",
    paidAt: "2026-10-18T14:55:00.000Z",
  });
  assert.deepEqual(cleanRead({ payment: "yes", amount: -4, reference: "n/a", paid_at: "yesterday" }), { payment: false, amount: null, paidTo: null, reference: null, paidAt: null });
  assert.deepEqual(cleanRead(null), { payment: false, amount: null, paidTo: null, reference: null, paidAt: null });
});

test("dates it to the payment when that is believable, else to when it was sent", () => {
  const sent = "2026-10-20T10:00:00.000Z";
  const read = (paidAt: string | null) => ({ payment: true, amount: 1, paidTo: null, reference: null, paidAt });
  assert.equal(spentAt(read("2026-10-18T14:55:00.000Z"), sent), "2026-10-18T14:55:00.000Z");
  assert.equal(spentAt(read("2025-10-18T14:55:00.000Z"), sent), sent);
  assert.equal(spentAt(read("2026-10-21T10:00:00.000Z"), sent), sent);
  assert.equal(spentAt(read(null), sent), sent);
});

test("keys and the summary line", () => {
  assert.equal(botKey("919876543210", "wamid.ABC"), "bot:919876543210:wamid.ABC");
  assert.ok(isBotKey("bot:91:x") && !isBotKey("3EB0ABC") && !isBotKey(null));
  assert.equal(summary({ amount: 5000, paid_to: "Sumit Kumar Singh", category: "Transport and courier" }, "Bangalore"), "₹5,000 to Sumit Kumar Singh\nTransport and courier · Bangalore");
});

test("accepts only webhooks signed with the app secret", () => {
  const body = '{"entry":[]}';
  const sig = `sha256=${createHmac("sha256", "fake-app-secret").update(body).digest("hex")}`;
  assert.equal(signatureOk(body, sig, "fake-app-secret"), true);
  assert.equal(signatureOk(`${body} `, sig, "fake-app-secret"), false);
  assert.equal(signatureOk(body, sig, "other-secret"), false);
  assert.equal(signatureOk(body, sig.slice(7), "fake-app-secret"), false);
  assert.equal(signatureOk(body, null, "fake-app-secret"), false);
  assert.equal(signatureOk(body, sig, ""), false);
});
