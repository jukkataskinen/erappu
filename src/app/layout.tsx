import type { Metadata, Viewport } from "next";
import { sans } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "eRappu", template: "%s | eRappu" },
  description: "Isännöinnin työkalu: taloyhtiöt, HTJ, huoltopyynnöt ja portaali samassa paikassa.",
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1b2a41",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fi" className={`${sans.variable} h-full`}>
      <body className="min-h-full bg-cloud text-ink antialiased">{children}</body>
    </html>
  );
}
