import { getSql } from "@/lib/db";
import {
  PORTFOLIO_METHODOLOGY_VERSION,
  type PortfolioTrack,
} from "@/lib/portfolio-performance-engine";
import {
  TRADING_RESERVE_FRACTION,
  tradingPortfolioKey,
  type BrokerMode,
  type RebalanceStatus,
  type TradingConnectionView,
  type TradingDashboardPayload,
  type TradingEventView,
  type TradingHolding,
  type TradingFillView,
  type TradingLensType,
  type TradingOrderView,
  type TradingPlanView,
  type TradingPortfolioOption,
  type TradingPositionView,
  type TradingStrategyView,
} from "@/lib/trading-types";
import type { Workspace } from "@/lib/workspace";

function requireSql() {
  const sql = getSql();
  if (!sql) throw new Error("DATABASE_URL is required for trading controls.");
  return sql;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function asHoldings(value: unknown): TradingHolding[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = (item || {}) as Record<string, unknown>;
    return {
      rank: Number(row.rank),
      ticker: String(row.ticker || "").toUpperCase(),
      score: Number(row.score),
      weight: Number(row.weight),
      currency: String(row.currency || "USD").toUpperCase(),
    };
  }).filter((item) => item.ticker && Number.isFinite(item.rank));
}

export function tradingExecutionIdentity(execId: string): { familyId: string; revision: number } {
  const match = execId.match(/^(.*)\.([0-9]+)$/);
  if (!match) return { familyId: execId, revision: 0 };
  return { familyId: match[1], revision: Number.parseInt(match[2], 10) };
}

export async function createTradingPairing(args: {
  userId: string;
  mode: BrokerMode;
  codeHash: string;
  expiresAt: string;
  connectionId?: string;
}): Promise<string> {
  const sql = requireSql();
  const connectionRows = args.connectionId
    ? (await sql`
        UPDATE trading_connections
           SET device_secret_hash = NULL,
               status = 'awaiting_pairing',
               gateway_connected = false,
               gateway_authenticated = false,
               executor_lease_owner = NULL,
               executor_lease_expires_at = NULL,
               last_error = '',
               updated_at = now()
         WHERE id = ${args.connectionId}::uuid
           AND user_id = ${args.userId}::uuid
           AND mode = ${args.mode}
           AND status <> 'revoked'
        RETURNING id::text AS id;
      `) as Array<{ id: string }>
    : (await sql`
        INSERT INTO trading_connections (user_id, mode)
        VALUES (${args.userId}::uuid, ${args.mode})
        RETURNING id::text AS id;
      `) as Array<{ id: string }>;
  const connectionId = connectionRows[0]?.id;
  if (!connectionId) throw new Error("Could not create trading connection.");
  await sql`
    UPDATE trading_pairing_codes
       SET consumed_at = now()
     WHERE connection_id = ${connectionId}::uuid AND consumed_at IS NULL;
  `;
  await sql`
    INSERT INTO trading_pairing_codes (connection_id, code_hash, expires_at)
    VALUES (${connectionId}::uuid, ${args.codeHash}, ${args.expiresAt}::timestamptz);
  `;
  await appendTradingAudit({
    userId: args.userId,
    connectionId,
    actorType: "user",
    action: args.connectionId ? "device_token_rotation_requested" : "pairing_code_created",
    payload: { mode: args.mode, expires_at: args.expiresAt },
  });
  return connectionId;
}

export async function consumeTradingPairing(args: {
  codeHash: string;
  deviceSecretHash: string;
  accountFingerprint: string;
  accountMasked: string;
  mode: BrokerMode;
  executorVersion: string;
}): Promise<string | null> {
  const sql = requireSql();
  const rows = (await sql`
    UPDATE trading_pairing_codes p
       SET consumed_at = now()
      FROM trading_connections c
     WHERE p.connection_id = c.id
       AND p.code_hash = ${args.codeHash}
       AND p.consumed_at IS NULL
       AND p.expires_at > now()
       AND c.mode = ${args.mode}
       AND c.status = 'awaiting_pairing'
    RETURNING p.connection_id::text AS connection_id;
  `) as Array<{ connection_id: string }>;
  const connectionId = rows[0]?.connection_id || null;
  if (!connectionId) return null;
  await sql`
    UPDATE trading_connections
       SET account_fingerprint = ${args.accountFingerprint},
           account_masked = ${args.accountMasked},
           device_secret_hash = ${args.deviceSecretHash},
           executor_version = ${args.executorVersion},
           status = 'disconnected',
           executor_lease_owner = NULL,
           executor_lease_expires_at = NULL,
           paired_at = now(),
           updated_at = now()
     WHERE id = ${connectionId}::uuid;
  `;
  await appendTradingAudit({
    connectionId,
    actorType: "executor",
    action: "executor_paired",
    payload: { mode: args.mode, account_masked: args.accountMasked, executor_version: args.executorVersion },
  });
  return connectionId;
}

export async function loadExecutorCredential(connectionId: string): Promise<{
  deviceSecretHash: string;
  status: string;
  mode: BrokerMode;
  accountFingerprint: string;
} | null> {
  const sql = requireSql();
  const rows = (await sql`
    SELECT device_secret_hash, status, mode, account_fingerprint
      FROM trading_connections
     WHERE id = ${connectionId}::uuid
       AND status <> 'revoked'
     LIMIT 1;
  `) as Array<{
    device_secret_hash: string | null;
    status: string;
    mode: BrokerMode;
    account_fingerprint: string | null;
  }>;
  const row = rows[0];
  if (!row?.device_secret_hash) return null;
  return {
    deviceSecretHash: row.device_secret_hash,
    status: row.status,
    mode: row.mode,
    accountFingerprint: String(row.account_fingerprint || ""),
  };
}

export async function registerExecutorNonce(connectionId: string, nonce: string): Promise<boolean> {
  const sql = requireSql();
  await sql`DELETE FROM trading_request_nonces WHERE seen_at < now() - interval '1 day';`;
  const rows = (await sql`
    INSERT INTO trading_request_nonces (connection_id, nonce)
    VALUES (${connectionId}::uuid, ${nonce})
    ON CONFLICT DO NOTHING
    RETURNING nonce;
  `) as Array<{ nonce: string }>;
  return rows.length === 1;
}

export async function updateTradingHeartbeat(args: {
  connectionId: string;
  executorInstanceId: string;
  gatewayConnected: boolean;
  gatewayAuthenticated: boolean;
  executorVersion: string;
  accountType?: string;
  error?: string;
  leaseOnly?: boolean;
}): Promise<boolean> {
  const sql = requireSql();
  const status = args.gatewayConnected && args.gatewayAuthenticated ? "ready" : args.error ? "error" : "disconnected";
  const rows = (await sql`
    UPDATE trading_connections
       SET gateway_connected = CASE WHEN ${args.leaseOnly === true} THEN gateway_connected ELSE ${args.gatewayConnected} END,
           gateway_authenticated = CASE WHEN ${args.leaseOnly === true} THEN gateway_authenticated ELSE ${args.gatewayAuthenticated} END,
           executor_version = ${args.executorVersion},
           account_type = CASE WHEN ${args.leaseOnly === true} THEN account_type ELSE ${String(args.accountType || "UNKNOWN").slice(0, 100)} END,
           status = CASE
             WHEN status = 'paused' OR ${args.leaseOnly === true} THEN status
             ELSE ${status}
           END,
           last_heartbeat_at = now(),
           last_error = CASE WHEN ${args.leaseOnly === true} THEN last_error ELSE ${args.error || ""} END,
           executor_lease_owner = ${args.executorInstanceId},
           executor_lease_expires_at = now() + interval '6 hours',
           updated_at = now()
      WHERE id = ${args.connectionId}::uuid
        AND status <> 'revoked'
        AND (
          executor_lease_owner IS NULL
          OR executor_lease_owner = ${args.executorInstanceId}
          OR executor_lease_expires_at IS NULL
          OR executor_lease_expires_at <= now()
        )
    RETURNING id::text AS id;
  `) as Array<{ id: string }>;
  return rows.length === 1;
}

