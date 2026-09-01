"use client";

import { useEffect, useState } from "react";

type ResidentAnalysis = {
  resident_id: string;
  resident_name: string;
  trend_summary: string;
  flags: string[];
  severity: "normal" | "watch" | "monitor_closely";
  basis: string;
};

const SEVERITY_STYLES: Record<ResidentAnalysis["severity"], string> = {
  normal: "bg-green-50 border-green-200 text-green-800",
  watch: "bg-yellow-50 border-yellow-200 text-yellow-800",
  monitor_closely: "bg-red-50 border-red-200 text-red-800",
};

const SEVERITY_LABEL: Record<ResidentAnalysis["severity"], string> = {
  normal: "Normal",
  watch: "Watch",
  monitor_closely: "Monitor Closely",
};

export default function BehavioralTrendsPanel() {
  const [results, setResults] = useState<ResidentAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/behavioral-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // no residentIds = analyze all residents
      });
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setResults(data.results ?? []);
    } catch (e) {
      setError("Couldn't load behavioral analysis. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runAnalysis();
  }, []);

  // Sort so residents needing attention surface first
  const severityOrder = { monitor_closely: 0, watch: 1, normal: 2 };
  const sorted = [...results].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );

  return (
    <div className="rounded-xl border border-gray-200 p-5 bg-white">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Behavioral Trends
          </h2>
          <p className="text-sm text-gray-500">
            AI-assisted observation based on recent care logs — not a
            diagnosis. Staff judgment always takes precedence.
          </p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? "Analyzing..." : "Refresh"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {!loading && sorted.length === 0 && !error && (
        <p className="text-sm text-gray-500">No residents to analyze yet.</p>
      )}

      <div className="space-y-3">
        {sorted.map((r) => (
          <div
            key={r.resident_id}
            className={`rounded-lg border p-4 ${SEVERITY_STYLES[r.severity]}`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">{r.resident_name}</span>
              <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-white/60">
                {SEVERITY_LABEL[r.severity]}
              </span>
            </div>
            <p className="text-sm mb-1">{r.trend_summary}</p>
            {r.flags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {r.flags.map((flag) => (
                  <span
                    key={flag}
                    className="text-xs px-2 py-0.5 rounded-full bg-white/70"
                  >
                    {flag.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
            {r.basis && <p className="text-xs opacity-75">{r.basis}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}