"use client";
import { useEffect, useRef, useState } from "react";

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
type Category = { id: number; name: string };
type Resource = { id: number; categoryId: number; title: string; url?: string; notes?: string };

export default function Home() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState("UNKNOWN");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [cats, setCats] = useState<Category[]>([]);
  const [activeCat, setActiveCat] = useState<number | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [newCatName, setNewCatName] = useState("");
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [resTitle, setResTitle] = useState("");
  const [resUrl, setResUrl] = useState("");
  const [resNotes, setResNotes] = useState("");

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

  // Load categories/resources and seed "VIDEOTHEQUE" if empty
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch('/api/categories');
        const list: Category[] = await r.json();
        if (Array.isArray(list) && list.length > 0) {
          setCats(list);
          setActiveCat(list[0].id);
        } else {
          const created = await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'VIDEOTHEQUE' }) });
          const cat = await created.json();
          setCats([cat]);
          setActiveCat(cat.id);
        }
      } catch (e) {
        console.error('Failed to load categories', e);
      }
    };
    load();
  }, []);

  useEffect(() => {
    const loadRes = async () => {
      if (!activeCat) return;
      try {
        const r = await fetch(`/api/resources?categoryId=${activeCat}`);
        const list: Resource[] = await r.json();
        setResources(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error('Failed to load resources', e);
      }
    };
    loadRes();
  }, [activeCat]);

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

      {/* Categories */}
      <section className="mx-auto max-w-3xl px-4 pt-4">
        <div className="flex items-center gap-2 overflow-x-auto">
          {cats.map((c) => (
            <div key={c.id} className="flex items-center gap-1">
              {editingCatId === c.id ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const name = editingCatName.trim();
                    if (!name) { setEditingCatId(null); return; }
                    await fetch('/api/categories', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, name }) });
                    setCats((arr) => arr.map((x) => x.id === c.id ? { ...x, name } : x));
                    setEditingCatId(null);
                  }}
                  className="flex items-center gap-1"
                >
                  <input autoFocus value={editingCatName} onChange={(e) => setEditingCatName(e.target.value)} className="px-2 py-2 text-xs rounded border border-slate-700 bg-slate-900" />
                  <button className="px-2 py-2 text-xs rounded bg-emerald-600 text-white">OK</button>
                </form>
              ) : (
                <button onClick={() => setActiveCat(c.id)} className={`px-3 py-2 rounded border text-xs ${activeCat === c.id ? 'border-yellow-400 text-yellow-300' : 'border-slate-700 text-slate-300'} bg-slate-900`}>
                  {c.name}
                </button>
              )}
              {editingCatId !== c.id && (
                <button
                  onClick={() => { setEditingCatId(c.id); setEditingCatName(c.name); }}
                  className="px-2 py-2 text-xs rounded border border-slate-700 text-slate-300"
                >Renommer</button>
              )}
              <button
                onClick={async () => {
                  if (!confirm(`Supprimer la catégorie "${c.name}" ?`)) return;
                  await fetch('/api/categories', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id }) });
                  setCats((arr) => arr.filter((x) => x.id !== c.id));
                  if (activeCat === c.id) setActiveCat(cats.length ? cats[0]?.id ?? null : null);
                }}
                className="px-2 py-2 text-xs rounded border border-red-700 text-red-500"
              >Supprimer</button>
            </div>
          ))}
          <form onSubmit={async (e) => { e.preventDefault(); const name = newCatName.trim(); if (!name) return; const r = await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); const cat = await r.json(); setCats((x) => [...x, cat]); setNewCatName(''); }} className="flex items-center gap-2">
            <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="Nouvelle catégorie" className="px-2 py-2 text-xs rounded border border-slate-700 bg-slate-900" />
            <button className="px-2 py-2 text-xs rounded bg-emerald-600 text-white">Ajouter</button>
          </form>
        </div>
      </section>

      {/* Resources */}
      <section className="mx-auto max-w-3xl px-4 pt-4">
        <h2 className="text-sm text-slate-300 mb-2">Ressources {activeCat ? `(#${activeCat})` : ''}</h2>
        <div className="space-y-2">
          {resources.length === 0 ? (
            <div className="text-xs text-slate-400">Aucune ressource — ajoutez un lien ci-dessous.</div>
          ) : (
            resources.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900 px-3 py-2">
                <a href={r.url || '#'} target="_blank" rel="noreferrer" className="flex-1">
                  <div className="text-sm text-slate-200">{r.title}</div>
                  {r.url && <div className="text-xs text-slate-400 truncate">{r.url}</div>}
                  {r.notes && <div className="text-xs text-slate-500 mt-1">{r.notes}</div>}
                </a>
                <button
                  onClick={async () => {
                    await fetch('/api/resources', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id }) });
                    setResources((arr) => arr.filter((x) => x.id !== r.id));
                  }}
                  className="px-2 py-1 text-xs rounded border border-red-700 text-red-500"
                >Supprimer</button>
              </div>
            ))
          )}
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!activeCat) return;
            const payload = { categoryId: activeCat, title: resTitle.trim(), url: resUrl.trim(), notes: resNotes.trim() };
            if (!payload.title) return;
            const r = await fetch('/api/resources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const created = await r.json();
            setResources((x) => [...x, created]);
            setResTitle(''); setResUrl(''); setResNotes('');
          }}
          className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2"
        >
          <input value={resTitle} onChange={(e) => setResTitle(e.target.value)} placeholder="Titre" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
          <input value={resUrl} onChange={(e) => setResUrl(e.target.value)} placeholder="URL (https://...)" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
          <input value={resNotes} onChange={(e) => setResNotes(e.target.value)} placeholder="Notes" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
          <button className="rounded bg-emerald-600 px-3 py-2 text-sm text-white">Ajouter</button>
        </form>
      </section>

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
