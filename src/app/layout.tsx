import type { Metadata, Viewport } from "next";
import { Geist_Mono, Manrope, Unbounded } from "next/font/google";
import { cookies } from "next/headers";
import { ServiceWorker } from "@/components/service-worker";
import { ToastProvider } from "@/components/toast";
import { readThemeMode, THEME_COOKIE } from "@/lib/theme-mode";
import "./globals.css";

// Aurora Glass (glass-spec section 2): Manrope for all interface text, Unbounded for titles and big numbers, Geist Mono
// for every figure, SKU and ID. globals.css maps these onto --font-sans, --font-display and --font-mono.
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });
const unbounded = Unbounded({ variable: "--font-unbounded", subsets: ["latin"], weight: ["500", "600"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "VR Prime Ops", template: "%s · VR Prime Ops" },
  description: "Tasks, problems and stock for the VR Prime team.",
  applicationName: "VR Prime Ops",
  appleWebApp: { capable: true, title: "VR Prime Ops", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

// The page canvas in each mode (glass-spec section 1), for the browser bar.
const PAPER = "#eef0f7";
const NIGHT = "#07080d";

/** The browser bar and form controls follow the chosen mode. Auto is dark, like the page (glass-spec section 1). */
export async function generateViewport(): Promise<Viewport> {
  const mode = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  const base = { width: "device-width", initialScale: 1, viewportFit: "cover" } as const;
  if (mode === "light") return { ...base, themeColor: PAPER, colorScheme: "light" };
  return { ...base, themeColor: NIGHT, colorScheme: "dark" };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const mode = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  return (
    // data-theme is left off for Auto, which the CSS draws dark; the switch in the account menu sets it.
    <html lang="en-IN" data-theme={mode === "auto" ? undefined : mode} className={`${manrope.variable} ${unbounded.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
