import type { Metadata } from "next";
import { StreamedDeck } from "@/components/deck/streamed-deck";
import { PushPrompt } from "@/components/notifications/push-prompt";
import { requireUser } from "@/lib/auth";
import { startDeck } from "@/server/deck-data";

export const metadata: Metadata = { title: "Command Centre" };

export default async function CommandDeckPage() {
  const user = await requireUser();
  // Every loader starts here; each part of the page shows as soon as its own answers are in.
  const parts = await startDeck(user);
  // The offer to turn on alerts sits under the headline (glass-spec 8.1); it shows itself only when it is needed.
  return <StreamedDeck parts={parts} push={<PushPrompt userId={user.id} />} />;
}
