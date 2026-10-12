// Browser-side helpers for web push. Only import this from client components.

// The public half of the VAPID key pair. It is safe to expose: it only says which
// server may send to this device. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY in Vercel.
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";

export type PushState =
  | "loading"
  | "unavailable" // the owner has not finished setting up push yet
  | "unsupported" // this browser cannot receive push
  | "needs-install" // iPhone: only works once the app is added to the Home Screen
  | "blocked" // the person said no in the browser
  | "off"
  | "on";

export type PushSubscriptionData = { endpoint: string; p256dh: string; auth: string };
export type PushStatus = { state: PushState; subscription: PushSubscriptionData | null };

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function toData(subscription: PushSubscription): PushSubscriptionData | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, p256dh, auth };
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // `ready` never resolves if the service worker failed to register, so do not wait forever.
  return withTimeout(navigator.serviceWorker.ready, 5000);
}

/** The state of push on this device. Never throws. */
export async function readPushStatus(): Promise<PushStatus> {
  const status = (state: PushState, subscription: PushSubscriptionData | null = null): PushStatus => ({
    state,
    subscription,
  });
  // The service worker only runs in production builds.
  if (process.env.NODE_ENV !== "production") return status("unsupported");
  if (!VAPID_PUBLIC_KEY) return status("unavailable");
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return status(isIos() && !isStandalone() ? "needs-install" : "unsupported");
  if (Notification.permission === "denied") return status("blocked");
  try {
    const existing = await (await registration()).pushManager.getSubscription();
    const data = existing ? toData(existing) : null;
    if (data && Notification.permission === "granted") return status("on", data);
    return status("off");
  } catch {
    return status("unsupported");
  }
}

export type EnableResult = { ok: true; subscription: PushSubscriptionData } | { ok: false; reason: "denied" | "failed" };

/** Asks permission (if needed) and subscribes this device. */
export async function enablePush(): Promise<EnableResult> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "denied" };
    const reg = await registration();
    const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    let data = toData(subscription);
    if (!data) {
      // A subscription made with an older key cannot be reused: start again.
      await subscription.unsubscribe();
      subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      data = toData(subscription);
    }
    return data ? { ok: true, subscription: data } : { ok: false, reason: "failed" };
  } catch (error) {
    console.error("Could not turn on notifications", error instanceof Error ? error.name : "error");
    return { ok: false, reason: "failed" };
  }
}

/** Unsubscribes this device in the browser. Returns its endpoint so the server can forget it too. */
export async function disablePush(): Promise<string | null> {
  try {
    const subscription = await (await registration()).pushManager.getSubscription();
    if (!subscription) return null;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    return endpoint;
  } catch {
    return null;
  }
}

/** This device's push endpoint, without changing anything. Used when signing out. */
export async function currentEndpoint(): Promise<string | null> {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    const subscription = await (await withTimeout(navigator.serviceWorker.ready, 3000)).pushManager.getSubscription();
    return subscription?.endpoint ?? null;
  } catch {
    return null;
  }
}
