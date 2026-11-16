import type { Metadata } from "next";
import { CommandDeck } from "@/components/deck/sections";
import { PushPrompt } from "@/components/notifications/push-prompt";
import { requireUser } from "@/lib/auth";
import { loadDeck } from "@/server/deck-data";

export const metadata: Metadata = { title: "Command Centre" };

export default async function CommandDeckPage() {
  const user = await requireUser();
  const d = await loadDeck(user);
  // The offer to turn on alerts sits under the headline (glass-spec 8.1); it shows itself only when it is needed.
  return <CommandDeck d={d} push={<PushPrompt userId={user.id} />} />;
}
