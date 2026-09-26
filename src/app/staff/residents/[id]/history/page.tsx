"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Utensils,
  Droplets,
  Smile,
  Pill,
  Bath,
  Activity as ActivityIcon,
  Moon,
  Thermometer,
  HeartPulse,
  Gauge,
  NotebookPen,
  Camera,
  Loader2,
  CalendarDays,
  MapPin,
  Cake,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock3,
  FileText,
  Sparkles,
  X,
  Info,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ============================================================================
// Types — aligned with the CURRENT database schema.
//
// daily_aggregates:
//   date, meal_score, fluid_score, mood_score, medication_adherence,
//   avg_pain_scale, washroom_visits, sleep_hours, sleep_disturbed,
//   activity_detail, avg_temperature, avg_heart_rate, avg_systolic,
//   created_at, updated_at
//
// Removed legacy sensor-score columns are not queried or rendered.
// ============================================================================

type ResidentInfo = {
  id: string;
  full_name: string;
  room_number: string | null;
  dob: string | null;
  status: string | null;
  dietary_needs: string | null;
  medical_notes: string | null;
};

type DailyAggregateRow = {
  date: string;
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

  created_at: string | null;
  updated_at: string | null;
};

type CareLogEntry = {
  id: string;
  created_at: string;
  meals: string | null;
  fluids: string | null;
  mood: string | null;
  medication: string | null;
  notes: string | null;
  photo_url: string | null;
  systolic: number | null;
  diastolic: number | null;
  heart_rate: number | null;
  temperature: number | null;
  pain_scale: number | null;
  pain_note: string | null;
  entry_source: string | null;
};

const AGGREGATE_LOOKBACK_DAYS = 42;
const LOG_PAGE_SIZE = 20;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Calculate a resident's age from a YYYY-MM-DD date string without introducing
 * timezone shifts. Returns null when DOB is missing or invalid.
 */
function calcAge(dob: string | null): number | null {
  if (!dob) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const birthDate = new Date(year, month - 1, day);
  if (
    birthDate.getFullYear() !== year ||
    birthDate.getMonth() !== month - 1 ||
    birthDate.getDate() !== day
  ) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - year;

  const birthdayPassed =
    today.getMonth() > month - 1 ||
    (today.getMonth() === month - 1 && today.getDate() >= day);

  if (!birthdayPassed) age -= 1;

  return age >= 0 ? age : null;
}

type ScoreMetric = "tenPoint" | "percentage";

/**
 * Database score scales:
 * - meal_score, fluid_score, mood_score are stored as 0–10.
 * - medication_adherence is stored as 0–100.
 *
 * We only convert to a percentage for visual progress bars.
 * The database value itself is never modified.
 */