export async function listTradingPortfolios(workspace: Workspace): Promise<TradingPortfolioOption[]> {
  const sql = requireSql();
  const rows = (await sql`
    WITH latest AS (
      SELECT DISTINCT ON (s.lens_type, s.lens_key, s.methodology_version)
             s.id,
             s.workspace,
             s.lens_type,
             s.lens_key,
             s.lens_label,
             s.methodology_version,
             s.cutoff_at,
             s.execution_date,
             s.status,
             s.selected_count,
             COALESCE(e.eligible, false) AS eligible,
             COALESCE(e.reasons, '["refresh_not_verified"]'::jsonb) AS eligibility_reasons
        FROM portfolio_snapshots s
        LEFT JOIN portfolio_snapshot_trade_eligibility e ON e.snapshot_id = s.id
       WHERE s.workspace = ${workspace}
         AND s.track = 'paper'
         AND s.methodology_version = ${PORTFOLIO_METHODOLOGY_VERSION}
         AND s.status IN ('ready', 'no_positions')
       ORDER BY s.lens_type, s.lens_key, s.methodology_version, s.cutoff_at DESC
    )
    SELECT l.id::text AS id,
           l.workspace,
           l.lens_type,
           l.lens_key,
           l.lens_label,
           l.methodology_version,
           l.cutoff_at::text AS cutoff_at,
           l.execution_date::text AS execution_date,
           l.status,
           l.selected_count,
           l.eligible,
           l.eligibility_reasons,
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'rank', h.rank,
                 'ticker', h.ticker,
                 'score', h.score,
                 'weight', h.weight,
                 'currency', h.currency
               ) ORDER BY h.rank
             ) FILTER (WHERE h.snapshot_id IS NOT NULL),
             '[]'::jsonb
           ) AS holdings
      FROM latest l
      LEFT JOIN portfolio_holdings h ON h.snapshot_id = l.id
     GROUP BY l.id, l.workspace, l.lens_type, l.lens_key, l.lens_label,
              l.methodology_version, l.cutoff_at, l.execution_date, l.status,
              l.selected_count, l.eligible, l.eligibility_reasons
     ORDER BY CASE WHEN l.lens_type = 'overall' THEN 0 WHEN l.lens_type = 'model' THEN 1 ELSE 2 END,
              l.lens_label;
  `) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const lensType = row.lens_type as TradingLensType;
    const lensKey = String(row.lens_key || (lensType === "overall" ? "overall" : ""));
    const reasons = asStringArray(row.eligibility_reasons);
    const status = row.status as "ready" | "no_positions";
    if (workspace !== "nasdaq100") reasons.push("analysis_live_execution_not_released");
    if (status === "no_positions") reasons.push("empty_target_requires_confirmation");
    const uniqueReasons = Array.from(new Set(reasons));
    const eligible = Boolean(row.eligible) && workspace === "nasdaq100" && status === "ready";
    return {
      portfolio_key: tradingPortfolioKey({
        workspace,
        lensType,
        lensKey,
        methodologyVersion: String(row.methodology_version),
      }),
      workspace,
      lens_type: lensType,
      lens_key: lensKey,
      label: lensType === "overall" ? "Overall" : String(row.lens_label || lensKey),
      methodology_version: String(row.methodology_version),
      latest_snapshot_id: String(row.id),
      cutoff_at: new Date(String(row.cutoff_at)).toISOString(),
      execution_date: String(row.execution_date),
      status,
      holdings_count: Number(row.selected_count),
      eligible,
      eligibility_reasons: uniqueReasons,
      holdings: asHoldings(row.holdings),
    };
  });
}

