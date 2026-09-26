"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  X,
  Search,
  CheckCircle2,
  ShieldCheck,
  Loader2,
  Utensils,
  Smile,
  Activity as ActivityIcon,
  Droplets,
  Bath,
  Moon,
  Thermometer,
  HeartPulse,
  Pill,
  Gauge,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { createClient } from "../../../lib/supabase/client";

// ---------- types ----------
// Current daily_aggregates behavioral and care-score fields.
// The old activity_score / washroom_score / sleep_score columns were removed
// from the database, so they must not be selected or rendered here.
type DailyAggregate = {
  resident_id: string;
  resident_name: string;
  room: string | null;
  date: string;
  day_index: number;
  meal_score: number | null;
  fluid_score: number | null;
  mood_score: number | null;
  medication_adherence: number | null;
  avg_pain_scale: number | null;
  washroom_visits: number | null;
  sleep_hours: number | null;
  sleep_disturbed: boolean | null;
  activity_detail: string | null;
  avg_temperature: number | null;
  avg_heart_rate: number | null;
  avg_systolic: number | null;
};

type BehaviorAlert = {
  id: string;
  resident_id: string | null;
  resident_name: string;
  room: string | null;
  metric: string;
  baseline_mean: number | null;
  recent_mean: number | null;
  z_score: number | null;
  severity: string | null;
  message: string;
  resolved: boolean;
  created_at: string;
};

type ResidentGroup = {
  resident_id: string;
  resident_name: string;
  room: string | null;
  days: DailyAggregate[]; // ascending by date
};

const LOOKBACK_DAYS = 14;

// ---------- helpers ----------
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// The current `daily_aggregates` data uses two score scales:
//   - meal_score, fluid_score, mood_score: 0–10
//   - medication_adherence: 0–100
// Normalize them only for the progress-bar width while displaying the
// original database value in a human-readable format. This prevents values
// such as 9 from becoming 900%.
type ScoreMetric =
  | "meal_score"
  | "fluid_score"
  | "mood_score"
  | "medication_adherence";

function scorePercent(
  score: number | null,
  metric: ScoreMetric,
): number | null {
  if (score == null || Number.isNaN(score)) return null;

  const percent =
    metric === "medication_adherence"
      ? score
      : (score / 10) * 100;

  return Math.max(0, Math.min(100, Math.round(percent)));
}

function scoreDisplay(
  score: number | null,
  metric: ScoreMetric,
): string {
  if (score == null || Number.isNaN(score)) return "—";

  if (metric === "medication_adherence") {
    return `${Math.round(score)}%`;
  }

  return `${Number(score).toFixed(1).replace(/\.0$/, "")}/10`;
}

