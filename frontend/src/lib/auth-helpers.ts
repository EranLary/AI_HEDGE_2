import { headers } from "next/headers";

import { auth } from "@/auth";

function adminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS || "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function isFlagOn(raw: string | undefined, defaultOn: boolean): boolean {
  if (raw == null) return defaultOn;
  const v = raw.trim().toLowerCase();
  if (["0", "false", "off", "no", ""].includes(v)) return false;
  return true;
}

async function shouldBypassForLocalDev(): Promise<boolean> {
  if (process.env.NODE_ENV === "production") return false;
  if (!isFlagOn(process.env.AUTH_BYPASS_LOCAL, true)) return false;
  try {
    const h = await headers();
    const host = (h.get("host") || "").split(":")[0].toLowerCase();
    return LOCAL_HOSTNAMES.has(host);
  } catch {
    return false;
  }
}

function shouldBypassForPreview(): boolean {
  return isFlagOn(process.env.AUTH_BYPASS_PREVIEW, false);
}

export async function requireAdmin(): Promise<{ email: string }> {
  if (await shouldBypassForLocalDev()) {
    return { email: "local-dev@bypass" };
  }
  if (shouldBypassForPreview()) {
    return { email: "preview@bypass" };
  }
  const session = await auth();
  const email = (session?.user?.email || "").toLowerCase();
  if (!email || !adminEmails().has(email)) {
    throw new AdminForbiddenError(email);
  }
  return { email };
}

export class AdminForbiddenError extends Error {
  email: string;
  constructor(email: string) {
    super(`Not authorised: ${email || "<no session>"}`);
    this.email = email;
    this.name = "AdminForbiddenError";
  }
}