export async function loadTradingDashboard(args: {
  userId: string;
  workspace: Workspace;
  enabled: boolean;
  liveEnabled: boolean;
}): Promise<TradingDashboardPayload> {
  const sql = requireSql();
  const [connectionRows, strategyRows, planRows, eventRows, positionRows, orderRows, fillRows, portfolios] = await Promise.all([
    sql`
      SELECT id::text AS id, mode, account_masked, status, gateway_connected,
             gateway_authenticated, executor_version, account_type,
             last_heartbeat_at::text AS last_heartbeat_at, last_error,
             paired_at::text AS paired_at
        FROM trading_connections
       WHERE user_id = ${args.userId}::uuid AND status <> 'revoked'
       ORDER BY created_at DESC;
    `,
    sql`
      SELECT l.id::text AS id, l.connection_id::text AS connection_id, l.workspace,
             l.lens_type, l.lens_key, l.methodology_version,
             l.budget_usd::float8 AS budget_usd,
             (
               l.cash_seed_usd + COALESCE((
                 SELECT SUM(
                   CASE WHEN effective.side = 'SELL' THEN effective.quantity * effective.price
                        ELSE -(effective.quantity * effective.price) END
                   - effective.commission
                 )
                   FROM (
                     SELECT DISTINCT ON (f.connection_id, f.exec_family_id) f.*
                       FROM trading_fills f
                      ORDER BY f.connection_id, f.exec_family_id, f.exec_revision DESC, f.updated_at DESC
                   ) effective
                   JOIN trading_orders owned_order ON owned_order.id = effective.order_id
                   JOIN trading_rebalance_plans owned_plan ON owned_plan.id = owned_order.rebalance_plan_id
                  WHERE owned_plan.strategy_link_id = l.id
               ), 0)
             )::float8 AS cash_balance_usd,
             l.reserve_fraction::float8 AS reserve_fraction,
             l.status, l.latest_snapshot_id::text AS latest_snapshot_id,
             l.last_error, l.armed_at::text AS armed_at
        FROM trading_strategy_links l
        JOIN trading_connections c ON c.id = l.connection_id
       WHERE c.user_id = ${args.userId}::uuid AND l.status <> 'revoked'
       ORDER BY l.updated_at DESC
       LIMIT 1;
    `,
    sql`
      SELECT p.id::text AS id, p.strategy_link_id::text AS strategy_link_id,
             p.snapshot_id::text AS snapshot_id, p.status, p.target_holdings, p.preflight,
             p.not_before::text AS not_before, p.error,
             p.created_at::text AS created_at, p.updated_at::text AS updated_at
        FROM trading_rebalance_plans p
        JOIN trading_strategy_links l ON l.id = p.strategy_link_id
        JOIN trading_connections c ON c.id = l.connection_id
       WHERE c.user_id = ${args.userId}::uuid
       ORDER BY p.created_at DESC
       LIMIT 20;
    `,
    sql`
      SELECT e.event_type, e.severity, e.message, e.created_at::text AS created_at
        FROM trading_events e
        JOIN trading_connections c ON c.id = e.connection_id
       WHERE c.user_id = ${args.userId}::uuid
       ORDER BY e.created_at DESC
       LIMIT 20;
    `,
    sql`
      SELECT p.symbol, p.conid, p.quantity::float8 AS quantity,
             p.average_cost_usd::float8 AS average_cost_usd
        FROM trading_strategy_positions p
        JOIN trading_strategy_links l ON l.id = p.strategy_link_id
        JOIN trading_connections c ON c.id = l.connection_id
       WHERE c.user_id = ${args.userId}::uuid
       ORDER BY p.symbol;
    `,
    sql`
      SELECT o.id::text AS id, o.rebalance_plan_id::text AS plan_id, o.symbol, o.side,
             o.requested_quantity::float8 AS requested_quantity,
             o.filled_quantity::float8 AS filled_quantity,
             o.limit_price::float8 AS limit_price,
             o.average_fill_price::float8 AS average_fill_price,
             o.commission::float8 AS commission, o.commission_currency, o.status,
             o.updated_at::text AS updated_at
        FROM trading_orders o
        JOIN trading_rebalance_plans p ON p.id = o.rebalance_plan_id
        JOIN trading_strategy_links l ON l.id = p.strategy_link_id
        JOIN trading_connections c ON c.id = l.connection_id
       WHERE c.user_id = ${args.userId}::uuid
       ORDER BY o.updated_at DESC
       LIMIT 50;
    `,
    sql`
      SELECT f.exec_id, f.exec_revision AS correction_revision, f.symbol, f.side,
             f.quantity::float8 AS quantity, f.price::float8 AS price,
             f.commission::float8 AS commission, f.commission_currency,
             f.executed_at::text AS executed_at
        FROM (
          SELECT DISTINCT ON (source.connection_id, source.exec_family_id) source.*
            FROM trading_fills source
           ORDER BY source.connection_id, source.exec_family_id,
                    source.exec_revision DESC, source.updated_at DESC
        ) f
        JOIN trading_connections c ON c.id = f.connection_id
       WHERE c.user_id = ${args.userId}::uuid
       ORDER BY f.executed_at DESC
       LIMIT 50;
    `,
    listTradingPortfolios(args.workspace),
  ]);

  const connections = (connectionRows as Array<Record<string, unknown>>).map((row): TradingConnectionView => ({
    id: String(row.id),
    mode: row.mode as BrokerMode,
    account_masked: String(row.account_masked || ""),
    status: row.status as TradingConnectionView["status"],
    gateway_connected: Boolean(row.gateway_connected),
    gateway_authenticated: Boolean(row.gateway_authenticated),
    account_type: String(row.account_type || "UNKNOWN"),
    executor_version: String(row.executor_version || ""),
    last_heartbeat_at: row.last_heartbeat_at ? new Date(String(row.last_heartbeat_at)).toISOString() : null,
    last_error: String(row.last_error || ""),
    paired_at: row.paired_at ? new Date(String(row.paired_at)).toISOString() : null,
  }));
  const strategyRow = (strategyRows as Array<Record<string, unknown>>)[0];
  const strategy: TradingStrategyView | null = strategyRow ? {
    id: String(strategyRow.id),
    connection_id: String(strategyRow.connection_id),
    workspace: strategyRow.workspace as Workspace,
    lens_type: strategyRow.lens_type as TradingLensType,
    lens_key: String(strategyRow.lens_key),
    methodology_version: String(strategyRow.methodology_version),
    budget_usd: Number(strategyRow.budget_usd),
    cash_balance_usd: Number(strategyRow.cash_balance_usd),
    reserve_fraction: Number(strategyRow.reserve_fraction),
    status: strategyRow.status as TradingStrategyView["status"],
    latest_snapshot_id: strategyRow.latest_snapshot_id ? String(strategyRow.latest_snapshot_id) : null,
    last_error: String(strategyRow.last_error || ""),
    armed_at: strategyRow.armed_at ? new Date(String(strategyRow.armed_at)).toISOString() : null,
  } : null;
  const plans = (planRows as Array<Record<string, unknown>>).map((row): TradingPlanView => ({
    id: String(row.id),
    strategy_link_id: String(row.strategy_link_id),
    snapshot_id: String(row.snapshot_id),
    status: row.status as RebalanceStatus,
    target_holdings: asHoldings(row.target_holdings),
    preflight: (row.preflight || {}) as Record<string, unknown>,
    not_before: row.not_before ? new Date(String(row.not_before)).toISOString() : null,
    error: String(row.error || ""),
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  }));
  const events = (eventRows as Array<Record<string, unknown>>).map((row): TradingEventView => ({
    event_type: String(row.event_type),
    severity: row.severity as TradingEventView["severity"],
    message: String(row.message || ""),
    created_at: new Date(String(row.created_at)).toISOString(),
  }));
  const positions = (positionRows as Array<Record<string, unknown>>).map((row): TradingPositionView => ({
    symbol: String(row.symbol),
    conid: row.conid == null ? null : Number(row.conid),
    quantity: Number(row.quantity),
    average_cost_usd: row.average_cost_usd == null ? null : Number(row.average_cost_usd),
  }));
  const orders = (orderRows as Array<Record<string, unknown>>).map((row): TradingOrderView => ({
    id: String(row.id),
    plan_id: String(row.plan_id),
    symbol: String(row.symbol),
    side: row.side as "BUY" | "SELL",
    requested_quantity: Number(row.requested_quantity),
    filled_quantity: Number(row.filled_quantity),
    limit_price: row.limit_price == null ? null : Number(row.limit_price),
    average_fill_price: row.average_fill_price == null ? null : Number(row.average_fill_price),
    commission: Number(row.commission),
    commission_currency: String(row.commission_currency),
    status: String(row.status),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  }));
  const fills = (fillRows as Array<Record<string, unknown>>).map((row): TradingFillView => ({
    exec_id: String(row.exec_id),
    correction_revision: Number(row.correction_revision || 0),
    symbol: String(row.symbol),
    side: row.side as "BUY" | "SELL",
    quantity: Number(row.quantity),
    price: Number(row.price),
    commission: Number(row.commission),
    commission_currency: String(row.commission_currency),
    executed_at: new Date(String(row.executed_at)).toISOString(),
  }));
  return {
    enabled: args.enabled,
    live_enabled: args.liveEnabled,
    workspace: args.workspace,
    connections,
    strategy,
    portfolios,
    plans,
    events,
    positions,
    orders,
    fills,
  };
}

