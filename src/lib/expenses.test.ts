import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExpenses, categoryFor, cleanNote, counts, isTally, monthOf, monthSummary, noteAmount, pickAmount, readReceipt, type GroupMessage } from "./expenses.ts";

// Times in minutes after 10:00 IST on 15 Oct 2026. "me" is the linked phone (the owner); "j" is Jigar.
const at = (min: number) => new Date(Date.UTC(2026, 9, 15, 4, 30) + min * 60_000).toISOString();
const img = (id: string, min: number, who: string, body: string | null = null, isQr: boolean | null = false): GroupMessage => ({ id, sentAt: at(min), sender: who === "me" ? "You" : null, senderId: who, kind: "image", body, isQr });
const txt = (id: string, min: number, who: string, body: string): GroupMessage => ({ id, sentAt: at(min), sender: who === "me" ? "You" : null, senderId: who, kind: "text", body });

test("the amount in a note: marked with ₹, Rs or /- first, 12k is 12,000, and dates, times, phones and @mentions are not money", () => {
  assert.equal(noteAmount("1590/- Courier 35kg"), 1590);
  assert.equal(noteAmount("625/- Laber 125 crtn"), 625);
  assert.equal(noteAmount("Paid ₹1,250 to tempo for 2 trips"), 1250);
  assert.equal(noteAmount("10k diya"), 10000);
  assert.equal(noteAmount("@215680674693316 1400 Kokata Inverter"), 1400);
  assert.equal(noteAmount("Courier on 19/10/2026 at 10:30, call 9876543210 — 860"), 860);
  assert.equal(noteAmount("tea for 5 people"), null);
});

test("the type from the group's own words", () => {
  assert.equal(categoryFor("Bhiwandi To Purna Porter ~ Delhi K Liye"), "Transport and courier");
  assert.equal(categoryFor("625/- Laber 125 crtn"), "Packing material", "cartons come first");
  assert.equal(categoryFor("Laber charges"), "Staff and labour");
  assert.equal(categoryFor("Delhi Pine ka Paani"), "Food and tea");
  assert.equal(categoryFor("2900 Ticket Delhi"), "Travel");
  assert.equal(categoryFor("1400 Kokata Inverter"), "Equipment and furniture");
  assert.equal(categoryFor("And Gadda 1500/-"), "Equipment and furniture");
  assert.equal(categoryFor("130 pay to rapido"), "Transport and courier");
  assert.equal(categoryFor("Lucknow boxes"), "Packing material");
  assert.equal(categoryFor("Salary advance Ramesh"), "Staff and labour");
  assert.equal(categoryFor("misc"), "Other");
});

test("tallies are recognised, and notes are cleaned of @mentions and stars", () => {
  assert.ok(isTally("560 650 350 400 480 1050 Total 3490 *Available Balance ~ 18114*"));
  assert.ok(isTally("*Available Balance ~ 2877*"));
  assert.ok(!isTally("1590/- Courier 35kg"));
  assert.equal(cleanNote("@215680674693316 1400 *Kokata* Inverter"), "1400 Kokata Inverter");
});

test("a payment screenshot is read as a payment; a QR to scan is not", () => {
  const gpay = "Paid to\nSHREE GANESH PACKAGING\n₹1,250\nCompleted\n19 Oct 2026, 10:32 am\nUPI transaction ID\n429316843210";
  assert.deepEqual(readReceipt(gpay), { amount: 1250, paidTo: "SHREE GANESH PACKAGING", reference: "429316843210", payment: true });
  const phonepe = "Transaction Successful\n10:32 am on 19 Oct 2026\nPaid to\nRamesh Tempo\n500\nUTR: 6123456789012";
  assert.equal(readReceipt(phonepe).payment, true);
  assert.equal(readReceipt(phonepe).amount, 500);
  assert.equal(readReceipt("Scan this to pay through PhonePe\nAccepted here\nBHIM UPI").payment, false, "a QR poster");
  assert.equal(readReceipt("Scan & pay ₹1,050\nUPI ID: shop@ybl").payment, false, "a QR with an amount on it");
  assert.equal(readReceipt("Photo of a bill: tape 6 rolls").payment, false, "no amount, no payment words");
});

test("a payment made from someone's QR takes the QR's reason; the QR itself is never an expense", () => {
  const out = buildExpenses([
    img("qr", 0, "me", null, true),
    txt("n1", 1, "me", "@215680674693316 1400 Kokata Inverter"),
    img("pay", 6, "j"),
  ]);
  assert.deepEqual(out.map((e) => [e.key, e.reason, e.textAmount, e.category]), [["pay", "1400 Kokata Inverter", 1400, "Equipment and furniture"]]);
});

test("a tally right after a payment is never its reason (the 15 Oct ₹5,070)", () => {
  const out = buildExpenses([
    img("qr", 0, "me", null, true),
    txt("n1", 1, "me", "5070"),
    img("pay", 14, "j"),
    txt("tally", 16, "j", "1590 5070 Total - 6660 Available Balance ~ 11454"),
  ]);
  assert.deepEqual(out.map((e) => [e.key, e.reason, e.textAmount]), [["pay", "5070", 5070]]);
});

test("the owner's own payment screenshot joins the notes sent with it", () => {
  const out = buildExpenses([img("pay", 0, "me"), txt("a", 1, "me", "650 @215680674693316"), txt("b", 1, "me", "Bhiwandi Trolley Wheel")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].reason, "650 · Bhiwandi Trolley Wheel");
  assert.equal(out[0].textAmount, 650);
});

test("chat is never an expense, a caption wins, and two screenshots in a row each keep their own note", () => {
  const out = buildExpenses([
    txt("chat1", 0, "j", "12k?"),
    txt("chat2", 1, "j", "500rs per month tha na paani"),
    txt("cash", 2, "j", "1590/- Courier 35kg"),
    img("p1", 30, "j", "Delhi Pine ka Paani"),
    img("p2", 40, "j"),
    txt("n2", 41, "j", "Mumbai Porter Arihant Sir"),
    img("p3", 50, "j"),
    txt("n3", 51, "j", "350"),
  ]);
  assert.deepEqual(out.map((e) => [e.key, e.reason]), [["p1", "Delhi Pine ka Paani"], ["p2", "Mumbai Porter Arihant Sir"], ["p3", "350"]]);
});

test("a month adds up what counts, and only payment screenshots count", () => {
  const s = monthSummary([
    { amount: 340, category: "Packing material", status: "checked" },
    { amount: 800, category: "Transport and courier", status: "new" },
    { amount: 999, category: "Other", status: "ignored" },
  ]);
  assert.equal(s.total, 1140);
  assert.equal(s.count, 2);
  assert.ok(counts({ status: "new", verdict: "payment" }));
  assert.ok(!counts({ status: "new", verdict: "pending" }), "not read yet");
  assert.ok(!counts({ status: "new", verdict: "not_payment" }));
  assert.ok(!counts({ status: "ignored", verdict: "payment" }));
});

test("the amount used: typed, else the screenshot, else the note; and months in India time", () => {
  assert.deepEqual(pickAmount({ typed: 100, read: 90, text: 80 }), { amount: 100, from: "typed" });
  assert.deepEqual(pickAmount({ read: 90, text: 80 }), { amount: 90, from: "screenshot" });
  assert.deepEqual(pickAmount({ read: null, text: 80 }), { amount: 80, from: "note" });
  assert.equal(monthOf("2026-10-31T20:00:00Z"), "2026-11");
});
