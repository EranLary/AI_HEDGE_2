import type { Metadata } from "next";
import { AuthSessionProvider } from "@/components/auth/session-provider";
import { ThemeInit } from "@/components/theme-init";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hedge Observability",
  description: "Internal observability for the Hedge in a Box agentic pipeline.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" className="h-full antialiased" suppressHydrationWarning>
      <body suppressHydrationWarning style={{ minHeight: "100%" }}>
        <ThemeInit />
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </body>
    </html>
  );
}
