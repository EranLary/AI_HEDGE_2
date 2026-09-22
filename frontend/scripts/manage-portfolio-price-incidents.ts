import { spawn } from "node:child_process";
import process from "node:process";

import { getSql } from "../src/lib/db";

type Incident = {
  id: string;
  workspace: "analysis" | "nasdaq100";
  symbol: string;
  currency: string;
  status: "monitoring" | "quarantined" | "resolved" | "ignored";
  first_missing_on: string;
  last_missing_on: string;
  last_observed_on: string;
  missing_streak: number;
  recovery_streak: number;
  affected_tracks: string[];
  affected_methodologies: string[];
  resolution_kind: string | null;
  resolution_effective_on: string | null;
  resolution_note: string | null;
  updated_at: string;
};

const args = process.argv.slice(2);
const command = args[0] || "list";
const valueFor = (name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
};
const has = (name: string): boolean => args.includes(name);
const incidentId = !args[1]?.startsWith("--") ? args[1] : null;
const sql = getSql();

if (!sql) throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required.");

function assertDate(value: string | null, name: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

function actor(): string {
  return process.env.PORTFOLIO_INCIDENT_ACTOR
    || process.env.USERNAME
    || process.env.USER
    || "admin-cli";
}

async function loadIncident(id: string): Promise<Incident> {
  const rows = (await sql!`
    SELECT id::text AS id, workspace, symbol, currency, status,
           first_missing_on::text AS first_missing_on,
           last_missing_on::text AS last_missing_on,
           last_observed_on::text AS last_observed_on,
           missing_streak, recovery_streak, affected_tracks, affected_methodologies,
           resolution_kind, resolution_effective_on::text AS resolution_effective_on,
           resolution_note, updated_at::text AS updated_at
      FROM portfolio_price_incidents
     WHERE id = ${id}::uuid
     LIMIT 1;
  `) as Incident[];
  if (!rows[0]) throw new Error(`Portfolio price incident ${id} was not found.`);
  return rows[0];
}

function printIncident(incident: Incident): void {
  console.log([
    `${incident.id}  ${incident.workspace}/${incident.symbol}  ${incident.status}`,
    `  missing: ${incident.first_missing_on} -> ${incident.last_missing_on}`,
    `  observations: missing=${incident.missing_streak}, recovery=${incident.recovery_streak}`,
    `  affected: ${(incident.affected_tracks || []).join(", ") || "-"} / ${(incident.affected_methodologies || []).join(", ") || "-"}`,
    incident.resolution_kind
      ? `  resolution: ${incident.resolution_kind} on ${incident.resolution_effective_on || "-"} (${incident.resolution_note || "no note"})`
      : null,
  ].filter(Boolean).join("\n"));
}

async function listIncidents(): Promise<void> {
  const workspace = valueFor("--workspace");
  const status = valueFor("--status") || "open";
  const rows = (await sql!`
    SELECT id::text AS id, workspace, symbol, currency, status,
           first_missing_on::text AS first_missing_on,
           last_missing_on::text AS last_missing_on,
           last_observed_on::text AS last_observed_on,
           missing_streak, recovery_streak, affected_tracks, affected_methodologies,
           resolution_kind, resolution_effective_on::text AS resolution_effective_on,
           resolution_note, updated_at::text AS updated_at
      FROM portfolio_price_incidents
     WHERE (${workspace}::text IS NULL OR workspace = ${workspace})
       AND (
         ${status} = 'all'
         OR (${status} = 'open' AND status IN ('monitoring', 'quarantined'))
         OR status = ${status}
       )
     ORDER BY CASE status WHEN 'quarantined' THEN 0 WHEN 'monitoring' THEN 1 ELSE 2 END,
              first_missing_on, symbol;
  `) as Incident[];
  if (has("--json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (!rows.length) {
    console.log("No matching portfolio price incidents.");
    return;
  }
  rows.forEach((row, index) => {
    if (index) console.log("");
    printIncident(row);
  });
}

async function showIncident(id: string): Promise<void> {
  printIncident(await loadIncident(id));
  const events = await sql!`
    SELECT event_type, effective_on::text AS effective_on, actor, details,
           created_at::text AS created_at
      FROM portfolio_price_incident_events
     WHERE incident_id = ${id}::uuid
     ORDER BY effective_on, id;
  `;
  console.log("\nEvents:");
  console.log(JSON.stringify(events, null, 2));
}

async function writeEvent(
  id: string,
  eventType: string,
  effectiveOn: string,
  details: Record<string, unknown>,
): Promise<void> {
  await sql!`
    INSERT INTO portfolio_price_incident_events (
      incident_id, event_type, effective_on, actor, details
    ) VALUES (
      ${id}::uuid, ${eventType}, ${effectiveOn}::date, ${actor()},
      ${JSON.stringify(details)}::jsonb
    );
  `;
}

async function resolveIncident(id: string): Promise<Incident> {
  const existing = await loadIncident(id);
  const kind = valueFor("--kind");
  const effectiveOn = assertDate(valueFor("--effective-on"), "--effective-on");
  const note = valueFor("--note");
  if (effectiveOn < existing.first_missing_on) {
    throw new Error(`--effective-on cannot predate the first warning (${existing.first_missing_on}).`);
  }
  const allowedKinds = new Set([
    "provider_recovered",
    "verified_corporate_action",
    "verified_liquidation",
    "provider_override",
    "irrelevant",
  ]);
  if (!kind || !allowedKinds.has(kind)) {
    throw new Error(`--kind must be one of: ${Array.from(allowedKinds).join(", ")}.`);
  }
  if (!note) throw new Error("--note is required so the decision remains auditable.");
  const nextStatus = kind === "irrelevant" ? "ignored" : "resolved";
  console.log(
    `${has("--apply") ? "Applying" : "Would apply"}: ${existing.symbol} ${existing.status} -> ${nextStatus}; `
    + `repair window ${existing.first_missing_on} -> ${effectiveOn}.`,
  );
  if (!has("--apply")) {
    return {
      ...existing,
      status: nextStatus,
      resolution_kind: kind,
      resolution_effective_on: effectiveOn,
      resolution_note: note,
    };
  }
  await sql!`
    UPDATE portfolio_price_incidents
       SET status = ${nextStatus}, resolved_at = now(), resolution_kind = ${kind},
           resolution_effective_on = ${effectiveOn}::date, resolution_note = ${note},
           updated_at = now()
     WHERE id = ${id}::uuid;
  `;
  await writeEvent(id, nextStatus === "ignored" ? "admin_ignored" : "admin_resolved", effectiveOn, {
    kind,
    note,
    repair_from: existing.first_missing_on,
  });
  return loadIncident(id);
}

async function reopenIncident(id: string): Promise<void> {
  const existing = await loadIncident(id);
  const effectiveOn = assertDate(valueFor("--effective-on"), "--effective-on");
  const note = valueFor("--note");
  if (!note) throw new Error("--note is required so the decision remains auditable.");
  console.log(`${has("--apply") ? "Applying" : "Would apply"}: reopen ${existing.symbol} on ${effectiveOn}.`);
  if (!has("--apply")) return;
  await sql!`
    UPDATE portfolio_price_incidents
       SET status = 'monitoring', first_missing_on = ${effectiveOn}::date,
           last_missing_on = ${effectiveOn}::date, last_observed_on = ${effectiveOn}::date,
           last_observation_missing = true, missing_streak = 1, recovery_streak = 0,
           quarantined_on = NULL, quarantined_at = NULL, resolved_at = NULL,
           resolution_kind = NULL, resolution_effective_on = NULL,
           resolution_note = NULL, updated_at = now()
     WHERE id = ${id}::uuid;
  `;
  await writeEvent(id, "admin_reopened", effectiveOn, { note });
}

function runRefresh(incident: Incident, track: string, methodology: string, through: string): Promise<void> {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const refreshArgs = [
    "run",
    "portfolio:refresh",
    "--",
    "--workspace",
    incident.workspace,
    "--track",
    track,
    "--methodology",
    methodology,
    "--through",
    through,
  ];
  console.log(`Running: ${npm} ${refreshArgs.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(npm, refreshArgs, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Portfolio refresh exited with code ${code}.`));
    });
  });
}

