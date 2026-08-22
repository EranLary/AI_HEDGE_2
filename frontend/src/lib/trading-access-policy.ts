export const TRADING_USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function flagEnabled(raw: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(raw || "").trim().toLowerCase());
}

export function tradingMutationsEnabled(args: { controlFlag: string | undefined; previewFlag: string | undefined }): boolean {
  return flagEnabled(args.controlFlag) && !flagEnabled(args.previewFlag);
}

export function tradingSessionIsEligible(user: {
  id?: string | null;
  email?: string | null;
  isGuest?: boolean | null;
  authProvider?: string | null;
} | null | undefined): boolean {
  return Boolean(
    user
    && TRADING_USER_ID_RE.test(String(user.id || "").trim())
    && String(user.email || "").trim()
    && !user.isGuest
    && user.authProvider === "google",
  );
}
