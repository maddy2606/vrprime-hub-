import type { Metadata } from "next";
import { DispatchChart, Hero, Movers, PriorityQueue, Pulses, StockHealth, Warehouses } from "@/components/deck/sections";
import { requireUser } from "@/lib/auth";
import { loadDeck } from "@/server/deck-data";

export const metadata: Metadata = { title: "Command Deck" };

export default async function CommandDeckPage() {
  const user = await requireUser();
  const d = await loadDeck(user);
  return (
    <div className="flex flex-col gap-5">
      {d.notes.length ? (
        <p role="status" className="rounded-xl bg-cyan-soft px-3 py-2 text-sm font-semibold text-cyan">
          {d.notes.join(" ")}
        </p>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <Hero d={d} />
        <Pulses d={d} />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[1.5fr_1fr]">
        <PriorityQueue d={d} />
        <Warehouses d={d} />
      </div>
      <DispatchChart d={d} />
      <StockHealth d={d} />
      <Movers d={d} />
    </div>
  );
}
