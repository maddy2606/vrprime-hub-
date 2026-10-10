// VR Prime Ops service worker.
// Phase 1: makes the app installable. Nothing is cached, so staff always see live data.
// Phase 2 will start sending push messages; the handlers below are ready for them.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// A fetch handler is required for the browser to offer "Install app".
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "VR Prime Ops", body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "VR Prime Ops", {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: payload.tag,
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
