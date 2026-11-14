import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { ServiceWorker } from "@/components/service-worker";
import { ToastProvider } from "@/components/toast";
import { readThemeMode, THEME_COOKIE } from "@/lib/theme-mode";
import "./globals.css";

// Ledger: Archivo for words and headings, IBM Plex Mono for every figure, SKU and order ID.
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], display: "swap" });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "VR Prime Ops", template: "%s · VR Prime Ops" },
  description: "Tasks, problems and stock for the VR Prime team.",
  applicationName: "VR Prime Ops",
  appleWebApp: { capable: true, title: "VR Prime Ops", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

const PAPER = "#f4f3ef";
const NIGHT = "#111113";

/** The browser bar and form controls follow the chosen mode; Auto follows the device (the page itself does too, in CSS). */
export async function generateViewport(): Promise<Viewport> {
  const mode = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  const base = { width: "device-width", initialScale: 1, viewportFit: "cover" } as const;
  if (mode === "light") return { ...base, themeColor: PAPER, colorScheme: "light" };
  if (mode === "dark") return { ...base, themeColor: NIGHT, colorScheme: "dark" };
  return {
    ...base,
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: PAPER },
      { media: "(prefers-color-scheme: dark)", color: NIGHT },
    ],
    colorScheme: "light dark",
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const mode = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  return (
    // data-theme is left off for Auto, so the CSS follows prefers-color-scheme; the switch in the account menu sets it.
    <html lang="en-IN" data-theme={mode === "auto" ? undefined : mode} className={`${archivo.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
