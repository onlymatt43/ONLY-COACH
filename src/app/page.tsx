"use client";
import { useEffect, useRef, useState } from "react";

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
type Category = { id: number; name: string };
type Resource = { id: number; categoryId: number; title: string; url?: string; notes?: string };
type EnvItem = { id: number; name: string; service?: string; description?: string; location?: string };

export default function Home() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState("UNKNOWN");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showChat, _setShowChat] = useState(false);

  const [cats, setCats] = useState<Category[]>([]);
  const [activeCat, setActiveCat] = useState<number | null>(null);
  const [newCatName, setNewCatName] = useState("");
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editingCatName, setEditingCatName] = useState("");

  const [resources, setResources] = useState<Resource[]>([]);
  const [resQuery, setResQuery] = useState("");
  const [resLimit, setResLimit] = useState(10);
  const [resOffset, setResOffset] = useState(0);
  const [resTotal, setResTotal] = useState(0);

  const [isDragging, setIsDragging] = useState(false);
  const [hoveredCat, setHoveredCat] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const [resTitle, setResTitle] = useState("");
  const [resUrl, setResUrl] = useState("");
  const [resNotes, setResNotes] = useState("");

  const [envItems, setEnvItems] = useState<EnvItem[]>([]);
  const [envPresence, setEnvPresence] = useState<Record<string, boolean>>({});
  const [newEnvName, setNewEnvName] = useState("");
  const [newEnvService, setNewEnvService] = useState("");
  const [newEnvDesc, setNewEnvDesc] = useState("");
  const [newEnvLoc, setNewEnvLoc] = useState("");

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/status");
        const j = await r.json();
        setDbStatus(`${j?.mode ?? ""}`.toUpperCase());
      } catch (e) {
        setDbStatus("UNKNOWN");
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/categories");
        const j = await r.json();
        setCats(Array.isArray(j) ? j : []);
        setActiveCat((prev) => prev ?? (Array.isArray(j) && j[0]?.id ? j[0].id : null));
      } catch (e) {
        setError("Failed to load categories");
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!activeCat) { setResources([]); setResTotal(0); return; }
      const params = new URLSearchParams();
      params.set("categoryId", String(activeCat));
      params.set("limit", String(resLimit));
      params.set("offset", String(resOffset));
      if (resQuery.trim()) params.set("q", resQuery.trim());
      const r = await fetch(`/api/resources?${params.toString()}`);
      const j = await r.json();
      setResources(Array.isArray(j?.items) ? j.items : []);
      setResTotal(Number(j?.total ?? 0));
    })();
  }, [activeCat, resQuery, resLimit, resOffset]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/env");
        const j = await r.json();
        setEnvItems(Array.isArray(j?.items) ? j.items : []);
        setEnvPresence(j?.presence ?? {});
      } catch (e) { /* silent */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/chat");
        const j = await r.json();
        setMessages(Array.isArray(j) ? j : (Array.isArray(j?.messages) ? j.messages : []));
      } catch (e) { /* silent */ }
    })();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = input.trim();
    if (!content) return;
    setLoading(true);
    setMessages((arr) => [...arr, { role: "user", content }]);
    setInput("");
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      const j = await r.json();
      const reply = j?.message?.content ?? j?.assistant?.content ?? j?.content ?? j?.text ?? "";
      setMessages((arr) => [...arr, { role: "assistant", content: String(reply || "OK") }]);
    } catch (err) {
      setError(`Chat error: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function uploadFilesToCategory(catId: number, files: File[] | FileList) {
    const arr = Array.from(files as any as File[]);
    if (arr.length === 0) return;
    setUploading(true);
    setUploadMsg(`Uploading ${arr.length} file(s) to #${catId}...`);
    try {
      let createdCount = 0;
      for (const f of arr) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('category', String(catId));
        const up = await fetch('/api/upload', { method: 'POST', body: fd });
        const upData = await up.json();
        if (up.ok && upData?.url) {
          await fetch('/api/resources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: catId, title: f.name, url: upData.url }) });
          createdCount += 1;
        }
      }
      setMessages((m) => [...m, { role: 'assistant', content: `Upload complete: ${createdCount}/${arr.length} file(s) added to category #${catId}.` }]);
      setUploadMsg('Upload complete');
    } catch (err) {
      setUploadMsg(`Upload error: ${String(err)}`);
      setError(String(err));
    } finally {
      setUploading(false);
      setTimeout(() => setUploadMsg(''), 2500);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-yellow-400" />
            <h1 className="text-lg font-semibold tracking-widest text-yellow-300">ONLY COACH</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-emerald-300/80">DB: {dbStatus}</span>
          </div>
        </div>
      </header>

      {/* Centered chat + project cards */}
      <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col items-center gap-10">
        {/* Chat */}
        <section className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-3 text-center text-sm text-slate-400">Coach is always listening — ask or drop files below.</div>
          <div className="space-y-3 max-h-[55vh] overflow-auto pr-1">
            {error && (<div className="rounded border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-200">{error}</div>)}
            {messages.length === 0 && !error && (
              <div className="rounded border border-slate-800 bg-slate-950/40 px-6 py-10 text-center">
                <div className="mb-2 text-yellow-300">Bienvenue</div>
                <div className="text-slate-400 text-sm">Décrivez ce que vous voulez faire.</div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`${m.role === 'user' ? 'bg-emerald-900/30 border-emerald-700/40' : 'bg-slate-900/60 border-slate-700/60'} border rounded px-4 py-3 max-w-[85%]`}>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
                </div>
              </div>
            ))}
            {loading && (<div className="text-xs text-slate-400">Processing…</div>)}
            <div ref={endRef} />
          </div>
          <form onSubmit={onSubmit} className="mt-4 flex gap-2">
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Parlez à Coach…" className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-yellow-400" />
            <button type="submit" disabled={loading} className="rounded-lg bg-yellow-400 px-4 py-3 text-black text-sm font-semibold disabled:opacity-60">Envoyer</button>
          </form>
        </section>

        {/* Project cards grid */}
        <section className="w-full">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm text-slate-300">Projets</h2>
            <button onClick={async () => { const name = prompt('Nom du projet ?'); const v = (name || '').trim(); if (!v) return; const r = await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: v }) }); const cat = await r.json(); setCats((x) => [...x, cat]); }} className="text-xs rounded border border-slate-700 px-3 py-2 hover:border-yellow-400 hover:text-yellow-300">Nouveau projet</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {cats.map((c) => (
              <div
                key={c.id}
                onDragOver={(e) => { e.preventDefault(); setHoveredCat(c.id); }}
                onDragLeave={() => { if (hoveredCat === c.id) setHoveredCat(null); }}
                onDrop={async (e) => { e.preventDefault(); setHoveredCat(null); const files = Array.from(e.dataTransfer.files || []); if (files.length) await uploadFilesToCategory(c.id, files); }}
                className={`relative rounded-xl border ${hoveredCat === c.id ? 'border-yellow-400 bg-yellow-400/10' : 'border-slate-800 bg-slate-900/60'} p-4 min-h-40 flex flex-col justify-between`}
              >
                <div>
                  <div className="text-sm font-medium text-slate-200">{c.name}</div>
                  <div className="mt-1 text-xs text-slate-400">Déposez des fichiers ici</div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs rounded border border-slate-700 px-3 py-2 cursor-pointer hover:border-yellow-400 hover:text-yellow-300">
                    Upload
                    <input type="file" multiple className="hidden" onChange={async (e) => { const files = e.target.files; if (files && files.length) { await uploadFilesToCategory(c.id, files); e.target.value = ''; } }} />
                  </label>
                  <button onClick={() => setActiveCat(c.id)} className="text-xs rounded border border-slate-700 px-3 py-2 hover:border-slate-600">Ouvrir</button>
                </div>
              </div>
            ))}
            {cats.length === 0 && (
              <div className="col-span-full rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center text-sm text-slate-400">Aucun projet — créez-en un pour commencer.</div>
            )}
          </div>
          {uploading && <div className="mt-3 text-xs text-slate-300">{uploadMsg}</div>}
        </section>
      </div>
    </main>
  );
}