export async function configureTradingStrategy(args: {
  userId: string;
  connectionId: string;
  workspace: Workspace;
  lensType: TradingLensType;
  lensKey: string;
  methodologyVersion: string;
  budgetUsd: number;
  arm: boolean;
  expectedSnapshotId?: string;
}): Promise<{ linkId: string; status: TradingStrategyView["status"]; reason: string }> {
  const sql = requireSql();
  const connectionRows = (await sql`
    SELECT id::text AS id, mode, status
      FROM trading_connections
     WHERE id = ${args.connectionId}::uuid
       AND user_id = ${args.userId}::uuid
       AND status NOT IN ('awaiting_pairing', 'revoked')
     LIMIT 1;
  `) as Array<{ id: string; mode: BrokerMode; status: string }>;
  const connection = connectionRows[0];
  if (!connection) throw new Error("A paired connection owned by this user is required.");
  if (connection.mode === "live") throw new Error("Live strategy activation is locked until the Paper gate is complete.");

  const portfolios = await listTradingPortfolios(args.workspace);
  const selected = portfolios.find((portfolio) => (
    portfolio.lens_type === args.lensType
    && portfolio.lens_key === args.lensKey
    && portfolio.methodology_version === args.methodologyVersion
  ));
  if (!selected) throw new Error("The selected Paper portfolio is not available.");
  if (args.expectedSnapshotId && selected.latest_snapshot_id !== args.expectedSnapshotId) {
    throw new Error("The portfolio snapshot changed after preview. Review the new snapshot before confirming.");
  }

  let status: TradingStrategyView["status"] = "draft";
  let reason = "Saved as a draft.";
  if (args.arm) {
    if (!selected.eligible) {
      status = "blocked";
      reason = selected.eligibility_reasons.join(", ") || "Snapshot is not trade-eligible.";
    } else {
      status = "armed";
      reason = "Paper strategy armed.";
    }
  }
  const rows = (await sql`
    INSERT INTO trading_strategy_links (
      connection_id, workspace, lens_type, lens_key, methodology_version,
      budget_usd, cash_seed_usd, status, latest_snapshot_id, last_error, armed_at
    ) VALUES (
      ${args.connectionId}::uuid, ${args.workspace}, ${args.lensType}, ${args.lensKey},
      ${args.methodologyVersion}, ${args.budgetUsd}, ${args.budgetUsd}, ${status}, ${selected.latest_snapshot_id}::uuid,
      ${status === "blocked" ? reason : ""},
      CASE WHEN ${status} = 'armed' THEN now() ELSE NULL END
    )
    ON CONFLICT (connection_id) DO UPDATE SET
      workspace = EXCLUDED.workspace,
      lens_type = EXCLUDED.lens_type,
      lens_key = EXCLUDED.lens_key,
      methodology_version = EXCLUDED.methodology_version,
      cash_seed_usd = trading_strategy_links.cash_seed_usd
        + (EXCLUDED.budget_usd - trading_strategy_links.budget_usd),
      budget_usd = EXCLUDED.budget_usd,
      status = EXCLUDED.status,
      latest_snapshot_id = EXCLUDED.latest_snapshot_id,
      last_error = EXCLUDED.last_error,
      armed_at = EXCLUDED.armed_at,
      updated_at = now()
    RETURNING id::text AS id;
  `) as Array<{ id: string }>;
  const linkId = rows[0].id;
  await sql`
    UPDATE trading_rebalance_plans
       SET status = 'cancel_requested', updated_at = now()
     WHERE strategy_link_id = ${linkId}::uuid
       AND snapshot_id <> ${selected.latest_snapshot_id}::uuid
       AND status IN ('queued', 'preflight', 'awaiting_market', 'awaiting_settlement', 'partial');
  `;
  if (status === "armed") {
    await insertRebalancePlan({
      linkId,
      snapshotId: selected.latest_snapshot_id,
      holdings: selected.holdings,
      retryBlocked: true,
    });
  }
  await appendTradingAudit({
    userId: args.userId,
    connectionId: args.connectionId,
    actorType: "user",
    action: args.arm ? "strategy_arm_requested" : "strategy_draft_saved",
    payload: {
      workspace: args.workspace,
      lens_type: args.lensType,
      lens_key: args.lensKey,
      methodology_version: args.methodologyVersion,
      budget_usd: args.budgetUsd,
      resolved_status: status,
      reason,
    },
  });
  return { linkId, status, reason };
}

export async function createTradingStrategyPreview(args: {
  userId: string;
  connectionId: string;
  workspace: Workspace;
  lensType: TradingLensType;
  lensKey: string;
  methodologyVersion: string;
  budgetUsd: number;
  arm: boolean;
}): Promise<{ previewId: string; expiresAt: string; preview: Record<string, unknown> }> {
  const sql = requireSql();
  const connections = (await sql`
    SELECT id::text AS id, mode
      FROM trading_connections
     WHERE id = ${args.connectionId}::uuid
       AND user_id = ${args.userId}::uuid
       AND status NOT IN ('awaiting_pairing', 'revoked')
     LIMIT 1;
  `) as Array<{ id: string; mode: BrokerMode }>;
  if (!connections.length) throw new Error("A paired connection owned by this user is required.");
  if (connections[0].mode !== "paper") throw new Error("Live strategy activation is locked.");
  const portfolios = await listTradingPortfolios(args.workspace);
  const selected = portfolios.find((portfolio) => (
    portfolio.lens_type === args.lensType
    && portfolio.lens_key === args.lensKey
    && portfolio.methodology_version === args.methodologyVersion
  ));
  if (!selected) throw new Error("The selected Paper portfolio is not available.");
  const currentRows = (await sql`
    SELECT l.workspace, l.lens_type, l.lens_key, l.methodology_version,
           l.budget_usd::float8 AS budget_usd,
           COALESCE(jsonb_agg(p.symbol ORDER BY p.symbol) FILTER (WHERE p.symbol IS NOT NULL), '[]'::jsonb) AS symbols
      FROM trading_strategy_links l
      LEFT JOIN trading_strategy_positions p ON p.strategy_link_id = l.id AND p.quantity > 0
     WHERE l.connection_id = ${args.connectionId}::uuid
     GROUP BY l.id;
  `) as Array<Record<string, unknown>>;
  const current = currentRows[0] || null;
  const currentSymbols = new Set(asStringArray(current?.symbols));
  const targetSymbols = new Set(selected.holdings.map((holding) => holding.ticker));
  const preview = {
    current: current ? {
      portfolio_key: tradingPortfolioKey({
        workspace: current.workspace as Workspace,
        lensType: current.lens_type as TradingLensType,
        lensKey: String(current.lens_key),
        methodologyVersion: String(current.methodology_version),
      }),
      budget_usd: Number(current.budget_usd),
    } : null,
    target: {
      portfolio_key: selected.portfolio_key,
      label: selected.label,
      snapshot_id: selected.latest_snapshot_id,
      cutoff_at: selected.cutoff_at,
      execution_date: selected.execution_date,
      budget_usd: args.budgetUsd,
      investable_budget_usd: Math.round(args.budgetUsd * (1 - TRADING_RESERVE_FRACTION) * 100) / 100,
      holdings_count: selected.holdings_count,
      eligible: selected.eligible,
      eligibility_reasons: selected.eligibility_reasons,
    },
    estimated_changes: {
      additions: Array.from(targetSymbols).filter((symbol) => !currentSymbols.has(symbol)).sort(),
      removals: Array.from(currentSymbols).filter((symbol) => !targetSymbols.has(symbol)).sort(),
    },
    safeguards: [
      "Paper account only",
      "2% cash reserve",
      "Sells complete before buys",
      "No manual-position liquidation",
      "No empty-target liquidation",
    ],
  };
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const rows = (await sql`
    INSERT INTO trading_strategy_previews (
      user_id, connection_id, workspace, lens_type, lens_key, methodology_version,
      budget_usd, arm, snapshot_id, preview_payload, expires_at
    ) VALUES (
      ${args.userId}::uuid, ${args.connectionId}::uuid, ${args.workspace}, ${args.lensType},
      ${args.lensKey}, ${args.methodologyVersion}, ${args.budgetUsd}, ${args.arm},
      ${selected.latest_snapshot_id}::uuid, ${JSON.stringify(preview)}::jsonb, ${expiresAt}::timestamptz
    )
    RETURNING id::text AS id;
  `) as Array<{ id: string }>;
  await appendTradingAudit({
    userId: args.userId,
    connectionId: args.connectionId,
    actorType: "user",
    action: "strategy_preview_created",
    payload: { preview_id: rows[0].id, target: preview.target },
  });
  return { previewId: rows[0].id, expiresAt, preview };
}