function scoreColor(
  score: number | null,
  metric: ScoreMetric,
): string {
  const percent = scorePercent(score, metric);
  if (percent == null) return "bg-gray-200";
  if (percent >= 70) return "bg-emerald-500";
  if (percent >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function scoreTextColor(
  score: number | null,
  metric: ScoreMetric,
): string {
  const percent = scorePercent(score, metric);
  if (percent == null) return "text-gray-400";
  if (percent >= 70) return "text-emerald-700";
  if (percent >= 40) return "text-amber-700";
  return "text-red-700";
}

function formatMetric(metric: string) {
  const words = metric.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const SEVERITY_STYLES: Record<string, string> = {
  severe: "bg-red-50 text-red-700 border-red-200",
  moderate: "bg-amber-50 text-amber-700 border-amber-200",
  mild: "bg-yellow-50 text-yellow-700 border-yellow-200",
};

// ---------- small presentational pieces ----------
function ScoreBar({
  label,
  icon,
  score,
  metric,
}: {
  label: string;
  icon: React.ReactNode;
  score: number | null;
  metric: ScoreMetric;
}) {
  const p = scorePercent(score, metric);
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-6 text-gray-400 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-bold text-gray-500">{label}</span>
          <span
            className={`text-[11px] font-bold ${scoreTextColor(score, metric)}`}
          >
            {scoreDisplay(score, metric)}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${scoreColor(score, metric)}`}
            style={{ width: p != null ? `${p}%` : "0%" }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------- calendar grid for sensor metrics ----------
// Numeric sensor fields get a compact calendar. Activity is text, so it is
// shown as dated detail instead of being treated as a numeric score.
type NumericSensorField = "washroom_visits" | "sleep_hours";
type CalendarCell = { date: string; day: number; value: number | null } | null;

function buildNumericCalendarWeeks(
  days: DailyAggregate[],
  field: NumericSensorField,
): CalendarCell[][] {
  if (days.length === 0) return [];

  const byDate = new Map(days.map((d) => [d.date, d]));
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const start = new Date(sorted[0].date + "T00:00:00");
  const end = new Date(sorted[sorted.length - 1].date + "T00:00:00");

  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const gridEnd = new Date(end);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  const cells: CalendarCell[] = [];

  for (
    let d = new Date(gridStart);
    d <= gridEnd;
    d.setDate(d.getDate() + 1)
  ) {
    const iso = d.toISOString().slice(0, 10);
    const row = byDate.get(iso);
    const raw = row?.[field] ?? null;

    cells.push(
      iso >= start.toISOString().slice(0, 10) &&
        iso <= end.toISOString().slice(0, 10)
        ? {
            date: iso,
            day: d.getDate(),
            value: typeof raw === "number" ? raw : null,
          }
        : null,
    );
  }

  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

function sensorHeatClass(
  value: number | null,
  field: NumericSensorField,
): string {
  if (value == null) return "bg-gray-50 border border-gray-100 text-gray-300";

  // Display bands only; these are not clinical thresholds.
  if (field === "washroom_visits") {
    if (value >= 5) return "bg-emerald-500 text-white";
    if (value >= 3) return "bg-amber-500 text-white";
    return "bg-red-500 text-white";
  }

  if (value >= 7) return "bg-emerald-500 text-white";
  if (value >= 5.5) return "bg-amber-500 text-white";
  return "bg-red-500 text-white";
}

function formatSensorValue(
  value: number | null,
  field: NumericSensorField,
): string {
  if (value == null) return "—";
  return field === "sleep_hours"
    ? `${value.toFixed(1)}h`
    : `${Math.round(value)} visits`;
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function NumericSensorCalendar({
  label,
  icon,
  days,
  field,
}: {
  label: string;
  icon: React.ReactNode;
  days: DailyAggregate[];
  field: NumericSensorField;
}) {
  const weeks = useMemo(
    () => buildNumericCalendarWeeks(days, field),
    [days, field],
  );

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-gray-400">{icon}</span>
        <span className="text-[11px] font-bold text-gray-500">{label}</span>
      </div>

      <div className="inline-block">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAY_LABELS.map((w, i) => (
            <span
              key={i}
              className="w-8 text-center text-[9px] font-bold text-gray-300"
            >
              {w}
            </span>
          ))}
        </div>

        <div className="space-y-1">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1">
              {week.map((cell, di) =>
                cell ? (
                  <div
                    key={di}
                    title={`${cell.date}: ${formatSensorValue(cell.value, field)}`}
                    className={`w-8 h-8 rounded-md flex items-center justify-center text-[9px] font-bold ${sensorHeatClass(
                      cell.value,
                      field,
                    )}`}
                  >
                    {cell.day}
                  </div>
                ) : (
                  <div key={di} className="w-8 h-8" />
                ),
              )}
            </div>
          ))}
        </div>

        <div className="mt-2 text-[9px] text-gray-400">
          Hover a day to see the recorded {field === "sleep_hours" ? "sleep duration" : "washroom visit count"}.
        </div>
      </div>
    </div>
  );
}

function SensorDetail({
  label,
  icon,
  value,
}: {
  label: string;
  icon: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 mb-1">
        <span className="text-gray-400">{icon}</span>
        {label}
      </div>
      <div className="text-sm font-bold text-gray-800">{value}</div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string | null }) {
  const key = (severity || "").toLowerCase();
  const cls = SEVERITY_STYLES[key] || "bg-gray-50 text-gray-600 border-gray-200";
  return (
    <span className={`shrink-0 text-[11px] font-bold px-2.5 py-0.5 rounded-md border ${cls}`}>
      {severity ? severity.charAt(0).toUpperCase() + severity.slice(1) : "Unknown"}
    </span>
  );
}

function ResidentCard({
  group,
  alertCount,
}: {
  group: ResidentGroup;
  alertCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const today = group.days.find((d) => d.date === todayStr()) ?? null;

  return (
    <div
      className={`bg-white rounded-2xl border p-4 sm:p-5 shadow-xs transition-all ${
        alertCount > 0 ? "border-red-200/70" : "border-gray-200/70"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <Link
            href={`/staff/residents/${group.resident_id}/history`}
            className="text-sm font-bold text-gray-900 hover:text-[#357366] transition-colors inline-flex items-baseline gap-1 group"
          >
            <span className="truncate">{group.resident_name}</span>
            {group.room && <span className="text-gray-400 font-medium shrink-0"> · Room {group.room}</span>}
          </Link>
          <p className="text-[11px] text-gray-400 font-medium mt-0.5">
            {today ? "Updated from today's log entries" : "No entries logged today"}
          </p>
        </div>
        {alertCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-50 border border-red-200/60 px-2 py-0.5 rounded-md shrink-0">
            <AlertTriangle className="w-3 h-3" /> {alertCount}
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        <ScoreBar
          label="Mood"
          icon={<Smile className="w-4 h-4" />}
          score={today?.mood_score ?? null}
          metric="mood_score"
        />
        <ScoreBar
          label="Meals"
          icon={<Utensils className="w-4 h-4" />}
          score={today?.meal_score ?? null}
          metric="meal_score"
        />
        <ScoreBar
          label="Fluids"
          icon={<Droplets className="w-4 h-4" />}
          score={today?.fluid_score ?? null}
          metric="fluid_score"
        />
        <ScoreBar
          label="Medication"
          icon={<Pill className="w-4 h-4" />}
          score={today?.medication_adherence ?? null}
          metric="medication_adherence"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
        <SensorDetail
          label="Washroom"
          icon={<Bath className="w-3.5 h-3.5" />}
          value={
            today?.washroom_visits != null
              ? `${today.washroom_visits} visits`
              : "—"
          }
        />
        <SensorDetail
          label="Sleep"
          icon={<Moon className="w-3.5 h-3.5" />}
          value={
            today?.sleep_hours != null
              ? `${today.sleep_hours.toFixed(1)} hours${
                  today.sleep_disturbed ? " · disturbed" : ""
                }`
              : "—"
          }
        />
        <SensorDetail
          label="Activity"
          icon={<ActivityIcon className="w-3.5 h-3.5" />}
          value={today?.activity_detail || "—"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500 font-semibold">
        <span className="inline-flex items-center gap-1.5">
          <Thermometer className="w-3.5 h-3.5 text-gray-400" />
          {today?.avg_temperature != null ? `${today.avg_temperature.toFixed(1)}°` : "—"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <HeartPulse className="w-3.5 h-3.5 text-gray-400" />
          {today?.avg_heart_rate != null ? `${Math.round(today.avg_heart_rate)} bpm` : "—"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5 text-gray-400" />
          {today?.avg_pain_scale != null ? `Pain ${today.avg_pain_scale.toFixed(1)}/10` : "—"}
        </span>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="ml-auto inline-flex items-center gap-1 text-[#357366] hover:text-[#2b5e53]"
        >
          {LOOKBACK_DAYS}-day calendar {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <NumericSensorCalendar
              label="Washroom visits"
              icon={<Bath className="w-3.5 h-3.5" />}
              days={group.days}
              field="washroom_visits"
            />
            <NumericSensorCalendar
              label="Sleep hours"
              icon={<Moon className="w-3.5 h-3.5" />}
              days={group.days}
              field="sleep_hours"
            />
          </div>

          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 mb-2">
              <ActivityIcon className="w-3.5 h-3.5 text-gray-400" />
              Activity sensor details
            </div>

            <div className="space-y-2">
              {group.days
                .slice()
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((d) => (
                  <div
                    key={d.date}
                    className="flex items-start gap-3 text-[11px]"
                  >
                    <span className="w-20 shrink-0 font-bold text-gray-400">
                      {d.date}
                    </span>
                    <span className="font-medium text-gray-600">
                      {d.activity_detail || "No activity detail recorded"}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      <Link
        href={`/staff/residents/${group.resident_id}/history`}
        className="mt-3 w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold text-[#357366] hover:text-[#2b5e53] py-2.5 rounded-xl border border-gray-200/80 hover:border-[#4F9C8B] transition-all"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        Full history & care log
      </Link>
    </div>
  );
}

function AlertToast({ alert, onClose }: { alert: BehaviorAlert; onClose: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-red-200 shadow-lg p-4 w-80 animate-in slide-in-from-right">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <p className="text-sm font-bold text-gray-900">{alert.resident_name}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-xs text-gray-600 leading-relaxed">{alert.message}</p>
    </div>
  );
}

function AlertsPanel({
  open,
  onClose,
  alerts,
  loading,
  onResolve,
  resolvingId,
}: {
  open: boolean;
  onClose: () => void;
  alerts: BehaviorAlert[];
  loading: boolean;
  onResolve: (id: string) => void;
  resolvingId: string | null;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"unresolved" | "resolved" | "all">("unresolved");

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (statusFilter === "unresolved" && a.resolved) return false;
      if (statusFilter === "resolved" && !a.resolved) return false;
      if (
        search &&
        !a.resident_name.toLowerCase().includes(search.toLowerCase()) &&
        !(a.room || "").toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  }, [alerts, statusFilter, search]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-[#FAFAF8] w-full max-w-md h-full shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 h-16 border-b border-gray-200/70 shrink-0">
          <h2 className="font-bold text-gray-900">Behavior Alerts</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3 border-b border-gray-200/70 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search resident or room..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200/80 bg-white text-xs outline-none focus:border-[#4F9C8B]"
            />
          </div>
          <div className="flex bg-gray-100/80 rounded-lg p-1">
            {(["unresolved", "resolved", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`flex-1 py-1.5 rounded-md text-[11px] font-bold capitalize transition-all ${
                  statusFilter === s ? "bg-white text-gray-900 shadow-xs" : "text-gray-500"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="py-16 text-center">
              <Loader2 className="w-6 h-6 text-[#4F9C8B] animate-spin mx-auto" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <ShieldCheck className="w-6 h-6 text-[#4F9C8B]" />
              <p className="text-xs font-bold text-gray-500">No alerts match this filter.</p>
            </div>
          ) : (
            filtered.map((a) => (
              <div
                key={a.id}
                className={`bg-white rounded-xl border p-3.5 ${
                  a.resolved ? "border-gray-200/70 opacity-70" : "border-red-200/70"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {a.resident_id ? (
                      <Link
                        href={`/staff/residents/${a.resident_id}/history`}
                        className="text-xs font-bold text-gray-900 hover:text-[#357366] transition-colors truncate"
                      >
                        {a.resident_name}
                        {a.room && <span className="text-gray-400 font-medium"> · {a.room}</span>}
                      </Link>
                    ) : (
                      <p className="text-xs font-bold text-gray-900">
                        {a.resident_name}
                        {a.room && <span className="text-gray-400 font-medium"> · {a.room}</span>}
                      </p>
                    )}
                  </div>
                  <SeverityBadge severity={a.severity} />
                </div>
                <p className="text-[11px] font-semibold text-gray-500 mb-1">
                  {formatMetric(a.metric)}
                  {a.baseline_mean != null && a.recent_mean != null && (
                    <span className="text-gray-400">
                      {" "}
                      · {a.baseline_mean} → {a.recent_mean}
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-700 leading-relaxed">{a.message}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-1">
                  {new Date(a.created_at).toLocaleString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "2-digit",
                    month: "short",
                  })}
                </p>
                {!a.resolved && (
                  <button
                    onClick={() => onResolve(a.id)}
                    disabled={resolvingId === a.id}
                    className="mt-2 inline-flex items-center gap-1.5 bg-[#357366] hover:bg-[#2b5e53] text-white font-semibold text-[11px] px-3 py-1.5 rounded-lg disabled:opacity-50"
                  >
                    {resolvingId === a.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3" />
                    )}
                    Mark resolved
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- main page ----------
export default function CareDashboardPage() {
  const [groups, setGroups] = useState<ResidentGroup[]>([]);
  const [loadingAggregates, setLoadingAggregates] = useState(true);
  const [alerts, setAlerts] = useState<BehaviorAlert[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [toasts, setToasts] = useState<BehaviorAlert[]>([]);
  const [search, setSearch] = useState("");

  const loadAggregates = useCallback(async () => {
    const supabase = createClient();
    const since = new Date();
    since.setDate(since.getDate() - (LOOKBACK_DAYS - 1));
    const sinceStr = since.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("daily_aggregates")
      .select(
        "resident_id, resident_name, room, date, day_index, meal_score, fluid_score, mood_score, medication_adherence, avg_pain_scale, washroom_visits, sleep_hours, sleep_disturbed, activity_detail, avg_temperature, avg_heart_rate, avg_systolic"
      )
      .gte("date", sinceStr)
      .order("date", { ascending: true });

    if (error) {
      console.error("Failed to load daily_aggregates:", error.message);
      setLoadingAggregates(false);
      return;
    }

    const rows = (data as DailyAggregate[]) || [];
    const map = new Map<string, ResidentGroup>();
    for (const row of rows) {
      if (!map.has(row.resident_id)) {
        map.set(row.resident_id, {
          resident_id: row.resident_id,
          resident_name: row.resident_name,
          room: row.room,
          days: [],
        });
      }
      map.get(row.resident_id)!.days.push(row);
    }
    setGroups(Array.from(map.values()));
    setLoadingAggregates(false);
  }, []);

  const loadAlerts = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("behavior_alerts")
      .select(
        "id, resident_id, resident_name, room, metric, baseline_mean, recent_mean, z_score, severity, message, resolved, created_at"
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load behavior_alerts:", error.message);
      setLoadingAlerts(false);
      return;
    }
    setAlerts((data as BehaviorAlert[]) || []);
    setLoadingAlerts(false);
  }, []);

  useEffect(() => {
    loadAggregates();
    loadAlerts();
  }, [loadAggregates, loadAlerts]);

  // realtime: aggregates refresh the grid, new alerts pop a toast + badge
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("care-dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_aggregates" }, () => {
        loadAggregates();
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "behavior_alerts" },
        (payload) => {
          const alert = payload.new as BehaviorAlert;
          setAlerts((prev) => [alert, ...prev]);
          setToasts((prev) => [...prev, alert]);
          setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== alert.id));
          }, 8000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadAggregates]);

  async function handleResolve(id: string) {
    setResolvingId(id);
    const supabase = createClient();
    // behavior_alerts has no resolved_at column — only resolved, resolved_by,
    // resolved_note. Writing resolved_at here previously threw a Postgrest
    // "column does not exist" error on every click.
    const { error } = await supabase
      .from("behavior_alerts")
      .update({ resolved: true })
      .eq("id", id);
    setResolvingId(null);
    if (!error) {
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)));
    } else {
      console.error("Failed to resolve alert:", error.message);
    }
  }

  const unresolvedCount = alerts.filter((a) => !a.resolved).length;
  const alertCountByResident = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of alerts) {
      if (a.resolved || !a.resident_id) continue;
      m.set(a.resident_id, (m.get(a.resident_id) || 0) + 1);
    }
    return m;
  }, [alerts]);

  const filteredGroups = useMemo(() => {
    if (!search) return groups;
    return groups.filter(
      (g) =>
        g.resident_name.toLowerCase().includes(search.toLowerCase()) ||
        (g.room || "").toLowerCase().includes(search.toLowerCase())
    );
  }, [groups, search]);

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-[#1F2937] font-sans">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#FAFAF8]/85 border-b border-gray-100/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          <Link
            href="/staff/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-[#357366] bg-white border border-gray-200/80 shadow-xs px-3 py-2 rounded-xl transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </Link>
          <h1 className="font-bold text-lg text-[#1F2937] tracking-tight">Care Dashboard</h1>

          <div className="ml-auto flex items-center gap-3">
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search resident or room..."
                className="pl-9 pr-3 py-2 rounded-xl border border-gray-200/80 bg-white text-xs outline-none focus:border-[#4F9C8B] w-56"
              />
            </div>
            <button
              onClick={() => setPanelOpen(true)}
              className="relative p-2.5 rounded-xl bg-white border border-gray-200/80 shadow-xs hover:border-[#4F9C8B] transition-all"
            >
              <Bell className="w-4 h-4 text-gray-600" />
              {unresolvedCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold w-4.5 h-4.5 rounded-full flex items-center justify-center px-1">
                  {unresolvedCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {loadingAggregates ? (
          <div className="py-16 text-center flex flex-col items-center gap-2">
            <Loader2 className="w-7 h-7 text-[#4F9C8B] animate-spin" />
            <p className="text-xs font-bold text-gray-400">Loading today's care aggregates...</p>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 py-16 border border-dashed border-gray-200 rounded-2xl bg-white">
            <ShieldCheck className="w-7 h-7 text-[#4F9C8B]" />
            <p className="text-sm font-bold text-gray-600">No residents match this search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredGroups.map((g) => (
              <ResidentCard
                key={g.resident_id}
                group={g}
                alertCount={alertCountByResident.get(g.resident_id) || 0}
              />
            ))}
          </div>
        )}
      </main>

      {/* toast stack */}
      <div className="fixed top-20 right-4 z-50 space-y-2">
        {toasts.map((t) => (
          <AlertToast key={t.id} alert={t} onClose={() => setToasts((p) => p.filter((x) => x.id !== t.id))} />
        ))}
      </div>

      <AlertsPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        alerts={alerts}
        loading={loadingAlerts}
        onResolve={handleResolve}
        resolvingId={resolvingId}
      />
    </div>
  );
}   