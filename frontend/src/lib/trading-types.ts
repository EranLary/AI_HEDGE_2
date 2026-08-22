import type { Workspace } from "@/lib/workspace";

export const TRADING_PROVIDER = "ibkr" as const;
export const TRADING_RESERVE_FRACTION = 0.02;

export type BrokerMode = "paper" | "live";
export type TradingConnectionStatus =
  | "awaiting_pairing"
  | "disconnected"
  | "ready"
  | "paused"
  | "error"
  | "revoked";
export type TradingLinkStatus = "draft" | "armed" | "paused" | "blocked" | "revoked";
export type RebalanceStatus =
  | "queued"
  | "preflight"
  | "awaiting_market"
  | "selling"
  | "buying"
  | "completed"
  | "partial"
  | "blocked"
  | "cancel_requested"
  | "cancelled";

export type TradingLensType = "overall" | "model" | "valuator";

export type TradingHolding = {
  rank: number;
  ticker: string;
  score: number;
  weight: number;
  currency: string;
};

export type TradingPortfolioOption = {
  portfolio_key: string;
  workspace: Workspace;
  lens_type: TradingLensType;
  lens_key: string;
  label: string;
  methodology_version: string;
  latest_snapshot_id: string;
  cutoff_at: string;
  execution_date: string;
  status: "ready" | "no_positions";
  holdings_count: number;
  eligible: boolean;
  eligibility_reasons: string[];
  holdings: TradingHolding[];
};

export type TradingConnectionView = {
  id: string;
  mode: BrokerMode;
  account_masked: string;
  status: TradingConnectionStatus;
  gateway_connected: boolean;
  gateway_authenticated: boolean;
  executor_version: string;
  last_heartbeat_at: string | null;
  last_error: string;
  paired_at: string | null;
};

export type TradingStrategyView = {
  id: string;
  connection_id: string;
  workspace: Workspace;
  lens_type: TradingLensType;
  lens_key: string;
  methodology_version: string;
  budget_usd: number;
  reserve_fraction: number;
  status: TradingLinkStatus;
  latest_snapshot_id: string | null;
  last_error: string;
  armed_at: string | null;
};

export type TradingPlanView = {
  id: string;
  strategy_link_id: string;
  snapshot_id: string;
  status: RebalanceStatus;
  target_holdings: TradingHolding[];
  not_before: string | null;
  error: string;
  created_at: string;
  updated_at: string;
};

export type TradingEventView = {
  event_type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  created_at: string;
};

export type TradingPositionView = {
  symbol: string;
  conid: number | null;
  quantity: number;
  average_cost_usd: number | null;
};

export type TradingOrderView = {
  id: string;
  plan_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  requested_quantity: number;
  filled_quantity: number;
  limit_price: number | null;
  average_fill_price: number | null;
  commission: number;
  commission_currency: string;
  status: string;
  updated_at: string;
};

export type TradingFillView = {
  exec_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  commission: number;
  commission_currency: string;
  executed_at: string;
};

export type TradingDashboardPayload = {
  enabled: boolean;
  live_enabled: boolean;
  workspace: Workspace;
  connections: TradingConnectionView[];
  strategy: TradingStrategyView | null;
  portfolios: TradingPortfolioOption[];
  plans: TradingPlanView[];
  events: TradingEventView[];
  positions: TradingPositionView[];
  orders: TradingOrderView[];
  fills: TradingFillView[];
};

export function tradingPortfolioKey(args: {
  workspace: Workspace;
  lensType: TradingLensType;
  lensKey: string | null;
  methodologyVersion: string;
}): string {
  return [
    args.workspace,
    args.lensType,
    args.lensType === "overall" ? "overall" : String(args.lensKey || "").trim(),
    args.methodologyVersion,
  ].map((value) => encodeURIComponent(value)).join(":");
}
