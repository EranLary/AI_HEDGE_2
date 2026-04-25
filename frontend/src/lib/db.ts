import { neon, NeonQueryFunction } from "@neondatabase/serverless";

let cached: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> | null {
  if (cached) return cached;
  const url = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!url) return null;
  cached = neon(url);
  return cached;
}

export function isDbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED);
}
