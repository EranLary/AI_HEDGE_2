import Link from "next/link";

export function HeaderNav() {
  return (
    <nav className="app-header__nav">
      <Link href="/runs">Runs</Link>
      <Link href="/users">Users</Link>
    </nav>
  );
}
