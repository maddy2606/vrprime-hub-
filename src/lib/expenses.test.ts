import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExpenses, categoryFor, monthOf, monthSummary, noteAmount, pickAmount, readReceipt, type GroupMessage } from "./expenses.ts";

const at = (min: number) => new Date(Date.UTC(2026, 9, 19, 5, 0) + min * 60_000).toISOString();
const msg = (id: string, min: number, kind: GroupMessage["kind"], body: string | null = null, sender = "Jigar"): GroupMessage => ({ id, sentAt: at(min), sender, kind, body });

test("the amount in a note: marked with ₹ or Rs first, else the biggest plain number that is not a date, time or phone", () => {
  assert.equal(noteAmount("Tape 2 rolls 340"), 340);
  assert.equal(noteAmount("Paid ₹1,250 to tempo for 2 trips"), 1250);
  assert.equal(noteAmount("rs 75 chai"), 75);
  assert.equal(noteAmount("500/- labour"), 500);
  assert.equal(noteAmount("Courier on 19/10/2026 at 10:30, call 9876543210 — 860"), 860);
  assert.equal(noteAmount("tea for 5 people"), null, "a single digit is a count, not money");
  assert.equal(noteAmount(""), null);
});

test("the type of expense from the note's words, in English or Hindi", () => {
  assert.equal(categoryFor("Brown tape 6 rolls"), "Packing material");
  assert.equal(categoryFor("Tempo bhada Bhiwandi"), "Transport and courier");
  assert.equal(categoryFor("chai nashta staff"), "Food and tea", "who it was for (staff) does not decide the type");
  assert.equal(categoryFor("Salary advance Ramesh"), "Staff and labour");
  assert.equal(categoryFor("Chai and biscuits"), "Food and tea");
  assert.equal(categoryFor("Light bill October"), "Rent and utilities");
  assert.equal(categoryFor("Petrol for bike"), "Fuel");
  assert.equal(categoryFor("misc"), "Other");
});

test("a payment screenshot's text: amount, who was paid and the UPI reference", () => {
  const gpay = "Paid to\nSHREE GANESH PACKAGING\n₹1,250\nCompleted\n19 Oct 2026, 10:32 am\nUPI transaction ID\n429316843210\nTo: SHREE GANESH PACKAGING";
  assert.deepEqual(readReceipt(gpay), { amount: 1250, paidTo: "SHREE GANESH PACKAGING", reference: "429316843210" });
  const phonepe = "Transaction Successful\n10:32 am on 19 Oct 2026\nPaid to\nRamesh Tempo\n500\nUTR: 6123456789012";
  const r = readReceipt(phonepe);
  assert.equal(r.amount, 500, "a line that is only a number counts when the ₹ sign was not read");
  assert.equal(r.paidTo, "Ramesh Tempo");
  assert.equal(r.reference, "6123456789012");
  assert.deepEqual(readReceipt(""), { amount: null, paidTo: null, reference: null });
});

test("a screenshot takes the note sent right after it by the same person; a caption wins", () => {
  const out = buildExpenses([
    msg("img1", 0, "image"),
    msg("t1", 1, "text", "Packing tape 340"),
    msg("img2", 30, "image", "Tempo bhada 800"),
    msg("t2", 31, "text", "ok", "Aman"),
  ]);
  assert.deepEqual(out.map((e) => [e.key, e.reason, e.textAmount, e.category]), [
    ["img1", "Packing tape 340", 340, "Packing material"],
    ["img2", "Tempo bhada 800", 800, "Transport and courier"],
  ]);
  assert.equal(out[0].textMessageId, "t1");
});

test("the note before the screenshot is used when nothing follows; notes too far away or from someone else are not", () => {
  const out = buildExpenses([msg("t0", 0, "text", "Chai 120"), msg("img", 5, "image"), msg("img2", 60, "image"), msg("t9", 61, "text", "light bill 2300", "Someone")]);
  assert.equal(out.find((e) => e.key === "img")?.reason, "Chai 120");
  assert.equal(out.find((e) => e.key === "img2")?.reason, null);
  assert.ok(out.some((e) => e.key === "t9" && e.textAmount === 2300), "Someone's note with an amount, with no screenshot of theirs near it, is its own expense");
});

test("a note with an amount and no screenshot is an expense; plain chat and deleted messages are not", () => {
  const out = buildExpenses([msg("a", 0, "text", "Cash paid 200 for cleaning"), msg("b", 40, "text", "Will send tomorrow"), { ...msg("c", 80, "image", "tape 90"), deleted: true }]);
  assert.deepEqual(out.map((e) => [e.key, e.textAmount, e.category, e.imageMessageId]), [["a", 200, "Cleaning", null]]);
});

test("a month adds up: ignored ones left out, still-to-check counted, types biggest first", () => {
  const s = monthSummary([
    { amount: 340, category: "Packing material", status: "checked" },
    { amount: 800, category: "Transport and courier", status: "new" },
    { amount: 60, category: "Packing material", status: "new" },
    { amount: null, category: "Other", status: "new" },
    { amount: 999, category: "Other", status: "ignored" },
  ]);
  assert.equal(s.total, 1200);
  assert.equal(s.count, 4);
  assert.equal(s.toCheck, 3);
  assert.equal(s.noAmount, 1);
  assert.deepEqual(s.byCategory.map((c) => [c.category, c.total, c.count]), [["Transport and courier", 800, 1], ["Packing material", 400, 2], ["Other", 0, 1]]);
});

test("the amount used: typed, else the screenshot, else the note; and months in India time", () => {
  assert.deepEqual(pickAmount({ typed: 100, read: 90, text: 80 }), { amount: 100, from: "typed" });
  assert.deepEqual(pickAmount({ read: 90, text: 80 }), { amount: 90, from: "screenshot" });
  assert.deepEqual(pickAmount({ read: null, text: 80 }), { amount: 80, from: "note" });
  assert.deepEqual(pickAmount({ read: null, text: null }), { amount: null, from: null });
  assert.equal(monthOf("2026-10-31T20:00:00Z"), "2026-11", "1:30 am on 1 Nov in India");
});
