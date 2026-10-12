"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { pushSubscriptionSchema } from "@/lib/validation";
import { dbError, NOT_SIGNED_IN } from "@/server/action-helpers";

export async function markNotificationRead(notificationId: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const id = z.uuid().safeParse(notificationId);
  if (!id.success) return { ok: false, message: "Notification not found." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id.data)
    .is("read_at", null);
  if (error) return dbError(error, "mark the notification read");

  revalidatePath("/", "layout");
  return { ok: true, message: "Marked read" };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error) return dbError(error, "mark notifications read");

  revalidatePath("/", "layout");
  return { ok: true, message: "All marked read" };
}

/** Saves this device so it can receive push messages. */
export async function savePushSubscription(input: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const parsed = pushSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "This device could not be registered for notifications." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.p256dh,
    p_auth: parsed.data.auth,
  });
  if (error) return dbError(error, "turn on notifications");
  return { ok: true, message: "Notifications are on for this device" };
}

export async function removePushSubscription(endpoint: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const url = z.url().safeParse(endpoint);
  if (!url.success) return { ok: false, message: "This device could not be found." };

  const supabase = await createClient();
  // RLS limits this to the person's own devices.
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", url.data);
  if (error) return dbError(error, "turn off notifications");
  return { ok: true, message: "Notifications are off for this device" };
}

/** Sends the person a test notification (in the bell, and as a push to their devices). */
export async function sendTestNotification(): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;

  const supabase = await createClient();
  const { error } = await supabase.rpc("send_test_notification");
  if (error) return dbError(error, "send the test notification");

  revalidatePath("/", "layout");
  return { ok: true, message: "Test sent. It should arrive in a few seconds." };
}
