"use client";

/**
 * ElderAI docked in a left side panel on the dashboards.
 *
 * Reuses the full ElderAI chat page inside the panel (same chats, voice,
 * settings and history), so nothing is duplicated. "Full screen" opens the
 * same page on its own and continues the latest chat. On wide screens the
 * dashboard shifts right while the panel is open, so both stay usable.
 */

import { useEffect, useState } from "react";
import { Bot, Maximize2, Plus, X } from "lucide-react";

export const ELDERAI_PATH = "/admin/behavioral-trends";
export const DOCK_WIDTH_CLASS = "lg:pl-[420px]";

export default function ElderAIDock({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mount the chat the first time it opens, then keep it alive so a
  // conversation survives closing and reopening the panel.
  const [mounted, setMounted] = useState(open);
  const [chatKey, setChatKey] = useState(0);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <aside
      aria-label="ElderAI assistant"
      aria-hidden={!open}
      className={`fixed inset-y-0 left-0 z-50 flex w-full sm:w-[420px] flex-col bg-white border-r border-slate-200 shadow-2xl transition-transform duration-300 ease-out ${
        open ? "translate-x-0" : "-translate-x-full pointer-events-none"
      }`}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-100 px-3">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
          style={{ background: "linear-gradient(135deg, #6366f1, #7c3aed)" }}
        >
          <Bot className="h-4 w-4" />
        </span>
        <span className="font-bold text-slate-900">ElderAI</span>
        <span className="hidden sm:inline text-[11px] text-slate-400">Live ElderLink data</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setChatKey((k) => k + 1)}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            title="New chat"
            aria-label="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              window.location.href = ELDERAI_PATH;
            }}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            title="Open full screen"
            aria-label="Open full screen"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Close (Esc)" aria-label="Close ElderAI">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        {mounted ? (
          <iframe
            key={chatKey}
            src={`${ELDERAI_PATH}?new=1&embed=1`}
            title="ElderAI chat"
            className="absolute inset-0 h-full w-full border-0"
            allow="microphone; clipboard-write"
          />
        ) : null}
      </div>
    </aside>
  );
}
