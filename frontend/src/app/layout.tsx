import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { ActiveRunIndicator } from "@/components/active-run-indicator";
import { ThemeInit } from "@/components/theme-init";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hedge in a Box",
  description: "Institutional valuation dashboard for retail and professional investors.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-carbon text-zinc-100">
        <ThemeInit />
        <ActiveRunIndicator />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-white/10 bg-black/35 px-4 py-2 text-center text-[11px] text-zinc-400 sm:px-8">
          AI-generated. For informational purposes only. Not investment advice. No guarantee of accuracy or results.
        </footer>
      </body>
    </html>
  );
}
