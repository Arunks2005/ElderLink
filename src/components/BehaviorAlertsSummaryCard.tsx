"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, ShieldCheck } from "lucide-react";
import { createClient } from "../lib/supabase/client";

type BehaviorAlert = {
  id: string;
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

// Turns a raw metric key like "avg_heart_rate" into "Avg heart rate".
function formatMetric(metric: string) {
  const words = metric.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const SEVERITY_STYLES: Record<string, string> = {
  severe: "bg-red-50 text-red-700 border-red-200",
  moderate: "bg-amber-50 text-amber-700 border-amber-200",
  mild: "bg-yellow-50 text-yellow-700 border-yellow-200",
};

function SeverityBadge({ severity }: { severity: string | null }) {
  const key = (severity || "").toLowerCase();
  const cls = SEVERITY_STYLES[key] || "bg-gray-50 text-gray-600 border-gray-200";
  return (
    <span
      className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md border ${cls}`}
    >
      {severity ? severity.charAt(0).toUpperCase() + severity.slice(1) : "Unknown"}
    </span>
  );
}

export default function BehaviorAlertsSummaryCard() {
  const [alerts, setAlerts] = useState<BehaviorAlert[]>([]);
  const [totalUnresolved, setTotalUnresolved] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createClient();

      const [{ data: topAlerts }, { count }] = await Promise.all([
        supabase
          .from("behavior_alerts")
          .select(
            "id, resident_name, room, metric, baseline_mean, recent_mean, z_score, severity, message, resolved, created_at"
          )
          .eq("resolved", false)
          .order("created_at", { ascending: false })
          .limit(3),
        supabase
          .from("behavior_alerts")
          .select("id", { count: "exact", head: true })
          .eq("resolved", false),
      ]);

      if (cancelled) return;
      setAlerts((topAlerts as BehaviorAlert[]) || []);
      setTotalUnresolved(count ?? 0);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-gray-200/70 p-5 shadow-xs">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-red-50 text-red-600">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <h2 className="font-bold text-[#1F2937] text-base tracking-tight">
            Behavior Pattern Alerts
          </h2>
          {totalUnresolved > 0 && (
            <span className="bg-red-100 text-red-800 text-xs font-bold px-2.5 py-0.5 rounded-full">
              {totalUnresolved}
            </span>
          )}
        </div>
        <Link
          href="/staff/behavior-alerts"
          className="inline-flex items-center gap-1 text-xs font-bold text-[#357366] hover:text-[#2b5e53] bg-[#EAF4F1] px-3 py-1.5 rounded-full transition-colors"
        >
          View all <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {loading ? (
        <div className="py-8 text-center">
          <p className="text-xs text-gray-400 font-medium">Loading alerts...</p>
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex items-center gap-2.5 py-6 justify-center border border-dashed border-gray-200 rounded-xl bg-[#FAFAF8]">
          <ShieldCheck className="w-4 h-4 text-[#4F9C8B]" />
          <p className="text-xs text-gray-500 font-medium">
            No unresolved behavior alerts right now.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {alerts.map((a) => (
            <Link
              key={a.id}
              href="/staff/behavior-alerts"
              className="block p-3 bg-[#FAFAF8] hover:bg-[#F3F1EB] rounded-xl border-l-4 border-red-400 border-y border-r border-gray-100/80 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">
                    {a.resident_name}
                    {a.room && (
                      <span className="text-gray-400 font-medium"> · Room {a.room}</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-600 font-medium mt-0.5">
                    {formatMetric(a.metric)}
                    {a.baseline_mean != null && a.recent_mean != null && (
                      <span className="text-gray-400">
                        {" "}
                        (baseline {a.baseline_mean} → recent {a.recent_mean})
                      </span>
                    )}
                  </p>
                </div>
                <SeverityBadge severity={a.severity} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}