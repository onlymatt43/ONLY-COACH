"use client";
import { useEffect, useRef, useState } from "react";

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

export default function Home() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState("UNKNOWN");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // On mount: fetch status + history and focus input
  useEffect(() => {
    inputRef.current?.focus();

    fetch("/api/status")
      .then((r) => r.json())
      .then((s) => setDbStatus(String(s?.db ?? "UNKNOWN").toUpperCase()))
      .catch(() => setDbStatus("UNKNOWN"));

    fetch("/api/chat")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setMessages(data as ChatMsg[]);
          setError(null);
        } else {
          setMessages([]);
          setError(data?.error ? `${data.error}${data.details ? `: ${data.details}` : ""}` : null);
        }
      })
      .catch((e) => setError(`History error: ${String(e)}`));
  }, []);

  // Autoscroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    setLoading(true);
    const userMsg: ChatMsg = { role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text })
      });
      const data = await res.json();
      if (res.ok && data?.content) {
        setMessages((m) => [...m, { role: data.role ?? "assistant", content: String(data.content) }]);
      } else {
        setError(data?.error ? `${data.error}${data.details ? `: ${data.details}` : ""}` : `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(`Send failed: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <h1 className="font-semibold tracking-widest text-yellow-400">SYSTEM /// OM43</h1>
          <div className="text-xs text-emerald-300/80">DB: {dbStatus}</div>
        </div>
      </header>

      {/* Messages */}
      <div className="mx-auto max-w-3xl px-4 pt-6 pb-40 space-y-4">
        {error && (
          <div className="rounded border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {messages.length === 0 && !error && (
          <div className="rounded border border-slate-800 bg-slate-900/40 px-6 py-12 text-center">
            <div className="mb-2 text-yellow-300">System online</div>
            <div className="text-slate-400 text-sm">Start chatting below.</div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`${m.role === "user" ? "bg-emerald-900/30 border-emerald-700/40" : "bg-slate-900/60 border-slate-700/60"} border rounded px-4 py-3 max-w-[80%]`}> 
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="text-xs text-slate-400">Processing…</div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-800 bg-slate-950/95">
        <form onSubmit={onSubmit} className="mx-auto max-w-3xl px-4 py-3 flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message…"
            className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-3 text-sm outline-none focus:border-yellow-400"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-yellow-400 px-4 py-3 text-black text-sm font-semibold disabled:opacity-60"
          >
            Send
          </button>
        </form>
      </div>
    </main>
  );
}
