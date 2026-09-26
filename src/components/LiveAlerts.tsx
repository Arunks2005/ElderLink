"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Resident = {
  id: string;
  full_name: string;
  room_number: string | null;
};

type FallEvent = {
  id: string;
  resident_id: string | null;
  device_id: string | null;
  status: string | null;
  triggered_at: string | null;
};

type AlertWithResident = FallEvent & {
  resident: Resident | null;
};

export default function LiveAlerts() {
  const [alerts, setAlerts] = useState<AlertWithResident[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState("Connecting");

  useEffect(() => {
    const supabase = createClient();

    async function getResidents(
      residentIds: string[],
    ): Promise<Map<string, Resident>> {
      const residentMap = new Map<string, Resident>();

      const uniqueIds = Array.from(new Set(residentIds.filter(Boolean)));

      if (uniqueIds.length === 0) {
        return residentMap;
      }

      const { data, error } = await supabase
        .from("residents")
        .select("id, full_name, room_number")
        .in("id", uniqueIds);

      if (error) {
        console.error("Failed to load residents:", error);
        return residentMap;
      }

      for (const resident of data || []) {
        residentMap.set(resident.id, resident as Resident);
      }

      return residentMap;
    }

    async function attachResidents(
      events: FallEvent[],
    ): Promise<AlertWithResident[]> {
      const residentIds = events
        .map((event) => event.resident_id)
        .filter((id): id is string => Boolean(id));

      const residentMap = await getResidents(residentIds);

      return events.map((event) => ({
        ...event,
        resident: event.resident_id
          ? residentMap.get(event.resident_id) || null
          : null,
      }));
    }

    async function loadAlerts() {
      setLoading(true);

      try {
        const { data, error } = await supabase
          .from("fall_events")
          .select(
            `
              id,
              resident_id,
              device_id,
              status,
              triggered_at
            `,
          )
          .in("status", ["unresolved", "active"])
          .order("triggered_at", {
            ascending: false,
          });

        if (error) {
          console.error("Failed to load emergency alerts:", error);
          setAlerts([]);
          return;
        }

        const events = (data || []) as FallEvent[];

        const alertsWithResidents = await attachResidents(events);

        setAlerts(alertsWithResidents);
      } catch (error) {
        console.error("Emergency alert loading error:", error);
        setAlerts([]);
      } finally {
        setLoading(false);
      }
    }

    async function loadSingleAlert(
      event: FallEvent,
    ): Promise<AlertWithResident | null> {
      try {
        const { data, error } = await supabase
          .from("fall_events")
          .select(
            `
              id,
              resident_id,
              device_id,
              status,
              triggered_at
            `,
          )
          .eq("id", event.id)
          .single();

        if (error || !data) {
          console.error("Failed to load emergency details:", error);

          return {
            ...event,
            resident: null,
          };
        }

        const completeEvent = data as FallEvent;

        const alertsWithResidents = await attachResidents([completeEvent]);

        return alertsWithResidents[0] || null;
      } catch (error) {
        console.error("Emergency detail loading error:", error);

        return {
          ...event,
          resident: null,
        };
      }
    }

    loadAlerts();

    const channel = supabase
      .channel("elderlink-live-emergency")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "fall_events",
        },
        async (payload) => {
          console.log("New fall event:", payload.new);

          const event = payload.new as FallEvent;

          if (event.status !== "unresolved" && event.status !== "active") {
            return;
          }

          const completeAlert = await loadSingleAlert(event);

          if (!completeAlert) {
            return;
          }

          setAlerts((current) => {
            const alreadyExists = current.some(
              (alert) => alert.id === completeAlert.id,
            );

            if (alreadyExists) {
              return current;
            }

            return [completeAlert, ...current];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "fall_events",
        },
        async (payload) => {
          console.log("Updated fall event:", payload.new);

          const updated = payload.new as FallEvent;

          if (
            updated.status === "resolved" ||
            updated.status === "acknowledged"
          ) {
            setAlerts((current) =>
              current.filter((alert) => alert.id !== updated.id),
            );

            return;
          }

          if (updated.status !== "unresolved" && updated.status !== "active") {
            return;
          }

          const completeAlert = await loadSingleAlert(updated);

          if (!completeAlert) {
            return;
          }

          setAlerts((current) => {
            const exists = current.some(
              (alert) => alert.id === completeAlert.id,
            );

            if (!exists) {
              return [completeAlert, ...current];
            }

            return current.map((alert) =>
              alert.id === completeAlert.id ? completeAlert : alert,
            );
          });
        },
      )
      .subscribe((status) => {
        console.log("Emergency realtime status:", status);

        if (status === "SUBSCRIBED") {
          setConnectionStatus("Connected");
        } else if (status === "CHANNEL_ERROR") {
          setConnectionStatus("Connection Error");
        } else if (status === "TIMED_OUT") {
          setConnectionStatus("Timed Out");
        } else {
          setConnectionStatus("Connecting");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function resolveAlert(alertId: string) {
    if (resolvingId) {
      return;
    }

    setResolvingId(alertId);

    const supabase = createClient();

    try {
      const { error } = await supabase
        .from("fall_events")
        .update({
          status: "resolved",
        })
        .eq("id", alertId);

      if (error) {
        console.error("Failed to resolve alert:", error);
        return;
      }

      setAlerts((current) => current.filter((alert) => alert.id !== alertId));
    } catch (error) {
      console.error("Resolve alert error:", error);
    } finally {
      setResolvingId(null);
    }
  }

  function formatTime(timestamp: string | null | undefined) {
    if (!timestamp) {
      return "Time unavailable";
    }

    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
      return "Time unavailable";
    }

    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatDate(timestamp: string | null | undefined) {
    if (!timestamp) {
      return "Date unavailable";
    }

    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
      return "Date unavailable";
    }

    return date.toLocaleDateString([], {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <section className="w-full">
      {/* Header */}
      <div
        className={`rounded-t-2xl border px-6 py-6 ${
          alerts.length > 0
            ? "border-red-200 bg-red-50"
            : "border-slate-200 bg-white"
        }`}
      >
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-full ${
                alerts.length > 0 ? "bg-red-600" : "bg-slate-200"
              }`}
            >
              <div className="h-4 w-4 rounded-full bg-white" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2
                  className={`text-2xl font-semibold ${
                    alerts.length > 0 ? "text-red-800" : "text-slate-900"
                  }`}
                >
                  {alerts.length > 0
                    ? "Live Emergency"
                    : "Emergency Monitoring"}
                </h2>

                {alerts.length > 0 && (
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                )}
              </div>

              <p
                className={`mt-1 ${
                  alerts.length > 0 ? "text-red-600" : "text-slate-500"
                }`}
              >
                {alerts.length > 0
                  ? "Fall detection event requires immediate attention"
                  : "Monitoring resident safety events in real time"}
              </p>
            </div>
          </div>

          <div
            className={`rounded-xl border px-6 py-3 text-center ${
              alerts.length > 0
                ? "border-red-200 bg-white"
                : "border-slate-200 bg-slate-50"
            }`}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Status
            </p>

            <p
              className={`mt-1 text-lg font-bold ${
                alerts.length > 0 ? "text-red-600" : "text-slate-700"
              }`}
            >
              {alerts.length > 0 ? "ACTIVE" : "CLEAR"}
            </p>
          </div>
        </div>
      </div>

      {/* Connection / Alert summary */}
      <div className="border-x border-slate-200 bg-white px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                connectionStatus === "Connected"
                  ? "bg-green-500"
                  : connectionStatus === "Connection Error"
                    ? "bg-red-500"
                    : "bg-yellow-500"
              }`}
            />

            <span className="text-slate-600">
              Realtime:{" "}
              <span className="font-medium text-slate-900">
                {connectionStatus}
              </span>
            </span>
          </div>

          <div className="text-sm text-slate-500">
            Active alerts:{" "}
            <span className="font-semibold text-slate-900">
              {alerts.length}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="rounded-b-2xl border border-t-0 border-slate-200 bg-white p-6">
        {loading ? (
          <div className="flex min-h-[180px] items-center justify-center">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
              <p className="mt-4 text-sm text-slate-500">
                Loading emergency alerts...
              </p>
            </div>
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex min-h-[180px] items-center justify-center">
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
                <svg
                  className="h-7 w-7 text-green-600"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>

              <h3 className="mt-4 text-lg font-semibold text-slate-900">
                No active emergencies
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                The system is currently monitoring all fall detection events.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {alerts.map((alert) => {
              const resident = alert.resident;

              return (
                <div
                  key={alert.id}
                  className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-sm"
                >
                  {/* Alert top */}
                  <div className="border-b border-red-100 bg-red-50 px-5 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600">
                          <div className="h-3 w-3 rounded-full bg-white" />
                        </div>

                        <div>
                          <p className="font-semibold text-red-800">
                            Fall Event
                          </p>

                          <p className="text-sm text-red-600">
                            Immediate attention required
                          </p>
                        </div>
                      </div>

                      <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-700">
                        Active
                      </span>
                    </div>
                  </div>

                  {/* Main information */}
                  <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 lg:grid-cols-4">
                    {/* Resident */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Resident
                      </p>

                      <p className="mt-2 text-lg font-semibold text-slate-900">
                        {resident?.full_name || "Resident unavailable"}
                      </p>

                      {resident?.room_number && (
                        <p className="mt-1 text-sm text-slate-500">
                          Room {resident.room_number}
                        </p>
                      )}
                    </div>

                    {/* Detected */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Detected
                      </p>

                      <p className="mt-2 text-lg font-semibold text-slate-900">
                        {formatDate(alert.triggered_at)}
                      </p>

                      <p className="mt-1 text-sm text-slate-500">
                        {formatTime(alert.triggered_at)}
                      </p>
                    </div>

                    {/* Device */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Device
                      </p>

                      <p className="mt-2 text-lg font-semibold uppercase text-slate-900">
                        {alert.device_id || "PHONE"}
                      </p>

                      <p className="mt-1 text-sm text-slate-500">
                        Mobile detection
                      </p>
                    </div>

                    {/* Detection */}
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Detection
                      </p>

                      <p className="mt-2 text-lg font-semibold text-red-600">
                        Fall Event
                      </p>

                      <p className="mt-1 text-sm text-red-600">Automatic</p>
                    </div>
                  </div>

                  {/* Bottom action */}
                  <div className="flex flex-col gap-4 border-t border-slate-200 px-5 py-5 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">
                        Immediate attention required
                      </p>

                      <p className="mt-1 text-sm text-slate-500">
                        Verify the resident before resolving this alert.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => resolveAlert(alert.id)}
                      disabled={resolvingId === alert.id}
                      className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {resolvingId === alert.id
                        ? "Resolving..."
                        : "Acknowledge and Resolve"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
