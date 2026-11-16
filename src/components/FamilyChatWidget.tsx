"use client";

/**
 * Small chat assistant for the family portal. It answers questions about
 * ONE resident only, using /api/family-chat (which checks on the server
 * that the signed-in family member is linked to this resident).
 *
 * The conversation is kept in memory only. Nothing is saved in the browser.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircleHeart, Send, X } from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };

export default function FamilyChatWidget({
  residentId,
  residentFirstName,
}: {
  residentId: string;
  residentFirstName: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const suggestions = [
    `How has ${residentFirstName} been eating this week?`,
    `Is ${residentFirstName} drinking enough water?`,
    `How was ${residentFirstName}'s mood today?`,
    `${residentFirstName} की दवाइयाँ समय पर दी गईं?`,
  ];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || sending) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/family-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId, messages: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setMessages([...next, { role: "assistant", content: json.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-[#357366] hover:bg-[#2b5e53] text-white px-4 py-3 shadow-lg shadow-[#357366]/30 text-sm font-semibold"
      >
        <MessageCircleHeart className="w-5 h-5" />
        Ask about {residentFirstName}
      </button>
    );
  }

  return (
    <div
      className="fixed z-40 bottom-0 right-0 sm:bottom-5 sm:right-5 w-full sm:w-[380px] h-[75vh] sm:h-[560px] bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl border border-gray-100 flex flex-col"
      role="dialog"
      aria-label={`Ask about ${residentFirstName}`}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <div className="p-1.5 rounded-lg bg-[#EAF4F1] text-[#357366]">
          <MessageCircleHeart className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-sm text-gray-900">Ask about {residentFirstName}</p>
          <p className="text-[11px] text-gray-500">Answers come from the care team&apos;s records</p>
        </div>
        <button onClick={() => setOpen(false)} className="ml-auto text-gray-400 hover:text-gray-600" aria-label="Close chat">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-[#FAFAF8]">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">
              Namaste! Ask me how {residentFirstName} has been: meals, water, mood, medicines or the
              care team&apos;s notes from the last 7 days. You can write in Hindi, English or your own language.
            </p>
            <div className="flex flex-col gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left text-xs bg-white border border-gray-200 hover:border-[#4F9C8B] rounded-xl px-3 py-2 text-gray-700"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-[#357366] text-white rounded-br-sm"
                  : "bg-white border border-gray-100 text-gray-800 rounded-bl-sm"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking the care records…
          </div>
        )}
        {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div ref={endRef} />
      </div>

      <form
        className="border-t border-gray-100 p-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${residentFirstName}…`}
          maxLength={500}
          className="flex-1 text-sm px-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#4F9C8B]"
          aria-label="Your question"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="p-2.5 rounded-xl bg-[#357366] text-white disabled:opacity-40"
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
      <p className="px-4 pb-3 text-[10px] text-gray-400">
        Not medical advice. For health concerns or emergencies, please call the care home.
      </p>
    </div>
  );
}
