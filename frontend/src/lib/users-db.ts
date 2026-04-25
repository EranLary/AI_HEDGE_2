import { getSql } from "@/lib/db";

export type UpsertUserInput = {
  googleSub: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
};

export async function upsertUserOnSignIn(input: UpsertUserInput): Promise<string> {
  const sql = getSql();
  if (!sql) throw new Error("DATABASE_URL not set");
  const rows = (await sql`
    INSERT INTO users (google_sub, email, name, image_url)
    VALUES (${input.googleSub}, ${input.email}, ${input.name}, ${input.imageUrl})
    ON CONFLICT (google_sub) DO UPDATE SET
      email = EXCLUDED.email,
      name = COALESCE(EXCLUDED.name, users.name),
      image_url = COALESCE(EXCLUDED.image_url, users.image_url),
      last_login_at = now()
    RETURNING id::text AS id;
  `) as Array<{ id: string }>;
  return rows[0].id;
}
