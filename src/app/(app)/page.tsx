import type { Metadata } from "next";
import { CommandDeck } from "@/components/deck/sections";
import { requireUser } from "@/lib/auth";
import { loadDeck } from "@/server/deck-data";

export const metadata: Metadata = { title: "Command Deck" };

export default async function CommandDeckPage() {
  const user = await requireUser();
  const d = await loadDeck(user);
  return <CommandDeck d={d} />;
}