async function replayIncident(id: string, resolved?: Incident): Promise<void> {
  const incident = resolved || await loadIncident(id);
  if (incident.status !== "resolved" && incident.status !== "ignored") {
    throw new Error("Resolve or ignore the incident before replaying derived performance.");
  }
  const through = assertDate(
    valueFor("--through") || incident.resolution_effective_on || new Date().toISOString().slice(0, 10),
    "--through",
  );
  if (through < incident.first_missing_on) {
    throw new Error(`--through cannot predate the first warning (${incident.first_missing_on}).`);
  }
  console.log(
    `${has("--apply") ? "Replaying" : "Would replay"} derived NAV for ${incident.symbol}, `
    + `repair window ${incident.first_missing_on} -> ${through}. Paper snapshots and holdings stay unchanged.`,
  );
  const tasks = (incident.affected_tracks || []).flatMap((track) => (
    (incident.affected_methodologies || []).map((methodology) => ({ track, methodology }))
  ));
  if (!tasks.length) throw new Error("The incident has no affected track/methodology metadata.");
  if (!has("--apply")) {
    tasks.forEach(({ track, methodology }) => console.log(`  ${incident.workspace}/${track}/${methodology}`));
    return;
  }
  try {
    for (const task of tasks) await runRefresh(incident, task.track, task.methodology, through);
    await writeEvent(id, "nav_replay_completed", through, {
      repair_from: incident.first_missing_on,
      tasks,
    });
  } catch (error) {
    await writeEvent(id, "nav_replay_failed", through, {
      repair_from: incident.first_missing_on,
      error: error instanceof Error ? error.message : String(error),
      tasks,
    });
    throw error;
  }
}

async function main(): Promise<void> {
  if (command === "list") return listIncidents();
  if (!incidentId) throw new Error(`${command} requires an incident UUID.`);
  if (command === "show") return showIncident(incidentId);
  if (command === "reopen") return reopenIncident(incidentId);
  if (command === "replay") return replayIncident(incidentId);
  if (command === "resolve") {
    const resolved = await resolveIncident(incidentId);
    if (has("--replay")) await replayIncident(incidentId, resolved);
    return;
  }
  throw new Error("Command must be list, show, resolve, reopen, or replay.");
}

main().catch((error) => {
  console.error(`[portfolio-incidents] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