export async function consumeTradingStrategyPreview(args: {
  userId: string;
  previewId: string;
}): Promise<{
  connectionId: string;
  workspace: Workspace;
  lensType: TradingLensType;
  lensKey: string;
  methodologyVersion: string;
  budgetUsd: number;
  arm: boolean;
  snapshotId: string;
} | null> {
  const sql = requireSql();
  const rows = (await sql`
    UPDATE trading_strategy_previews
       SET consumed_at = now()
     WHERE id = ${args.previewId}::uuid
       AND user_id = ${args.userId}::uuid
       AND consumed_at IS NULL
       AND expires_at > now()
    RETURNING connection_id::text AS connection_id, workspace, lens_type, lens_key,
              methodology_version, budget_usd::float8 AS budget_usd, arm,
              snapshot_id::text AS snapshot_id;
  `) as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return null;
  return {
    connectionId: String(row.connection_id),
    workspace: row.workspace as Workspace,
    lensType: row.lens_type as TradingLensType,
    lensKey: String(row.lens_key),
    methodologyVersion: String(row.methodology_version),
    budgetUsd: Number(row.budget_usd),
    arm: Boolean(row.arm),
    snapshotId: String(row.snapshot_id),
  };
}

async function insertRebalancePlan(args: {
  linkId: string;
  snapshotId: string;
  holdings: TradingHolding[];
  retryBlocked?: boolean;
}): Promise<void> {
  const sql = requireSql();
  await sql`
    INSERT INTO trading_rebalance_plans (strategy_link_id, snapshot_id, target_holdings, not_before)
    SELECT
      ${args.linkId}::uuid,
      ${args.snapshotId}::uuid,
      ${JSON.stringify(args.holdings)}::jsonb,
      GREATEST(
        (s.execution_date + time '10:00') AT TIME ZONE 'America/New_York',
        ((timezone('America/New_York', now())::date + 1) + time '10:00') AT TIME ZONE 'America/New_York'
      )
      FROM portfolio_snapshots s
     WHERE s.id = ${args.snapshotId}::uuid
    ON CONFLICT (strategy_link_id, snapshot_id) DO UPDATE SET
      status = 'queued',
      target_holdings = EXCLUDED.target_holdings,
      preflight = '{}'::jsonb,
      command_revision = trading_rebalance_plans.command_revision + 1,
      not_before = EXCLUDED.not_before,
      claimed_at = NULL,
      completed_at = NULL,
      error = '',
      updated_at = now()
    WHERE ${args.retryBlocked === true}
      AND trading_rebalance_plans.status = 'blocked';
  `;
}

export async function pauseTradingStrategy(args: {
  userId: string;
  connectionId: string;
  cancelOpenOrders: boolean;
}): Promise<void> {
  const sql = requireSql();
  const rows = (await sql`
    UPDATE trading_connections
       SET status = 'paused', updated_at = now()
     WHERE id = ${args.connectionId}::uuid
       AND user_id = ${args.userId}::uuid
       AND status <> 'revoked'
    RETURNING id::text AS id;
  `) as Array<{ id: string }>;
  if (!rows.length) throw new Error("Trading connection was not found.");
  await sql`
    UPDATE trading_strategy_links
       SET status = 'paused', updated_at = now()
     WHERE connection_id = ${args.connectionId}::uuid AND status <> 'revoked';
  `;
  if (args.cancelOpenOrders) {
    await sql`
      UPDATE trading_rebalance_plans p
         SET status = 'cancel_requested', updated_at = now()
        FROM trading_strategy_links l
       WHERE p.strategy_link_id = l.id
         AND l.connection_id = ${args.connectionId}::uuid
         AND p.status IN ('queued', 'preflight', 'awaiting_market', 'awaiting_settlement', 'selling', 'buying', 'partial');
    `;
  }
  await appendTradingAudit({
    userId: args.userId,
    connectionId: args.connectionId,
    actorType: "user",
    action: args.cancelOpenOrders ? "kill_switch" : "strategy_paused",
    payload: { cancel_open_orders: args.cancelOpenOrders },
  });
}

export async function resumeTradingStrategy(args: {
  userId: string;
  connectionId: string;
}): Promise<void> {
  const sql = requireSql();
  const rows = (await sql`
    UPDATE trading_connections
       SET status = CASE WHEN gateway_connected AND gateway_authenticated THEN 'ready' ELSE 'disconnected' END,
           updated_at = now()
     WHERE id = ${args.connectionId}::uuid
       AND user_id = ${args.userId}::uuid
       AND status = 'paused'
    RETURNING id::text AS id;
  `) as Array<{ id: string }>;
  if (!rows.length) throw new Error("Paused trading connection was not found.");
  await sql`
    UPDATE trading_strategy_links l
       SET status = CASE
             WHEN EXISTS (
               SELECT 1 FROM portfolio_snapshot_trade_eligibility e
                WHERE e.snapshot_id = l.latest_snapshot_id AND e.eligible
             ) THEN 'armed'
             ELSE 'blocked'
           END,
           last_error = CASE
             WHEN EXISTS (
               SELECT 1 FROM portfolio_snapshot_trade_eligibility e
                WHERE e.snapshot_id = l.latest_snapshot_id AND e.eligible
             ) THEN ''
             ELSE 'Latest snapshot is not trade-eligible.'
           END,
           updated_at = now()
     WHERE l.connection_id = ${args.connectionId}::uuid AND l.status = 'paused';
  `;
  await appendTradingAudit({
    userId: args.userId,
    connectionId: args.connectionId,
    actorType: "user",
    action: "strategy_resumed",
  });
}

export async function startPortfolioRefreshRun(args: {
  workspace: Workspace;
  track: PortfolioTrack;
  methodologyVersion: string;
}): Promise<string> {
  const sql = requireSql();
  const rows = (await sql`
    INSERT INTO portfolio_refresh_runs (workspace, track, methodology_version)
    VALUES (${args.workspace}, ${args.track}, ${args.methodologyVersion})
    RETURNING id::text AS id;
  `) as Array<{ id: string }>;
  return rows[0].id;
}

export async function finishPortfolioRefreshRun(args: {
  runId: string;
  status: "completed" | "partial" | "failed";
  warnings?: unknown[];
  error?: string;
}): Promise<void> {
  const sql = requireSql();
  await sql`
    UPDATE portfolio_refresh_runs
       SET status = ${args.status},
           provider_warnings = ${JSON.stringify(args.warnings || [])}::jsonb,
           error = ${args.error || ""},
           finished_at = now()
     WHERE id = ${args.runId}::uuid;
  `;
}

export async function recordSnapshotTradeEligibility(args: {
  snapshotIds: string[];
  refreshRunId: string;
  eligible: boolean;
  reasons: string[];
  allowUpgrade?: boolean;
}): Promise<void> {
  if (!args.snapshotIds.length) return;
  const sql = requireSql();
  for (const snapshotId of args.snapshotIds) {
    await sql`
      INSERT INTO portfolio_snapshot_trade_eligibility (
        snapshot_id, refresh_run_id, eligible, reasons, checked_at
      ) VALUES (
        ${snapshotId}::uuid, ${args.refreshRunId}::uuid, ${args.eligible},
        ${JSON.stringify(args.reasons)}::jsonb, now()
      )
      ON CONFLICT (snapshot_id) DO UPDATE SET
        refresh_run_id = EXCLUDED.refresh_run_id,
        eligible = EXCLUDED.eligible,
        reasons = EXCLUDED.reasons,
        checked_at = now()
      WHERE ${args.allowUpgrade === true}
        AND portfolio_snapshot_trade_eligibility.eligible = false
        AND EXCLUDED.eligible = true;
    `;
  }
}