function sourceTag(
  source: string | null,
): { label: string; cls: string } | null {
  if (source === "sensor") {
    return {
      label: "Simulated sensor",
      cls: "bg-sky-50 text-sky-700 border-sky-200",
    };
  }

  if (source === "demo") {
    return {
      label: "Demo data",
      cls: "bg-gray-50 text-gray-500 border-gray-200",
    };
  }

  if (source === "manual") {
    return {
      label: "Manual",
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }

  return null;
}

function formatLongDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scorePercent(
  value: number | null,
  metric: ScoreMetric,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;

  const percent = metric === "tenPoint" ? value * 10 : value;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function scoreDisplay(
  value: number | null,
  metric: ScoreMetric,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return metric === "tenPoint"
    ? `${Math.max(0, Math.min(10, value)).toFixed(0)}/10`
    : `${Math.max(0, Math.min(100, value)).toFixed(0)}%`;
}

function scoreColorClass(percent: number | null) {
  if (percent == null) return "bg-slate-100";
  if (percent >= 70) return "bg-emerald-500";
  if (percent >= 40) return "bg-amber-500";
  return "bg-rose-500";
}

function scoreTextClass(percent: number | null) {
  if (percent == null) return "text-slate-400";
  if (percent >= 70) return "text-emerald-700";
  if (percent >= 40) return "text-amber-700";
  return "text-rose-700";
}

function scoreRingClass(percent: number | null) {
  if (percent == null) return "border-slate-200 bg-slate-50 text-slate-400";
  if (percent >= 70) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (percent >= 40) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

/**
 * Overall care score is calculated only after normalising each DB metric to
 * the same 0–100 scale. This prevents medication_adherence=100 from being
 * averaged directly with meal_score=9, fluid_score=9, mood_score=9.
 */
function overallScore(row: DailyAggregateRow): number | null {
  const parts = [
    scorePercent(row.meal_score, "tenPoint"),
    scorePercent(row.fluid_score, "tenPoint"),
    scorePercent(row.mood_score, "tenPoint"),
    scorePercent(row.medication_adherence, "percentage"),
  ].filter((value): value is number => value != null);

  if (!parts.length) return null;
  return Math.round(
    parts.reduce((sum, value) => sum + value, 0) / parts.length,
  );
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

function startOfMonthGrid(monthDate: Date): Date {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  first.setDate(first.getDate() - first.getDay());
  return first;
}

function endOfMonthGrid(monthDate: Date): Date {
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  last.setDate(last.getDate() + (6 - last.getDay()));
  return last;
}

type CalendarCell = {
  iso: string;
  day: number;
  inDisplayedRange: boolean;
  row: DailyAggregateRow | null;
  isToday: boolean;
};

function buildMonthCells(
  monthDate: Date,
  rowsByDate: Map<string, DailyAggregateRow>,
  rangeStart: string,
  rangeEnd: string,
): CalendarCell[] {
  const cells: CalendarCell[] = [];
  const today = dateKey(new Date());
  const gridStart = startOfMonthGrid(monthDate);
  const gridEnd = endOfMonthGrid(monthDate);

  for (
    const cursor = new Date(gridStart);
    cursor <= gridEnd;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const iso = dateKey(cursor);
    cells.push({
      iso,
      day: cursor.getDate(),
      inDisplayedRange: iso >= rangeStart && iso <= rangeEnd,
      row: rowsByDate.get(iso) ?? null,
      isToday: iso === today,
    });
  }

  return cells;
}

function StatPill({
  icon,
  label,
}: {
  icon: ReactNode;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 shadow-sm">
      {icon}
      {label}
    </span>
  );
}

// ============================================================================
// Full-width interactive calendar
// ============================================================================

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function CalendarMonth({
  monthDate,
  cells,
  selectedDate,
  onSelect,
}: {
  monthDate: Date;
  cells: CalendarCell[];
  selectedDate: string | null;
  onSelect: (row: DailyAggregateRow) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[1320px] overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_18px_55px_-30px_rgba(15,23,42,0.28)]">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/80">
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={`${label}-${index}`}
            className={`px-3 py-3 text-center text-[11px] font-extrabold uppercase tracking-[0.12em] ${
              index === 0 || index === 6
                ? "text-slate-400"
                : "text-slate-500"
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          if (!cell.inDisplayedRange) {
            return (
              <div
                key={cell.iso}
                className="min-h-[112px] border-b border-r border-slate-100 bg-slate-50/45 p-2.5 md:min-h-[138px] lg:min-h-[158px]"
              >
                <span className="text-sm font-bold text-slate-300">
                  {cell.day}
                </span>
              </div>
            );
          }

          const row = cell.row;
          const overall = row ? overallScore(row) : null;
          const selected = Boolean(row && row.date === selectedDate);

          return (
            <button
              key={cell.iso}
              type="button"
              disabled={!row}
              onClick={() => row && onSelect(row)}
              className={`relative min-h-[112px] border-b border-r border-slate-100 p-2.5 text-left transition-all md:min-h-[138px] lg:min-h-[158px] ${
                !row
                  ? "cursor-default bg-white"
                  : selected
                    ? "bg-[#EFF9F5] ring-2 ring-inset ring-[#357366]"
                    : "bg-white hover:bg-[#F7FCF9] hover:shadow-inner"
              }`}
              aria-label={
                row
                  ? `Open care details for ${formatLongDate(row.date)}`
                  : `No recorded care data for ${cell.iso}`
              }
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`flex h-8 min-w-8 items-center justify-center rounded-xl px-2 text-xs font-extrabold ${
                    cell.isToday
                      ? "bg-[#357366] text-white shadow-sm"
                      : row
                        ? "bg-slate-100 text-slate-700"
                        : "text-slate-300"
                  }`}
                >
                  {cell.day}
                </span>

                {row && overall != null && (
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] font-extrabold ${scoreRingClass(
                      overall,
                    )}`}
                  >
                    {overall}%
                  </span>
                )}
              </div>

              {row ? (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-slate-100 bg-slate-50/75 p-2">
                      <div className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">
                        <Utensils className="h-3 w-3" />
                        Meal
                      </div>
                      <p className="mt-1 text-sm font-extrabold text-slate-700">
                        {scoreDisplay(row.meal_score, "tenPoint")}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-100 bg-slate-50/75 p-2">
                      <div className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">
                        <Smile className="h-3 w-3" />
                        Mood
                      </div>
                      <p className="mt-1 text-sm font-extrabold text-slate-700">
                        {scoreDisplay(row.mood_score, "tenPoint")}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-100 bg-slate-50/75 p-2">
                      <div className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">
                        <Moon className="h-3 w-3" />
                        Sleep
                      </div>
                      <p className="mt-1 text-sm font-extrabold text-slate-700">
                        {row.sleep_hours != null
                          ? `${row.sleep_hours.toFixed(1)}h`
                          : "—"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-100 bg-slate-50/75 p-2">
                      <div className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">
                        <Bath className="h-3 w-3" />
                        Wash
                      </div>
                      <p className="mt-1 text-sm font-extrabold text-slate-700">
                        {row.washroom_visits != null
                          ? `${row.washroom_visits}`
                          : "—"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span
                      className={`text-[10px] font-extrabold ${
                        row.sleep_disturbed === true
                          ? "text-amber-700"
                          : row.sleep_disturbed === false
                            ? "text-emerald-700"
                            : "text-slate-300"
                      }`}
                    >
                      {row.sleep_disturbed === true
                        ? "Sleep disturbed"
                        : row.sleep_disturbed === false
                          ? "Sleep settled"
                          : "Sleep state not recorded"}
                    </span>

                    <span className="text-[10px] font-extrabold text-[#357366]">
                      View details →
                    </span>
                  </div>
                </>
              ) : (
                <p className="mt-4 text-[11px] font-semibold text-slate-300">
                  No recorded data
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProperCalendar({
  rows,
  selectedDate,
  onSelect,
}: {
  rows: DailyAggregateRow[];
  selectedDate: string | null;
  onSelect: (row: DailyAggregateRow) => void;
}) {
  const rowsByDate = useMemo(
    () => new Map(rows.map((row) => [row.date, row])),
    [rows],
  );

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.date.localeCompare(b.date)),
    [rows],
  );

  const rangeStart = sortedRows[0]?.date ?? "";
  const rangeEnd = sortedRows[sortedRows.length - 1]?.date ?? "";

  const months = useMemo(() => {
    if (!sortedRows.length) return [] as Date[];

    const start = new Date(`${sortedRows[0].date}T00:00:00`);
    const end = new Date(
      `${sortedRows[sortedRows.length - 1].date}T00:00:00`,
    );

    const result: Date[] = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);

    while (cursor <= last) {
      result.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return result;
  }, [sortedRows]);

  const [activeMonthIndex, setActiveMonthIndex] = useState(
    Math.max(months.length - 1, 0),
  );

  useEffect(() => {
    setActiveMonthIndex(months.length ? months.length - 1 : 0);
  }, [months.length]);

  useEffect(() => {
    if (!selectedDate || !months.length) return;
    const selected = new Date(`${selectedDate}T00:00:00`);
    const index = months.findIndex(
      (month) =>
        month.getFullYear() === selected.getFullYear() &&
        month.getMonth() === selected.getMonth(),
    );
    if (index >= 0) setActiveMonthIndex(index);
  }, [selectedDate, months]);

  if (!rows.length) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-16 text-center">
        <CalendarDays className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-3 text-sm font-extrabold text-slate-500">
          No daily aggregate data yet
        </p>
        <p className="mt-1 text-xs font-semibold text-slate-400">
          Sensor and daily care summaries will appear here once recorded.
        </p>
      </div>
    );
  }

  const activeMonth = months[activeMonthIndex] ?? months[0];

  const activeCells = buildMonthCells(
    activeMonth,
    rowsByDate,
    rangeStart,
    rangeEnd,
  );

  const monthRows = sortedRows.filter((row) => {
    const date = new Date(`${row.date}T00:00:00`);
    return (
      date.getFullYear() === activeMonth.getFullYear() &&
      date.getMonth() === activeMonth.getMonth()
    );
  });

  const monthScoreValues = monthRows
    .map(overallScore)
    .filter((value): value is number => value != null);

  const monthAverage =
    monthScoreValues.length > 0
      ? Math.round(
          monthScoreValues.reduce((sum, value) => sum + value, 0) /
            monthScoreValues.length,
        )
      : null;

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-col gap-4 rounded-3xl border border-[#DCEBE5] bg-gradient-to-r from-[#EEF8F4] via-white to-[#F7FBF9] p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[#CFE4DD] bg-white px-2.5 py-1 text-[10px] font-extrabold text-[#357366]">
              {monthRows.length} recorded day{monthRows.length === 1 ? "" : "s"}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-extrabold text-slate-500">
              Click a day to inspect
            </span>
          </div>

          <div className="mt-2 flex items-center gap-3">
            <h3 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
              {monthLabel(activeMonth)}
            </h3>

            {monthAverage != null && (
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${scoreRingClass(
                  monthAverage,
                )}`}
              >
                Month avg {monthAverage}%
              </span>
            )}
          </div>

          <p className="mt-1 text-xs font-semibold text-slate-500">
            Meal, fluid, mood and medication scores are normalised correctly;
            sleep and washroom values remain raw sensor observations.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start lg:self-auto">
          <button
            type="button"
            onClick={() =>
              setActiveMonthIndex((index) => Math.max(0, index - 1))
            }
            disabled={activeMonthIndex === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-extrabold text-slate-600 shadow-sm transition-colors hover:border-[#9CC7BC] hover:text-[#357366] disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveMonthIndex((index) =>
                Math.min(months.length - 1, index + 1),
              )
            }
            disabled={activeMonthIndex === months.length - 1}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-extrabold text-slate-600 shadow-sm transition-colors hover:border-[#9CC7BC] hover:text-[#357366] disabled:cursor-not-allowed disabled:opacity-35"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <CalendarMonth
        monthDate={activeMonth}
        cells={activeCells}
        selectedDate={selectedDate}
        onSelect={onSelect}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
            Care score
          </p>
          <div className="mt-2 flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-emerald-500" />
            <span className="text-xs font-bold text-slate-600">70–100%</span>
            <span className="h-3 w-3 rounded-full bg-amber-500" />
            <span className="text-xs font-bold text-slate-600">40–69%</span>
            <span className="h-3 w-3 rounded-full bg-rose-500" />
            <span className="text-xs font-bold text-slate-600">&lt;40%</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
            Sensor snapshot
          </p>
          <p className="mt-2 text-xs font-bold text-slate-600">
            Sleep {activeMonthRowsSummary(monthRows, "sleep")} · Washroom{" "}
            {activeMonthRowsSummary(monthRows, "wash")}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
            Interaction
          </p>
          <p className="mt-2 text-xs font-bold text-slate-600">
            Select any recorded date to open the full daily snapshot.
          </p>
        </div>
      </div>
    </div>
  );
}

function activeMonthRowsSummary(
  rows: DailyAggregateRow[],
  type: "sleep" | "wash",
): string {
  if (!rows.length) return "—";

  if (type === "sleep") {
    const values = rows
      .map((row) => row.sleep_hours)
      .filter((value): value is number => value != null);

    if (!values.length) return "—";
    const average =
      values.reduce((sum, value) => sum + value, 0) / values.length;
    return `${average.toFixed(1)}h avg`;
  }

  const values = rows
    .map((row) => row.washroom_visits)
    .filter((value): value is number => value != null);

  if (!values.length) return "—";
  const average =
    values.reduce((sum, value) => sum + value, 0) / values.length;
  return `${average.toFixed(1)} visits avg`;
}

// ============================================================================
// Day detail modal
// ============================================================================

function ScoreRow({
  icon,
  label,
  value,
  metric,
}: {
  icon: ReactNode;
  label: string;
  value: number | null;
  metric: ScoreMetric;
}) {
  const percentage = scorePercent(value, metric);

  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
          percentage == null
            ? "border-slate-200 bg-slate-50 text-slate-400"
            : scoreRingClass(percentage)
        }`}
      >
        {icon}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-600">{label}</span>
          <span
            className={`text-xs font-extrabold ${scoreTextClass(
              percentage,
            )}`}
          >
            {scoreDisplay(value, metric)}
          </span>
        </div>

        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${scoreColorClass(percentage)}`}
            style={{ width: percentage != null ? `${percentage}%` : "0%" }}
          />
        </div>
      </div>
    </div>
  );
}

function DayDetailModal({
  row,
  onClose,
}: {
  row: DailyAggregateRow | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!row) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [row, onClose]);

  if (!row) return null;

  const overall = overallScore(row);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="day-detail-title"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/60 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-[#EEF7F3] via-white to-[#F8FBFA] px-5 py-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#5A8C80]">
              Daily snapshot
            </p>
            <h3
              id="day-detail-title"
              className="mt-1 text-lg font-extrabold text-slate-900"
            >
              {formatLongDate(row.date)}
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
            aria-label="Close day details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[78vh] overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
                Care score
              </p>
              <p
                className={`mt-1 text-base font-extrabold ${
                  overall != null ? scoreTextClass(overall) : "text-slate-400"
                }`}
              >
                {overall != null ? `${overall}%` : "—"}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
                Sleep
              </p>
              <p className="mt-1 text-base font-extrabold text-slate-800">
                {row.sleep_hours != null ? `${row.sleep_hours}h` : "—"}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
                Washroom
              </p>
              <p className="mt-1 text-base font-extrabold text-slate-800">
                {row.washroom_visits != null
                  ? `${row.washroom_visits}`
                  : "—"}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
                Sleep state
              </p>
              <p
                className={`mt-1 text-base font-extrabold ${
                  row.sleep_disturbed === true
                    ? "text-amber-700"
                    : row.sleep_disturbed === false
                      ? "text-emerald-700"
                      : "text-slate-400"
                }`}
              >
                {row.sleep_disturbed === true
                  ? "Disturbed"
                  : row.sleep_disturbed === false
                    ? "Settled"
                    : "—"}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <Info className="h-4 w-4 text-[#4F9C8B]" />
              <p className="text-xs font-extrabold text-slate-800">
                Recorded care
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ScoreRow
                icon={<Utensils className="h-4 w-4" />}
                label="Meals"
                value={row.meal_score}
                metric="tenPoint"
              />
              <ScoreRow
                icon={<Droplets className="h-4 w-4" />}
                label="Fluids"
                value={row.fluid_score}
                metric="tenPoint"
              />
              <ScoreRow
                icon={<Smile className="h-4 w-4" />}
                label="Mood"
                value={row.mood_score}
                metric="tenPoint"
              />
              <ScoreRow
                icon={<Pill className="h-4 w-4" />}
                label="Medication"
                value={row.medication_adherence}
                metric="percentage"
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                <Gauge className="h-3 w-3" />
                Pain
              </div>
              <p className="mt-1 text-sm font-extrabold text-slate-800">
                {row.avg_pain_scale != null
                  ? `${row.avg_pain_scale.toFixed(1)}/10`
                  : "—"}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                <HeartPulse className="h-3 w-3" />
                Heart rate
              </div>
              <p className="mt-1 text-sm font-extrabold text-slate-800">
                {row.avg_heart_rate != null
                  ? `${Math.round(row.avg_heart_rate)} bpm`
                  : "—"}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                <Thermometer className="h-3 w-3" />
                Temperature
              </div>
              <p className="mt-1 text-sm font-extrabold text-slate-800">
                {row.avg_temperature != null
                  ? `${row.avg_temperature.toFixed(1)}°`
                  : "—"}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                <ActivityIcon className="h-3 w-3" />
                Systolic
              </div>
              <p className="mt-1 text-sm font-extrabold text-slate-800">
                {row.avg_systolic != null
                  ? Math.round(row.avg_systolic)
                  : "—"}
              </p>
            </div>
          </div>

          {row.activity_detail && (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5">
              <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
                <ActivityIcon className="h-3 w-3" />
                Activity
              </div>
              <p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-600">
                {row.activity_detail}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[#357366] px-4 py-2 text-xs font-extrabold text-white transition-colors hover:bg-[#2B5E53]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Detailed care log row
// ============================================================================

function LogEntryRow({ entry }: { entry: CareLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const tag = sourceTag(entry.entry_source);

  const chip = (icon: ReactNode, label: string | null) =>
    label ? (
      <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200/80 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600">
        {icon} {label}
      </span>
    ) : null;

  const hasDetails = Boolean(
    entry.notes || entry.pain_note || entry.photo_url,
  );

  return (
    <div className="group border-b border-slate-100 py-4 last:border-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-extrabold text-slate-800">
              {formatCreatedAt(entry.created_at)}
            </span>

            {tag && (
              <span
                className={`rounded-md border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${tag.cls}`}
              >
                {tag.label}
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {chip(<Utensils className="h-3 w-3" />, entry.meals)}
            {chip(<Droplets className="h-3 w-3" />, entry.fluids)}
            {chip(<Smile className="h-3 w-3" />, entry.mood)}
            {chip(<Pill className="h-3 w-3" />, entry.medication)}

            {entry.systolic != null &&
              entry.diastolic != null &&
              chip(
                <HeartPulse className="h-3 w-3" />,
                `${entry.systolic}/${entry.diastolic}`,
              )}

            {entry.heart_rate != null &&
              chip(
                <ActivityIcon className="h-3 w-3" />,
                `${entry.heart_rate} bpm`,
              )}

            {entry.temperature != null &&
              chip(
                <Thermometer className="h-3 w-3" />,
                `${entry.temperature}°`,
              )}

            {entry.pain_scale != null &&
              chip(
                <Gauge className="h-3 w-3" />,
                `Pain ${entry.pain_scale}/10`,
              )}

            {entry.photo_url &&
              chip(<Camera className="h-3 w-3" />, "Photo")}
          </div>
        </div>

        {hasDetails && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-extrabold text-[#357366] transition-colors hover:bg-[#F2F8F5]"
            aria-expanded={expanded}
          >
            {expanded ? "Hide" : "Details"}
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          {entry.notes && (
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
                <NotebookPen className="h-3 w-3" />
                Notes
              </div>
              <p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-600">
                {entry.notes}
              </p>
            </div>
          )}

          {entry.pain_note && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-amber-700">
                <Gauge className="h-3 w-3" />
                Pain note
              </div>
              <p className="mt-1.5 text-xs font-semibold leading-relaxed text-amber-800">
                {entry.pain_note}
              </p>
            </div>
          )}

          {entry.photo_url && (
            <a
              href={entry.photo_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#357366] hover:text-[#2b5e53]"
            >
              <Camera className="h-3.5 w-3.5" />
              Open attached photo
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export default function ResidentHistoryPage() {
  const params = useParams();
  const rawId = params?.id;
  const id = Array.isArray(rawId)
    ? rawId[0]
    : (rawId as string) || "";

  const [resident, setResident] = useState<ResidentInfo | null>(null);
  const [loadingResident, setLoadingResident] = useState(true);
  const [residentError, setResidentError] = useState<string | null>(null);

  const [aggregates, setAggregates] = useState<DailyAggregateRow[]>([]);
  const [loadingAggregates, setLoadingAggregates] = useState(true);
  const [aggregateError, setAggregateError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<DailyAggregateRow | null>(
    null,
  );

  const [logs, setLogs] = useState<CareLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreLogs, setHasMoreLogs] = useState(true);

  useEffect(() => {
    if (!id) {
      setLoadingResident(false);
      setResidentError("Resident ID is missing.");
      return;
    }

    let isMounted = true;

    async function fetchResident() {
      const supabase = createClient();

      const { data, error } = await supabase
        .from("residents")
        .select(
          "id, full_name, room_number, dob, status, dietary_needs, medical_notes",
        )
        .eq("id", id)
        .maybeSingle();

      if (!isMounted) return;

      if (error) {
        console.error("Failed to load resident:", error.message);
        setResidentError(error.message);
      } else if (!data) {
        setResidentError("Resident not found.");
      } else {
        setResidentError(null);
        setResident(data as ResidentInfo);
      }

      setLoadingResident(false);
    }

    fetchResident();

    return () => {
      isMounted = false;
    };
  }, [id]);

  const fetchAggregates = useCallback(async () => {
    if (!id) return;

    setLoadingAggregates(true);
    setAggregateError(null);

    const supabase = createClient();
    const since = new Date();
    since.setDate(since.getDate() - (AGGREGATE_LOOKBACK_DAYS - 1));

    const { data, error } = await supabase
      .from("daily_aggregates")
      .select(
        "date, meal_score, fluid_score, mood_score, medication_adherence, avg_pain_scale, washroom_visits, sleep_hours, sleep_disturbed, activity_detail, avg_temperature, avg_heart_rate, avg_systolic, created_at, updated_at",
      )
      .eq("resident_id", id)
      .gte("date", since.toISOString().slice(0, 10))
      .order("date", { ascending: true });

    if (error) {
      console.error("Failed to load daily_aggregates:", error.message);
      setAggregateError(error.message);
      setAggregates([]);
      setSelectedRow(null);
      setLoadingAggregates(false);
      return;
    }

    const rows = (data as DailyAggregateRow[]) ?? [];
    setAggregates(rows);

    // A date is opened only when the user clicks a calendar day.
    // Do not auto-open a modal when the page first loads.
    setSelectedRow(null);

    setLoadingAggregates(false);
  }, [id]);

  useEffect(() => {
    fetchAggregates();
  }, [fetchAggregates]);

  const fetchLogsPage = useCallback(
    async (offset: number) => {
      const supabase = createClient();

      const { data, error } = await supabase
        .from("care_logs_demo")
        .select(
          "id, created_at, meals, fluids, mood, medication, notes, photo_url, systolic, diastolic, heart_rate, temperature, pain_scale, pain_note, entry_source",
        )
        .eq("resident_id", id)
        .order("created_at", { ascending: false })
        .range(offset, offset + LOG_PAGE_SIZE - 1);

      if (error) {
        console.error("Failed to load care_logs_demo:", error.message);
        return { rows: [] as CareLogEntry[], more: false };
      }

      const rows = (data as CareLogEntry[]) ?? [];
      return {
        rows,
        more: rows.length === LOG_PAGE_SIZE,
      };
    },
    [id],
  );

  useEffect(() => {
    if (!id) {
      setLoadingLogs(false);
      return;
    }

    let isMounted = true;

    (async () => {
      const { rows, more } = await fetchLogsPage(0);

      if (!isMounted) return;

      setLogs(rows);
      setHasMoreLogs(more);
      setLoadingLogs(false);
    })();

    return () => {
      isMounted = false;
    };
  }, [id, fetchLogsPage]);

  async function handleLoadMore() {
    if (loadingMore || !hasMoreLogs) return;

    setLoadingMore(true);

    const { rows, more } = await fetchLogsPage(logs.length);

    setLogs((previous) => [...previous, ...rows]);
    setHasMoreLogs(more);
    setLoadingMore(false);
  }

  const latestAggregate = aggregates[aggregates.length - 1] ?? null;

  const aggregateSummary = useMemo(() => {
    const overallValues = aggregates
      .map((row) => overallScore(row))
      .filter((value): value is number => value != null);

    const sleepValues = aggregates
      .map((row) => row.sleep_hours)
      .filter((value): value is number => value != null);

    const washroomValues = aggregates
      .map((row) => row.washroom_visits)
      .filter((value): value is number => value != null);

    return {
      avgScore:
        overallValues.length > 0
          ? Math.round(
              overallValues.reduce((sum, value) => sum + value, 0) /
                overallValues.length,
            )
          : null,
      avgSleep:
        sleepValues.length > 0
          ? sleepValues.reduce((sum, value) => sum + value, 0) /
            sleepValues.length
          : null,
      avgWashroom:
        washroomValues.length > 0
          ? washroomValues.reduce((sum, value) => sum + value, 0) /
            washroomValues.length
          : null,
      disturbedCount: aggregates.filter(
        (row) => row.sleep_disturbed === true,
      ).length,
    };
  }, [aggregates]);

  const age = resident ? calcAge(resident.dob) : null;

  return (
    <div className="min-h-screen bg-[#F7F9F7] pb-16 text-[#1F2937]">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-[#F7F9F7]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
          {/* Intentionally points back to the requested dashboard route. */}
          <Link
            href="/staff/behavior-alerts"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#8FC0B4] hover:text-[#357366]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Back to Dashboard</span>
            <span className="sm:hidden">Back</span>
          </Link>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <NotebookPen className="hidden h-4 w-4 text-[#4F9C8B] sm:block" />
              <h1 className="truncate text-base font-extrabold tracking-tight text-slate-900 sm:text-lg">
                {loadingResident
                  ? "Loading resident…"
                  : resident?.full_name ?? "Resident history"}
              </h1>
            </div>

            {resident?.room_number && (
              <p className="mt-0.5 hidden text-[10px] font-bold text-slate-400 sm:block">
                Room {resident.room_number} · {AGGREGATE_LOOKBACK_DAYS}-day care
                history
              </p>
            )}
          </div>

          {id && (
            <Link
              href={`/staff/residents/${id}/log`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#357366] px-3 py-2 text-xs font-extrabold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[#2B5E53]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Add care log</span>
              <span className="sm:hidden">Add</span>
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-6">
        {resident && (
          <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm">
            <div className="bg-gradient-to-r from-[#EEF7F3] via-white to-[#F8FBFA] p-5 sm:p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#D7E7E2] bg-white/80 px-2.5 py-1 text-[10px] font-extrabold text-[#357366]">
                      <Sparkles className="h-3 w-3" />
                      Resident profile
                    </span>

                    {resident.status && (
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[10px] font-extrabold capitalize text-slate-500">
                        {resident.status}
                      </span>
                    )}
                  </div>

                  <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900">
                    {resident.full_name}
                  </h2>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-bold text-slate-500">
                    {resident.room_number && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-[#7AAEA3]" />
                        Room {resident.room_number}
                      </span>
                    )}

                    {age != null && (
                      <span className="inline-flex items-center gap-1.5">
                        <Cake className="h-3.5 w-3.5 text-[#7AAEA3]" />
                        {age} years old
                      </span>
                    )}

                    <span className="inline-flex items-center gap-1.5">
                      <Clock3 className="h-3.5 w-3.5 text-[#7AAEA3]" />
                      Updated from recorded care
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:min-w-[320px]">
                  <div className="rounded-2xl border border-white/90 bg-white/90 p-3 shadow-sm">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
                      Avg care score
                    </p>
                    <p
                      className={`mt-1 text-lg font-extrabold ${
                        aggregateSummary.avgScore != null
                          ? scoreTextClass(aggregateSummary.avgScore)
                          : "text-slate-400"
                      }`}
                    >
                      {aggregateSummary.avgScore != null
                        ? `${aggregateSummary.avgScore}%`
                        : "—"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/90 bg-white/90 p-3 shadow-sm">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
                      Avg sleep
                    </p>
                    <p className="mt-1 text-lg font-extrabold text-slate-800">
                      {aggregateSummary.avgSleep != null
                        ? `${aggregateSummary.avgSleep.toFixed(1)}h`
                        : "—"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/90 bg-white/90 p-3 shadow-sm">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
                      Avg washroom
                    </p>
                    <p className="mt-1 text-lg font-extrabold text-slate-800">
                      {aggregateSummary.avgWashroom != null
                        ? aggregateSummary.avgWashroom.toFixed(1)
                        : "—"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/90 bg-white/90 p-3 shadow-sm">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
                      Disturbed nights
                    </p>
                    <p className="mt-1 text-lg font-extrabold text-slate-800">
                      {aggregateSummary.disturbedCount}
                    </p>
                  </div>
                </div>
              </div>

              {(resident.dietary_needs || resident.medical_notes) && (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {resident.dietary_needs && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-amber-700">
                        <Utensils className="h-3 w-3" />
                        Dietary needs
                      </div>
                      <p className="mt-1.5 text-xs font-semibold leading-relaxed text-amber-900">
                        {resident.dietary_needs}
                      </p>
                    </div>
                  )}

                  {resident.medical_notes && (
                    <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-3.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-sky-700">
                        <FileText className="h-3 w-3" />
                        Medical notes
                      </div>
                      <p className="mt-1.5 text-xs font-semibold leading-relaxed text-sky-900">
                        {resident.medical_notes}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {residentError && (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
            {residentError}
          </section>
        )}

        <section className="rounded-3xl border border-slate-200/80 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EEF7F3] text-[#357366]">
                    <CalendarDays className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-900 sm:text-base">
                      Care history calendar
                    </h2>
                    <p className="mt-0.5 text-[10px] font-semibold text-slate-400 sm:text-xs">
                      {AGGREGATE_LOOKBACK_DAYS} days · click a recorded date for
                      a quick summary
                    </p>
                  </div>
                </div>
              </div>

              {latestAggregate && (
                <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#357366]" />
                  <span className="text-[10px] font-extrabold text-slate-500">
                    Latest recorded:{" "}
                    {new Date(
                      `${latestAggregate.date}T00:00:00`,
                    ).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="p-4 sm:p-6">
            {loadingAggregates ? (
              <div className="flex min-h-[360px] items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF7F3]">
                    <Loader2 className="h-6 w-6 animate-spin text-[#4F9C8B]" />
                  </div>
                  <p className="text-xs font-extrabold text-slate-400">
                    Loading care calendar…
                  </p>
                </div>
              </div>
            ) : aggregateError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                <p className="text-sm font-extrabold text-rose-700">
                  Could not load daily aggregates
                </p>
                <p className="mt-1 text-xs font-semibold text-rose-600">
                  {aggregateError}
                </p>
                <button
                  type="button"
                  onClick={fetchAggregates}
                  className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-rose-700 shadow-sm ring-1 ring-inset ring-rose-200 transition-colors hover:bg-rose-100"
                >
                  Try again
                </button>
              </div>
            ) : (
              <ProperCalendar
                rows={aggregates}
                selectedDate={selectedRow?.date ?? null}
                onSelect={(row) => setSelectedRow(row)}
              />
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200/80 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <NotebookPen className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900 sm:text-base">
                  Care log entries
                </h2>
                <p className="mt-0.5 text-[10px] font-semibold text-slate-400 sm:text-xs">
                  Staff-recorded observations and vitals
                </p>
              </div>
            </div>

            {!loadingLogs && (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-extrabold text-slate-500">
                {logs.length} loaded
              </span>
            )}
          </div>

          <div className="p-5 sm:p-6">
            {loadingLogs ? (
              <div className="flex min-h-[220px] items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                    <Loader2 className="h-6 w-6 animate-spin text-[#4F9C8B]" />
                  </div>
                  <p className="text-xs font-extrabold text-slate-400">
                    Loading care logs…
                  </p>
                </div>
              </div>
            ) : logs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-10 text-center">
                <NotebookPen className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm font-extrabold text-slate-500">
                  No care log entries yet
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-400">
                  New entries will appear here after staff save a care log.
                </p>
              </div>
            ) : (
              <>
                <div>
                  {logs.map((entry) => (
                    <LogEntryRow key={entry.id} entry={entry} />
                  ))}
                </div>

                {hasMoreLogs && (
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-xs font-extrabold text-[#357366] transition-all hover:border-[#8FC0B4] hover:bg-[#F4FAF7] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingMore ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    {loadingMore ? "Loading…" : "Load more entries"}
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      </main>

      <DayDetailModal
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
      />
    </div>
  );
}
