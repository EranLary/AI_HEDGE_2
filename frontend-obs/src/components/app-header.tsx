import Link from "next/link";
import { ReactNode } from "react";

import { HeaderNav } from "@/components/header-nav";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

type AppHeaderProps = {
  email: string;
  signOutSlot: ReactNode;
};

export function AppHeader({ email, signOutSlot }: AppHeaderProps) {
  return (
    <header className="app-header">
      <Link href="/runs" className="app-header__brand">
        <Logo height={28} />
        <span style={{ display: "flex", flexDirection: "column" }}>
          <span className="app-header__title">Observability</span>
          <span className="app-header__subtitle">Hedge in a Box</span>
        </span>
      </Link>
      <span className="app-header__pill">internal</span>
      <HeaderNav />
      <div className="app-header__spacer" />
      <ThemeToggle />
      {email && <span className="app-header__email">{email}</span>}
      {signOutSlot}
    </header>
  );
}
