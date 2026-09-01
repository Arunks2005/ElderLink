"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Plus, Send, Trash2, MessageSquare, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ---------- Types ----------
type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
};

const STORAGE_KEY = "elderlink_behavioral_chat_sessions";

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeEmptySession(): ChatSession {
  return {
    id: newId(),
    title: "New chat",
    messages: [],
    updatedAt: new Date().toISOString(),
  };
}

function loadSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: ChatSession[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export default function BehavioralChatPage() {
  const supabase = createClient();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load persisted sessions on mount
  useEffect(() => {
    const existing = loadSessions();
    if (existing.length > 0) {
      const sorted = [...existing].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setSessions(sorted);
      setActiveId(sorted[0].id);
    } else {
      const fresh = makeEmptySession();
      setSessions([fresh]);
      setActiveId(fresh.id);
    }
  }, []);

  // Fetch a few real resident names for the empty-state suggestion chips
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("residents").select("full_name").limit(4);
      if (data) setSuggestions(data.map((r: { full_name: string }) => r.full_name));
    })();
  }, [supabase]);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [activeSession?.messages.length, loading]);

  function persist(updated: ChatSession[]) {
    setSessions(updated);
    saveSessions(updated);
  }

  function handleNewChat() {
    const fresh = makeEmptySession();
    persist([fresh, ...sessions]);
    setActiveId(fresh.id);
    setInput("");
  }

  function handleDeleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const remaining = sessions.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      const fresh = makeEmptySession();
      persist([fresh]);
      setActiveId(fresh.id);
    } else {
      persist(remaining);
      if (activeId === id) setActiveId(remaining[0].id);
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || !activeSession || loading) return;

    const userMessage: ChatMessage = { id: newId(), role: "user", content: text };
    const isFirstMessage = activeSession.messages.length === 0;
    const updatedMessages = [...activeSession.messages, userMessage];

    const updatedSession: ChatSession = {
      ...activeSession,
      title: isFirstMessage ? text.slice(0, 40) + (text.length > 40 ? "…" : "") : activeSession.title,
      messages: updatedMessages,
      updatedAt: new Date().toISOString(),
    };

    const withUpdated = sessions.map((s) => (s.id === activeSession.id ? updatedSession : s));
    persist(withUpdated);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);

    try {
      const res = await fetch("/api/behavioral-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();

      const assistantMessage: ChatMessage = {
        id: newId(),
        role: "assistant",
        content: res.ok ? data.reply : data.error || "Something went wrong. Please try again.",
      };

      const finalSession: ChatSession = {
        ...updatedSession,
        messages: [...updatedSession.messages, assistantMessage],
        updatedAt: new Date().toISOString(),
      };
      setSessions((prev) => {
        const next = prev.map((s) => (s.id === activeSession.id ? finalSession : s));
        saveSessions(next);
        return next;
      });
    } catch {
      const errorMessage: ChatMessage = {
        id: newId(),
        role: "assistant",
        content: "Couldn't reach Behavioral AI right now. Please try again.",
      };
      const finalSession: ChatSession = {
        ...updatedSession,
        messages: [...updatedSession.messages, errorMessage],
      };
      setSessions((prev) => {
        const next = prev.map((s) => (s.id === activeSession.id ? finalSession : s));
        saveSessions(next);
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  const hasMessages = (activeSession?.messages.length ?? 0) > 0;

  return (
    <div
      className="min-h-screen flex"
      style={{ background: "linear-gradient(180deg, #e9edf1 0%, #eef1f4 100%)" }}
    >
      {/* ── Sidebar: sessions list, Claude-style ────────────────────────── */}
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white/70 backdrop-blur-sm flex flex-col">
        <div className="p-3">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900 transition"
          >
            <Plus className="w-4 h-4" />
            New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm flex items-center gap-2 group transition ${
                s.id === activeId
                  ? "bg-indigo-50 text-indigo-800 font-medium"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
              <span className="truncate flex-1">{s.title || "New chat"}</span>
              <span
                onClick={(e) => handleDeleteSession(s.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-slate-200 transition shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5 text-slate-400" />
              </span>
            </button>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-slate-200">
          <p className="text-[11px] text-slate-400 leading-relaxed">
            AI-assisted observation, not a diagnosis. Staff judgment always takes
            precedence.
          </p>
        </div>
      </aside>

      {/* ── Main chat pane ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!hasMessages ? (
          // Empty state — mirrors a fresh Claude chat: centered greeting + input
          <div className="flex-1 flex flex-col items-center justify-center px-6">
            <div className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center mb-4">
              <Bot className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-slate-900 mb-1">Behavioral AI</h1>
            <p className="text-sm text-slate-500 mb-6 text-center max-w-sm">
              Ask about any resident's recent care logs — mood, meals, vitals, or
              staff notes — and I'll summarize what stands out.
            </p>

            <div className="w-full max-w-xl">
              <ChatInput
                value={input}
                onChange={(v) => {
                  setInput(v);
                  autoResize();
                }}
                onSend={handleSend}
                onKeyDown={handleKeyDown}
                textareaRef={textareaRef}
                loading={loading}
              />
            </div>

            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center mt-4 max-w-xl">
                {suggestions.map((name) => (
                  <button
                    key={name}
                    onClick={() => setInput(`How has ${name} been doing recently?`)}
                    className="text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-full px-3 py-1.5 hover:border-indigo-300 hover:text-indigo-700 transition"
                  >
                    How is {name} doing?
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Message list */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
                {activeSession!.messages.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[80%] bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-4 h-4 text-white" />
                      </div>
                      <div className="max-w-[80%] bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap shadow-sm">
                        {m.content}
                      </div>
                    </div>
                  )
                )}

                {loading && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                    <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />
                      <span className="text-sm text-slate-500">Thinking…</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Input bar, pinned to bottom */}
            <div className="border-t border-slate-200 bg-white/80 backdrop-blur-sm px-4 sm:px-6 py-4">
              <div className="max-w-3xl mx-auto">
                <ChatInput
                  value={input}
                  onChange={(v) => {
                    setInput(v);
                    autoResize();
                  }}
                  onSend={handleSend}
                  onKeyDown={handleKeyDown}
                  textareaRef={textareaRef}
                  loading={loading}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ChatInput({
  value,
  onChange,
  onSend,
  onKeyDown,
  textareaRef,
  loading,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  loading: boolean;
}) {
  return (
    <div className="flex items-end gap-2 bg-white border border-slate-200 rounded-2xl px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-indigo-200 focus-within:border-indigo-300">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask about a resident's recent care logs..."
        rows={1}
        className="flex-1 resize-none bg-transparent outline-none text-sm text-slate-800 placeholder:text-slate-400 py-1.5 max-h-40"
      />
      <button
        onClick={onSend}
        disabled={!value.trim() || loading}
        className="shrink-0 w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center disabled:opacity-40 hover:bg-indigo-700 transition"
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  );
}