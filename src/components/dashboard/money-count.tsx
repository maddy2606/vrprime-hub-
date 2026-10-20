"use client";

import { CountUp } from "@/components/signal/count-up";
import { formatINR } from "@/lib/format";

/** ₹ in lakh or crore (₹16.5L, ₹1.02Cr), exact rupees below a lakh. */
export function shortRupees(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)}L`;
  return `${sign}${formatINR(Math.round(a))}`;
}

/** A rupee amount that counts up, in lakh or crore. (The format lives here: a server page cannot hand a function over.) */
export function RupeesCountUp({ value }: { value: number }) {
  return <CountUp value={value} format={shortRupees} />;
}