export async function enqueueArmedStrategiesForSnapshots(snapshotIds: string[]): Promise<number> {
  if (!snapshotIds.length) return 0;
  const sql = requireSql();
  const rows = (await sql`
    SELECT l.id::text AS link_id,
           s.id::text AS snapshot_id,
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'rank', h.rank, 'ticker', h.ticker, 'score', h.score,
                 'weight', h.weight, 'currency', h.currency
               ) ORDER BY h.rank
             ) FILTER (WHERE h.snapshot_id IS NOT NULL),
             '[]'::jsonb
           ) AS holdings
      FROM trading_strategy_links l
      JOIN portfolio_snapshots s
        ON s.workspace = l.workspace
       AND s.lens_type = l.lens_type
       AND s.lens_key = l.lens_key
       AND s.methodology_version = l.methodology_version
      JOIN portfolio_snapshot_trade_eligibility e ON e.snapshot_id = s.id AND e.eligible
      LEFT JOIN portfolio_holdings h ON h.snapshot_id = s.id
     WHERE l.status = 'armed'
       AND s.id = ANY(${snapshotIds}::uuid[])
       AND s.track = 'paper'
       AND s.status = 'ready'
     GROUP BY l.id, s.id;
  `) as Array<{ link_id: string; snapshot_id: string; holdings: unknown }>;
  for (const row of rows) {
    await insertRebalancePlan({
      linkId: row.link_id,
      snapshotId: row.snapshot_id,
      holdings: asHoldings(row.holdings),
      retryBlocked: false,
    });
    await sql`
      UPDATE trading_strategy_links
         SET latest_snapshot_id = ${row.snapshot_id}::uuid, updated_at = now()
       WHERE id = ${row.link_id}::uuid;
    `;
  }
  return rows.length;
}

export async function loadExecutorCommands(
  connectionId: string,
  executorInstanceId: string,
): Promise<Array<Record<string, unknown>>> {
  const sql = requireSql();
  const rows = (await sql`
    SELECT p.id::text AS plan_id,
           p.snapshot_id::text AS snapshot_id,
           p.status,
           p.command_revision,
           p.target_holdings,
           p.not_before::text AS not_before,
           l.id::text AS strategy_link_id,
           l.workspace,
           l.lens_type,
           l.lens_key,
           l.budget_usd::float8 AS budget_usd,
           (
              l.cash_seed_usd + COALESCE((
                SELECT SUM(
                  CASE WHEN effective.side = 'SELL' THEN effective.quantity * effective.price
                       ELSE -(effective.quantity * effective.price) END
                  - effective.commission
                )
                  FROM (
                    SELECT DISTINCT ON (f.connection_id, f.exec_family_id) f.*
                      FROM trading_fills f
                     ORDER BY f.connection_id, f.exec_family_id, f.exec_revision DESC, f.updated_at DESC
                  ) effective
                  JOIN trading_orders owned_order ON owned_order.id = effective.order_id
                  JOIN trading_rebalance_plans owned_plan ON owned_plan.id = owned_order.rebalance_plan_id
                 WHERE owned_plan.strategy_link_id = l.id
              ), 0)
           )::float8 AS strategy_cash_usd,
           l.reserve_fraction::float8 AS reserve_fraction,
           c.mode,
           c.account_masked,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'client_order_key', o.client_order_key,
               'symbol', o.symbol,
               'side', o.side,
               'status', o.status,
               'requested_quantity', o.requested_quantity,
               'filled_quantity', o.filled_quantity,
               'ib_perm_id', o.ib_perm_id
             ) ORDER BY o.created_at)
               FROM trading_orders o
              WHERE o.rebalance_plan_id = p.id
           ), '[]'::jsonb) AS existing_orders,
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'symbol', pos.symbol,
                 'conid', pos.conid,
                 'quantity', pos.quantity,
                 'average_cost_usd', pos.average_cost_usd
               )
             ) FILTER (WHERE pos.symbol IS NOT NULL),
             '[]'::jsonb
           ) AS owned_positions
      FROM trading_rebalance_plans p
      JOIN trading_strategy_links l ON l.id = p.strategy_link_id
      JOIN trading_connections c ON c.id = l.connection_id
      JOIN portfolio_snapshot_trade_eligibility e ON e.snapshot_id = p.snapshot_id
      LEFT JOIN trading_strategy_positions pos ON pos.strategy_link_id = l.id
     WHERE c.id = ${connectionId}::uuid
        AND c.executor_lease_owner = ${executorInstanceId}
        AND c.executor_lease_expires_at > now()
       AND (
          (c.status = 'ready' AND e.eligible AND p.status IN ('queued', 'preflight', 'awaiting_market', 'awaiting_settlement', 'selling', 'buying', 'partial'))
         OR p.status = 'cancel_requested'
       )
       AND (p.not_before IS NULL OR p.not_before <= now())
     GROUP BY p.id, l.id, c.id
     ORDER BY p.created_at
     LIMIT 5;
  `) as Array<Record<string, unknown>>;
  const ids = rows.map((row) => String(row.plan_id));
  if (ids.length) {
    await sql`
      UPDATE trading_rebalance_plans
         SET claimed_at = COALESCE(claimed_at, now()), updated_at = now()
       WHERE id = ANY(${ids}::uuid[]);
    `;
  }
  return rows;
}

