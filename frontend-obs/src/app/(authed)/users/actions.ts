"use server";

import { revalidatePath } from "next/cache";

import { addAdmin, isSuper, removeAdmin } from "@/lib/admin-db";
import { requireAdmin } from "@/lib/auth-helpers";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function addAdminAction(formData: FormData): Promise<ActionResult> {
  let actor: string;
  try {
    ({ email: actor } = await requireAdmin());
  } catch {
    return { ok: false, error: "Not authorised" };
  }

  const raw = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!raw) return { ok: false, error: "Email is required" };
  if (!raw.includes("@") || raw.length < 4) return { ok: false, error: "Invalid email" };

  try {
    await addAdmin(raw, actor);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add admin" };
  }
  revalidatePath("/users");
  return { ok: true };
}

export async function removeAdminAction(formData: FormData): Promise<ActionResult> {
  let actor: string;
  try {
    ({ email: actor } = await requireAdmin());
  } catch {
    return { ok: false, error: "Not authorised" };
  }

  const target = String(formData.get("email") ?? "").trim().toLowerCase();
  const targetIsSuper = String(formData.get("is_super") ?? "false") === "true";
  if (!target) return { ok: false, error: "Missing email" };

  if (target === actor) return { ok: false, error: "You cannot remove yourself" };

  if (targetIsSuper) {
    const actorIsSuper = await isSuper(actor);
    if (!actorIsSuper) return { ok: false, error: "Only super admins can remove super admins" };
  }

  try {
    await removeAdmin(target);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to remove admin" };
  }
  revalidatePath("/users");
  return { ok: true };
}
