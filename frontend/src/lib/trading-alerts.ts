import "server-only";

import { markTradingEventTelegramSent } from "@/lib/trading-db";

export async function sendTradingTelegramAlert(args: {
  connectionId: string;
  eventId: string;
  severity: "warning" | "critical";
  message: string;
}): Promise<boolean> {
  const token = String(process.env.TRADING_TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.TRADING_TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) return false;
  const prefix = args.severity === "critical" ? "TRADING CRITICAL" : "TRADING WARNING";
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${prefix}\n${args.message}`,
        disable_web_page_preview: true,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    await markTradingEventTelegramSent(args.connectionId, args.eventId);
    return true;
  } catch (error) {
    console.warn("[trading] Telegram alert delivery failed", error);
    return false;
  }
}