export async function loadExecutorCancellationIds(
  connectionId: string,
  executorInstanceId: string,
): Promise<string[]> {
  const sql = requireSql();
  const rows = (await sql`
    SELECT p.id::text AS id
      FROM trading_rebalance_plans p
      JOIN trading_strategy_links l ON l.id = p.strategy_link_id
      JOIN trading_connections c ON c.id = l.connection_id
     WHERE c.id = ${connectionId}::uuid
       AND c.executor_lease_owner = ${executorInstanceId}
       AND c.executor_lease_expires_at > now()
       AND p.status = 'cancel_requested';
  `) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export async function updateRebalanceStatus(args: {
  connectionId: string;
  planId: string;
  status: RebalanceStatus;
  error?: string;
  preflight?: Record<string, unknown>;
}): Promise<boolean> {
  const sql = requireSql();
  const rows = (await sql`
    UPDATE trading_rebalance_plans p
       SET status = ${args.status},
           command_revision = CASE
             WHEN ${args.status} = 'partial' AND p.status <> 'partial' THEN command_revision + 1
             ELSE command_revision
           END,
           not_before = CASE
             WHEN ${args.status} IN ('partial', 'awaiting_settlement', 'awaiting_market') AND p.status <> ${args.status}
               THEN (
                 timezone('America/New_York', now())::date
                 + CASE extract(isodow FROM timezone('America/New_York', now()))::int
                     WHEN 5 THEN 3
                     WHEN 6 THEN 2
                     ELSE 1
                   END
                 + time '10:00'
               ) AT TIME ZONE 'America/New_York'
             ELSE not_before
           END,
           error = ${args.error || ""},
           preflight = CASE
             WHEN ${JSON.stringify(args.preflight || {})}::jsonb = '{}'::jsonb THEN p.preflight
             ELSE ${JSON.stringify(args.preflight || {})}::jsonb
           END,
           completed_at = CASE WHEN ${args.status} IN ('completed', 'cancelled') THEN now() ELSE completed_at END,
           updated_at = now()
      FROM trading_strategy_links l
     WHERE p.id = ${args.planId}::uuid
       AND p.strategy_link_id = l.id
       AND l.connection_id = ${args.connectionId}::uuid
       AND (
         p.status = ${args.status}
         OR (p.status = 'queued' AND ${args.status} IN ('preflight', 'awaiting_market', 'blocked'))
         OR (p.status = 'awaiting_market' AND ${args.status} IN ('preflight', 'blocked'))
         OR (p.status = 'awaiting_settlement' AND ${args.status} IN ('awaiting_settlement', 'preflight', 'buying', 'blocked'))
         OR (p.status = 'preflight' AND ${args.status} IN ('awaiting_market', 'awaiting_settlement', 'selling', 'buying', 'completed', 'partial', 'blocked'))
         OR (p.status = 'selling' AND ${args.status} IN ('preflight', 'awaiting_market', 'awaiting_settlement', 'buying', 'completed', 'partial', 'blocked'))
         OR (p.status = 'buying' AND ${args.status} IN ('preflight', 'awaiting_market', 'completed', 'partial', 'blocked'))
         OR (p.status = 'partial' AND ${args.status} IN ('awaiting_market', 'preflight', 'selling', 'buying', 'completed', 'blocked'))
         OR (p.status = 'cancel_requested' AND ${args.status} = 'cancelled')
       )
    RETURNING p.id::text AS id;
  `) as Array<{ id: string }>;
  const updated = rows.length === 1;
  if (updated) {
    await appendTradingAudit({
      connectionId: args.connectionId,
      actorType: "executor",
      action: "rebalance_status_reported",
      payload: { plan_id: args.planId, status: args.status, error: args.error || "" },
    });
  }
  return updated;
}

export async function upsertTradingInstrument(args: {
  symbol: string;
  conid: number;
  secType: string;
  exchange: string;
  primaryExchange: string;
  currency: string;
  minTick?: number | null;
  minSize?: number | null;
  sizeIncrement?: number | null;
  supportsFractional: boolean;
  liquidHours?: string;
  timeZone?: string;
  approved: boolean;
}): Promise<void> {
  const sql = requireSql();
  await sql`
    INSERT INTO trading_instruments (
      symbol, conid, sec_type, exchange, primary_exchange, currency,
      min_tick, min_size, size_increment, supports_fractional,
      liquid_hours, time_zone, approved, approved_at
    ) VALUES (
      ${args.symbol.toUpperCase()}, ${args.conid}, ${args.secType}, ${args.exchange},
      ${args.primaryExchange}, ${args.currency.toUpperCase()}, ${args.minTick ?? null},
      ${args.minSize ?? null}, ${args.sizeIncrement ?? null}, ${args.supportsFractional},
      ${args.liquidHours || ""}, ${args.timeZone || ""}, ${args.approved},
      CASE WHEN ${args.approved} THEN now() ELSE NULL END
    )
    ON CONFLICT (symbol) DO UPDATE SET
      conid = EXCLUDED.conid,
      sec_type = EXCLUDED.sec_type,
      exchange = EXCLUDED.exchange,
      primary_exchange = EXCLUDED.primary_exchange,
      currency = EXCLUDED.currency,
      min_tick = EXCLUDED.min_tick,
      min_size = EXCLUDED.min_size,
      size_increment = EXCLUDED.size_increment,
      supports_fractional = EXCLUDED.supports_fractional,
      liquid_hours = EXCLUDED.liquid_hours,
      time_zone = EXCLUDED.time_zone,
      approved = EXCLUDED.approved,
      approved_at = CASE WHEN EXCLUDED.approved THEN COALESCE(trading_instruments.approved_at, now()) ELSE NULL END,
      updated_at = now();
  `;
}

export async function upsertTradingOrder(args: {
  connectionId: string;
  planId: string;
  clientOrderKey: string;
  symbol: string;
  conid?: number | null;
  side: "BUY" | "SELL";
  requestedQuantity: number;
  limitPrice?: number | null;
  ibOrderId?: number | null;
  ibPermId?: number | null;
  status: string;
  filledQuantity?: number;
  averageFillPrice?: number | null;
  commission?: number;
  commissionCurrency?: string;
  rawStatus?: Record<string, unknown>;
}): Promise<string | null> {
  const sql = requireSql();
  const rows = (await sql`
    INSERT INTO trading_orders (
      rebalance_plan_id, client_order_key, symbol, conid, side,
      requested_quantity, limit_price, ib_order_id, ib_perm_id,
      status, filled_quantity, average_fill_price, commission,
      commission_currency, raw_status, submitted_at, completed_at
    )
    SELECT ${args.planId}::uuid, ${args.clientOrderKey}, ${args.symbol.toUpperCase()},
           ${args.conid ?? null}, ${args.side}, ${args.requestedQuantity},
           ${args.limitPrice ?? null}, ${args.ibOrderId ?? null}, ${args.ibPermId ?? null},
           ${args.status}, ${args.filledQuantity || 0}, ${args.averageFillPrice ?? null},
           ${args.commission || 0}, ${args.commissionCurrency || "USD"},
           ${JSON.stringify(args.rawStatus || {})}::jsonb,
           CASE WHEN ${args.status} IN ('submitted', 'partially_filled', 'filled') THEN now() ELSE NULL END,
           CASE WHEN ${args.status} IN ('filled', 'cancelled', 'rejected', 'error') THEN now() ELSE NULL END
      FROM trading_rebalance_plans p
      JOIN trading_strategy_links l ON l.id = p.strategy_link_id
     WHERE p.id = ${args.planId}::uuid AND l.connection_id = ${args.connectionId}::uuid
    ON CONFLICT (client_order_key) DO UPDATE SET
      conid = COALESCE(EXCLUDED.conid, trading_orders.conid),
      limit_price = COALESCE(EXCLUDED.limit_price, trading_orders.limit_price),
      ib_order_id = COALESCE(EXCLUDED.ib_order_id, trading_orders.ib_order_id),
      ib_perm_id = COALESCE(EXCLUDED.ib_perm_id, trading_orders.ib_perm_id),
      status = EXCLUDED.status,
      filled_quantity = EXCLUDED.filled_quantity,
      average_fill_price = COALESCE(EXCLUDED.average_fill_price, trading_orders.average_fill_price),
      commission = EXCLUDED.commission,
      commission_currency = EXCLUDED.commission_currency,
      raw_status = EXCLUDED.raw_status,
      updated_at = now(),
      completed_at = CASE WHEN EXCLUDED.status IN ('filled', 'cancelled', 'rejected', 'error') THEN now() ELSE trading_orders.completed_at END
    WHERE trading_orders.rebalance_plan_id = EXCLUDED.rebalance_plan_id
    RETURNING id::text AS id;
  `) as Array<{ id: string }>;
  const orderId = rows[0]?.id || null;
  if (orderId) {
    await appendTradingAudit({
      connectionId: args.connectionId,
      actorType: "executor",
      action: "order_reported",
      payload: {
        order_id: orderId,
        plan_id: args.planId,
        client_order_key: args.clientOrderKey,
        symbol: args.symbol,
        side: args.side,
        status: args.status,
      },
    });
  }
  return orderId;
}

export async function insertTradingFill(args: {
  connectionId: string;
  orderId?: string | null;
  clientOrderKey?: string | null;
  execId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  commission?: number;
  commissionCurrency?: string;
  executedAt: string;
  rawExecution?: Record<string, unknown>;
}): Promise<boolean> {
  const sql = requireSql();
  const identity = tradingExecutionIdentity(args.execId);
  const rows = (await sql`
    WITH resolved_order AS (
      SELECT owned_order.id
        FROM trading_orders owned_order
        JOIN trading_rebalance_plans owned_plan ON owned_plan.id = owned_order.rebalance_plan_id
        JOIN trading_strategy_links owned_link ON owned_link.id = owned_plan.strategy_link_id
       WHERE owned_link.connection_id = ${args.connectionId}::uuid
         AND (
           (${args.orderId || null}::uuid IS NOT NULL AND owned_order.id = ${args.orderId || null}::uuid)
           OR (
             ${args.orderId || null}::uuid IS NULL
             AND ${args.clientOrderKey || ""} <> ''
             AND owned_order.client_order_key = ${args.clientOrderKey || ""}
           )
         )
       LIMIT 1
    )
    INSERT INTO trading_fills (
      order_id, connection_id, exec_id, exec_family_id, exec_revision, symbol, side, quantity, price,
      commission, commission_currency, executed_at, raw_execution
    )
    SELECT resolved_order.id,
           ${args.connectionId}::uuid, ${args.execId}, ${identity.familyId}, ${identity.revision},
           ${args.symbol.toUpperCase()}, ${args.side}, ${args.quantity}, ${args.price},
           ${args.commission || 0}, ${args.commissionCurrency || "USD"},
           ${args.executedAt}::timestamptz, ${JSON.stringify(args.rawExecution || {})}::jsonb
      FROM resolved_order
    ON CONFLICT (exec_id) DO UPDATE SET
      order_id = COALESCE(EXCLUDED.order_id, trading_fills.order_id),
      commission = EXCLUDED.commission,
      commission_currency = EXCLUDED.commission_currency,
      raw_execution = trading_fills.raw_execution || EXCLUDED.raw_execution,
      updated_at = now()
    WHERE trading_fills.connection_id = EXCLUDED.connection_id
    RETURNING id::text AS id, (xmax = 0) AS inserted;
  `) as Array<{ id: string; inserted: boolean }>;
  const accepted = rows.length === 1;
  const inserted = rows[0]?.inserted === true;
  if (accepted) {
    const linkRows = (await sql`
      SELECT l.id::text AS id
        FROM trading_fills f
        JOIN trading_orders o ON o.id = f.order_id
        JOIN trading_rebalance_plans p ON p.id = o.rebalance_plan_id
        JOIN trading_strategy_links l ON l.id = p.strategy_link_id
       WHERE f.connection_id = ${args.connectionId}::uuid
         AND f.exec_id = ${args.execId}
         AND l.connection_id = ${args.connectionId}::uuid
       LIMIT 1;
    `) as Array<{ id: string }>;
    const linkId = linkRows[0]?.id;
    if (linkId) {
      await sql.transaction((tx) => [
        tx`DELETE FROM trading_strategy_positions WHERE strategy_link_id = ${linkId}::uuid;`,
        tx`
          INSERT INTO trading_strategy_positions (strategy_link_id, symbol, quantity)
          SELECT ${linkId}::uuid, effective.symbol,
                 SUM(CASE WHEN effective.side = 'BUY' THEN effective.quantity ELSE -effective.quantity END) AS quantity
            FROM (
              SELECT DISTINCT ON (source.connection_id, source.exec_family_id) source.*
                FROM trading_fills source
               ORDER BY source.connection_id, source.exec_family_id,
                        source.exec_revision DESC, source.updated_at DESC
            ) effective
            JOIN trading_orders o ON o.id = effective.order_id
            JOIN trading_rebalance_plans p ON p.id = o.rebalance_plan_id
           WHERE p.strategy_link_id = ${linkId}::uuid
           GROUP BY effective.symbol
          HAVING SUM(CASE WHEN effective.side = 'BUY' THEN effective.quantity ELSE -effective.quantity END) > 0;
        `,
      ]);
    }
  }
  if (inserted) {
    await appendTradingAudit({
      connectionId: args.connectionId,
      actorType: "executor",
      action: "fill_reported",
      payload: {
        order_id: args.orderId || null,
        client_order_key: args.clientOrderKey || null,
        exec_id: args.execId,
        symbol: args.symbol,
        side: args.side,
        quantity: args.quantity,
        price: args.price,
      },
    });
  }
  return accepted;
}

export async function recordTradingEvent(args: {
  connectionId: string;
  eventId: string;
  eventType: string;
  severity: "info" | "warning" | "critical";
  message: string;
  payload?: Record<string, unknown>;
}): Promise<boolean> {
  const sql = requireSql();
  const rows = (await sql`
    INSERT INTO trading_events (
      connection_id, event_id, event_type, severity, message, payload
    ) VALUES (
      ${args.connectionId}::uuid, ${args.eventId}, ${args.eventType}, ${args.severity},
      ${args.message}, ${JSON.stringify(args.payload || {})}::jsonb
    )
    ON CONFLICT (connection_id, event_id) DO NOTHING
    RETURNING id::text AS id;
  `) as Array<{ id: string }>;
  return rows.length === 1;
}

export async function markTradingEventTelegramSent(connectionId: string, eventId: string): Promise<void> {
  const sql = requireSql();
  await sql`
    UPDATE trading_events
       SET telegram_sent_at = now()
     WHERE connection_id = ${connectionId}::uuid AND event_id = ${eventId};
  `;
}

export async function listStaleTradingConnections(staleMinutes = 10): Promise<Array<{
  id: string;
  accountMasked: string;
  mode: BrokerMode;
  lastHeartbeatAt: string | null;
}>> {
  const sql = requireSql();
  const interval = `${Math.max(1, Math.min(1440, Math.floor(staleMinutes)))} minutes`;
  const rows = (await sql`
    SELECT id::text AS id, account_masked, mode, last_heartbeat_at::text AS last_heartbeat_at
      FROM trading_connections
     WHERE status NOT IN ('awaiting_pairing', 'paused', 'revoked')
       AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - ${interval}::interval);
  `) as Array<{ id: string; account_masked: string; mode: BrokerMode; last_heartbeat_at: string | null }>;
  return rows.map((row) => ({
    id: row.id,
    accountMasked: row.account_masked,
    mode: row.mode,
    lastHeartbeatAt: row.last_heartbeat_at,
  }));
}

export async function listPendingTradingAlerts(limit = 50): Promise<Array<{
  connectionId: string;
  eventId: string;
  severity: "warning" | "critical";
  message: string;
}>> {
  const sql = requireSql();
  const rows = (await sql`
    SELECT connection_id::text AS connection_id, event_id, severity, message
      FROM trading_events
     WHERE severity IN ('warning', 'critical')
       AND telegram_sent_at IS NULL
     ORDER BY created_at
     LIMIT ${Math.max(1, Math.min(200, Math.floor(limit)))};
  `) as Array<{
    connection_id: string;
    event_id: string;
    severity: "warning" | "critical";
    message: string;
  }>;
  return rows.map((row) => ({
    connectionId: row.connection_id,
    eventId: row.event_id,
    severity: row.severity,
    message: row.message,
  }));
}

export async function appendTradingAudit(args: {
  userId?: string | null;
  connectionId?: string | null;
  actorType: "user" | "executor" | "monitor" | "system";
  action: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const sql = requireSql();
  await sql`
    INSERT INTO trading_audit_log (user_id, connection_id, actor_type, action, payload)
    VALUES (
      ${args.userId || null}::uuid,
      ${args.connectionId || null}::uuid,
      ${args.actorType},
      ${args.action},
      ${JSON.stringify(args.payload || {})}::jsonb
    );
  `;
}
