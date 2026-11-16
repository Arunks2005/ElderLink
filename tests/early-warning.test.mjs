// Tests for the Early Warning engine. Run with:  npm run test:early-warning
// Uses Node's built-in test runner and native TypeScript type-stripping
// (Node 22.18+ / 24), so no extra test dependencies are needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runEarlyWarning, toBehaviorAlertRows } from "../src/lib/early-warning/engine.ts";
import { buildDemoCohort } from "../src/lib/early-warning/demo-cohort.ts";

const NOW = new Date("2026-11-16T15:00:00");

function byName(report, first) {
  return report.residents.find((r) => r.firstName === first);
}

test("simulated cohort: each scripted scenario is detected", () => {
  const report = runEarlyWarning({ ...buildDemoCohort(NOW), now: NOW });

  const kamala = byName(report, "Kamala");
  assert.equal(kamala.status, "act");
  assert.ok(kamala.patterns.some((p) => p.id === "hydration_confusion"));

  const ramesh = byName(report, "Ramesh");
  assert.ok(ramesh.patterns.some((p) => p.id === "withdrawal"));
  assert.equal(ramesh.connection.status, "gap");
  assert.ok(ramesh.connection.lonelinessRisk);

  const joseph = byName(report, "Joseph");
  assert.ok(joseph.patterns.some((p) => p.id === "medication_refusal"));

  const harbans = byName(report, "Harbans");
  assert.ok(harbans.patterns.some((p) => p.id === "pain"));

  const lakshmi = byName(report, "Lakshmi");
  assert.equal(lakshmi.attention.underObserved, true);
  assert.equal(lakshmi.connection.status, "none");
  assert.equal(lakshmi.status, "watch");
});

test("simulated cohort: a stable resident with normal noise is NOT flagged", () => {
  const report = runEarlyWarning({ ...buildDemoCohort(NOW), now: NOW });
  const fatima = byName(report, "Fatima");
  assert.equal(fatima.status, "stable");
  assert.equal(fatima.flaggedSignals.length, 0);
  assert.equal(fatima.patterns.length, 0);
});

test("care-rounds order puts the most urgent residents first", () => {
  const report = runEarlyWarning({ ...buildDemoCohort(NOW), now: NOW });
  const order = report.residents.map((r) => r.firstName);
  assert.equal(order[0], "Kamala");
  assert.equal(order[order.length - 1], "Fatima");
});

test("residents with too little history stay in 'building baseline'", () => {
  const logs = [0, 1, 2].map((ago) => ({
    resident_id: "new",
    created_at: new Date(NOW.getTime() - ago * 86_400_000).toISOString(),
    meals: "Refused",
    fluids: "None",
    mood: "Confused",
    medication: "Refused",
    entry_source: "manual",
  }));
  const report = runEarlyWarning({
    residents: [{ id: "new", full_name: "New Resident" }],
    logs,
    now: NOW,
  });
  assert.equal(report.residents[0].status, "baseline");
  assert.equal(report.residents[0].driftIndex, 0);
});

test("simulated sensor/demo entries are excluded by default", () => {
  const cohort = buildDemoCohort(NOW);
  const tagged = cohort.logs.map((l) => ({ ...l, entry_source: "sensor" }));
  const report = runEarlyWarning({ ...cohort, logs: tagged, now: NOW });
  assert.equal(report.totals.logsUsed, 0);
  assert.equal(report.totals.logsExcluded, tagged.length);
  assert.ok(report.residents.every((r) => r.status === "baseline"));
});

test("behaviour-alert rows match the existing behavior_alerts columns", () => {
  const report = runEarlyWarning({ ...buildDemoCohort(NOW), now: NOW });
  const rows = toBehaviorAlertRows(byName(report, "Kamala"));
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [
      "baseline_mean", "message", "metric", "recent_mean", "resident_id",
      "resident_name", "resolved", "room", "severity", "z_score",
    ]);
    assert.ok(["mild", "moderate", "severe"].includes(row.severity));
  }
});

