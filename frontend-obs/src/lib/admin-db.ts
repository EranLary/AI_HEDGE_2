import { getObsSql } from "@/lib/obs-db";

export type AdminRow = {
  email: string;
  added_by: string | null;
  added_at: string;
  is_super: boolean;
};

function normalizeEmail(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

export async function listAdmins(): Promise<AdminRow[]> {
  const sql = getObsSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT email, added_by, added_at, is_super
      FROM obs_admins
     ORDER BY is_super DESC, added_at ASC
  `) as unknown as AdminRow[];
  return rows;
}

export async function isAdmin(email: string): Promise<boolean> {
  const sql = getObsSql();
  if (!sql) return false;
  const e = normalizeEmail(email);
  if (!e) return false;
  const rows = (await sql`
    SELECT 1 AS hit FROM obs_admins WHERE email = ${e} LIMIT 1
  `) as unknown as { hit: number }[];
  return rows.length > 0;
}

export async function isSuper(email: string): Promise<boolean> {
  const sql = getObsSql();
  if (!sql) return false;
  const e = normalizeEmail(email);
  if (!e) return false;
  const rows = (await sql`
    SELECT is_super FROM obs_admins WHERE email = ${e} LIMIT 1
  `) as unknown as { is_super: boolean }[];
  return rows.length > 0 && rows[0].is_super === true;
}

export async function addAdmin(email: string, addedBy: string): Promise<void> {
  const sql = getObsSql();
  if (!sql) throw new Error("Database not configured");
  const e = normalizeEmail(email);
  const by = normalizeEmail(addedBy) || null;
  if (!e || !e.includes("@")) {
    throw new Error("Invalid email");
  }
  await sql`
    INSERT INTO obs_admins (email, added_by, is_super)
         VALUES (${e}, ${by}, false)
    ON CONFLICT (email) DO NOTHING
  `;
}

export async function removeAdmin(email: string): Promise<void> {
  const sql = getObsSql();
  if (!sql) throw new Error("Database not configured");
  const e = normalizeEmail(email);
  if (!e) return;
  await sql`DELETE FROM obs_admins WHERE email = ${e}`;
}
