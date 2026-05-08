import { headers } from "next/headers";

import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin-db";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

async function shouldBypassForLocalDev(): Promise<boolean> {
  if (process.env.NODE_ENV === "production") return false;
  const flag = String(process.env.AUTH_BYPASS_LOCAL ?? "1").trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(flag)) return false;
  try {
    const h = await headers();
    const host = (h.get("host") || "").split(":")[0].toLowerCase();
    return LOCAL_HOSTNAMES.has(host);
  } catch {
    return false;
  }
}

export class AdminForbiddenError extends Error {
  email: string;
  constructor(email: string) {
    super(`Not authorised: ${email || "<no session>"}`);
    this.email = email;
    this.name = "AdminForbiddenError";
  }
}

export async function requireAdmin(): Promise<{ email: string }> {
  if (await shouldBypassForLocalDev()) {
    return { email: "local-dev@bypass" };
  }
  const session = await auth();
  const email = (session?.user?.email || "").toLowerCase();
  if (!email) throw new AdminForbiddenError("");
  if (!(await isAdmin(email))) throw new AdminForbiddenError(email);
  return { email };
}