// False-alarm check: 300 simulated residents with NO change at all.
// An early-warning tool that cries wolf gets ignored by busy staff, so we
// measure how often a perfectly stable resident is flagged.
test("false-alarm rate on stable simulated residents is low", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (probs) => {
    const r = rand();
    let acc = 0;
    for (const [k, p] of Object.entries(probs)) if (r <= (acc += p)) return k;
    return Object.keys(probs)[0];
  };
  const residents = [];
  const logs = [];
  for (let i = 0; i < 300; i++) {
    const id = `s${i}`;
    residents.push({ id, full_name: `Stable ${i}` });
    for (let ago = 27; ago >= 0; ago--) {
      for (let k = 0; k < 4; k++) {
        const ts = new Date(NOW);
        ts.setDate(ts.getDate() - ago);
        ts.setHours(8 + k * 3, 0, 0, 0);
        logs.push({
          resident_id: id,
          created_at: ts.toISOString(),
          meals: pick({ "Ate Fully": 0.72, Partially: 0.24, Refused: 0.04 }),
          fluids: pick({ Good: 0.82, Low: 0.16, None: 0.02 }),
          mood: pick({ Happy: 0.4, Calm: 0.5, Agitated: 0.07, Confused: 0.03 }),
          medication: pick({ Given: 0.96, Refused: 0.03, Missed: 0.01 }),
          temperature: k === 0 ? 97.8 + (rand() - 0.5) * 0.8 : null,
          heart_rate: k === 0 ? Math.round(74 + (rand() - 0.5) * 10) : null,
          entry_source: "manual",
        });
      }
    }
  }
  const report = runEarlyWarning({ residents, logs, now: NOW });
  const flagged = report.residents.filter((r) => r.status === "act").length;
  const rate = flagged / residents.length;
  console.log(`  stable residents flagged 'act today': ${flagged}/300 (${(rate * 100).toFixed(1)}%)`);
  assert.ok(rate < 0.05, `false 'act today' rate too high: ${rate}`);
});

// ---------------------------------------------------------------------------
// daily_aggregates builder
// ---------------------------------------------------------------------------
import { buildDailyAggregates } from "../src/lib/early-warning/aggregates.ts";
import { dateKey, daysAgo } from "../src/lib/early-warning/engine.ts";

test("daily aggregates use the Behaviour Alerts scales (0–10 and 0–100)", () => {
  const cohort = buildDemoCohort(NOW);
  const rows = buildDailyAggregates({ residents: cohort.residents, logs: cohort.logs });
  assert.ok(rows.length > 100);
  for (const r of rows) {
    for (const k of ["meal_score", "fluid_score", "mood_score"]) {
      if (r[k] !== null) assert.ok(r[k] >= 0 && r[k] <= 10, `${k}=${r[k]}`);
    }
    if (r.medication_adherence !== null) assert.ok(r.medication_adherence >= 0 && r.medication_adherence <= 100);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
  }
  // one row per resident per day
  const keys = new Set(rows.map((r) => `${r.resident_id}|${r.date}`));
  assert.equal(keys.size, rows.length);
});

test("daily aggregates skip simulated entries and never emit sensor columns", () => {
  const logs = [
    { resident_id: "a", created_at: "2026-11-10T09:00:00Z", meals: "Refused", fluids: "None", mood: "Confused", medication: "Missed", entry_source: "sensor" },
    { resident_id: "a", created_at: "2026-11-10T10:00:00Z", meals: "Ate Fully", fluids: "Good", mood: "Happy", medication: "Given", entry_source: "manual" },
  ];
  const rows = buildDailyAggregates({ residents: [{ id: "a", full_name: "A" }], logs, timeZone: "Asia/Kolkata" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].meal_score, 10);
  assert.equal(rows[0].medication_adherence, 100);
  for (const k of ["sleep_hours", "washroom_visits", "sleep_disturbed", "activity_detail"]) assert.ok(!(k in rows[0]));
});

test("calendar days follow the care home's time zone, not the server's", () => {
  // 20:00 UTC on the 15th is 01:30 on the 16th in India.
  assert.equal(dateKey("2026-11-15T20:00:00Z", "Asia/Kolkata"), "2026-11-16");
  assert.equal(dateKey("2026-11-15T20:00:00Z", "UTC"), "2026-11-15");
  const now = new Date("2026-11-16T06:00:00Z");
  assert.equal(daysAgo("2026-11-15T20:00:00Z", now, "Asia/Kolkata"), 0);
  assert.equal(daysAgo("2026-11-15T20:00:00Z", now, "UTC"), 1);
});
