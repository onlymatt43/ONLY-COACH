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
  const [showChat, setShowChat] = useState(false);

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
            <button onClick={() => setShowChat((s) => !s)} className="rounded px-3 py-2 text-xs border border-slate-700 bg-slate-900 hover:border-yellow-400 hover:text-yellow-300">{showChat ? 'Hide Chat' : 'Show Chat'}</button>
            <span className="text-xs text-emerald-300/80">DB: {dbStatus}</span>
          </div>
        </div>
      </header>

      {/* Content layout */}
      <div className="mx-auto max-w-6xl px-6 py-6 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
        {/* Sidebar: Categories */}
        <aside className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm text-slate-300">Categories</h2>
          </div>
          <div className="space-y-2">
            {cats.map((c) => (
              <div key={c.id} className={`flex items-center gap-2 rounded px-2 py-2 ${activeCat === c.id ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`}>
                <button onClick={() => setActiveCat(c.id)} className="flex-1 text-left text-sm text-slate-200">{c.name}</button>
                <button onClick={() => { setEditingCatId(c.id); setEditingCatName(c.name); }} className="text-xs px-2 py-1 rounded border border-slate-700">Edit</button>
                <button onClick={async () => { if (!confirm(`Delete ${c.name}?`)) return; await fetch('/api/categories', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id }) }); setCats((arr) => arr.filter((x) => x.id !== c.id)); if (activeCat === c.id) setActiveCat(cats[0]?.id ?? null); }} className="text-xs px-2 py-1 rounded border border-red-700 text-red-400">Del</button>
              </div>
            ))}
            {editingCatId && (
              <form onSubmit={async (e) => { e.preventDefault(); const name = editingCatName.trim(); if (!name) { setEditingCatId(null); return; } await fetch('/api/categories', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingCatId, name }) }); setCats((arr) => arr.map((x) => x.id === editingCatId ? { ...x, name } : x)); setEditingCatId(null); }} className="flex items-center gap-2">
                <input autoFocus value={editingCatName} onChange={(e) => setEditingCatName(e.target.value)} className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs" />
                <button className="text-xs rounded bg-emerald-600 px-2 py-2 text-white">OK</button>
              </form>
            )}
            <form onSubmit={async (e) => { e.preventDefault(); const name = newCatName.trim(); if (!name) return; const r = await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); const cat = await r.json(); setCats((x) => [...x, cat]); setNewCatName(''); }} className="flex items-center gap-2 pt-2 border-t border-slate-800 mt-2">
              <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="New category" className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs" />
              <button className="text-xs rounded bg-emerald-600 px-3 py-2 text-white">Add</button>
            </form>
          </div>
          {/* Env presence small card */}
          <div className="mt-6 rounded border border-slate-800 bg-slate-900/60 p-3">
            <h3 className="text-xs text-slate-400 mb-2">Environment Index</h3>
            <div className="space-y-1 max-h-40 overflow-auto">
              {envItems.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 truncate mr-2">{e.name}</span>
                  <span className={`px-2 py-0.5 rounded border ${envPresence[e.name] ? 'border-emerald-700 text-emerald-400' : 'border-slate-700 text-slate-400'}`}>{envPresence[e.name] ? 'Present' : 'Absent'}</span>
                </div>
              ))}
              {envItems.length === 0 && <div className="text-xs text-slate-500">No entries</div>}
            </div>
          </div>
        </aside>

        {/* Main: Resources + Uploads */}
        <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm text-slate-300">Resources {activeCat ? `(#${activeCat})` : ''}</h2>
            <div className="text-xs text-slate-400">Total: {resTotal}</div>
          </div>
          <div className="flex items-center gap-2 mb-4">
            <input value={resQuery} onChange={(e) => { setResQuery(e.target.value); setResOffset(0); }} placeholder="Search (title, URL, notes)" className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
            <select value={resLimit} onChange={(e) => { setResLimit(Number(e.target.value)); setResOffset(0); }} className="px-2 py-2 text-xs rounded border border-slate-700 bg-slate-900 text-slate-300">
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {resources.length === 0 ? (
              <div className="col-span-full text-xs text-slate-400">No resources yet.</div>
            ) : (
              resources.map((r) => (
                <div key={r.id} className="rounded border border-slate-800 bg-slate-950/60 p-3">
                  <a href={r.url || '#'} target="_blank" rel="noreferrer" className="block">
                    <div className="text-sm text-slate-200">{r.title}</div>
                    {r.url && <div className="text-xs text-slate-400 truncate">{r.url}</div>}
                    {r.notes && <div className="text-xs text-slate-500 mt-1">{r.notes}</div>}
                  </a>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={async () => { await fetch('/api/resources', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id }) }); setResources((arr) => arr.filter((x) => x.id !== r.id)); }}
                      className="text-xs px-2 py-1 rounded border border-red-700 text-red-400"
                    >Delete</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={async (e) => {
              e.preventDefault(); setIsDragging(false);
              if (!activeCat) return;
              const files = Array.from(e.dataTransfer.files || []);
              if (files.length === 0) return;
              setUploading(true); setUploadMsg(`Uploading ${files.length} files...`);
              try {
                for (const f of files) {
                  const fd = new FormData(); fd.append('file', f); fd.append('category', String(activeCat));
                  const up = await fetch('/api/upload', { method: 'POST', body: fd });
                  const upData = await up.json();
                  if (up.ok && upData?.url) {
                    const r = await fetch('/api/resources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: activeCat, title: f.name, url: upData.url }) });
                    const created = await r.json();
                    setResources((x) => [...x, created]);
                  }
                }
                setUploadMsg('Upload complete');
              } catch (err) {
                setUploadMsg(`Upload error: ${String(err)}`);
              } finally {
                setUploading(false);
                setTimeout(() => setUploadMsg(''), 2500);
              }
            }}
            className={`mt-4 rounded-lg border-2 ${isDragging ? 'border-yellow-400 bg-yellow-400/10' : 'border-dashed border-slate-700 bg-slate-900/60'} px-4 py-8 text-xs text-slate-400 text-center`}
          >
            Drag & drop files here to upload
            {uploading && <div className="mt-2 text-slate-300">{uploadMsg}</div>}
          </div>

          {/* Add resource form */}
          <form onSubmit={async (e) => { e.preventDefault(); if (!activeCat) return; const title = resTitle.trim(); if (!title) return; let finalUrl = resUrl.trim(); if (uploadFile) { const fd = new FormData(); fd.append('file', uploadFile); fd.append('category', String(activeCat)); const up = await fetch('/api/upload', { method: 'POST', body: fd }); const upData = await up.json(); if (up.ok && upData?.url) finalUrl = upData.url; } const payload = { categoryId: activeCat, title, url: finalUrl || undefined, notes: resNotes.trim() }; const r = await fetch('/api/resources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const created = await r.json(); setResources((x) => [...x, created]); setResTitle(''); setResUrl(''); setResNotes(''); setUploadFile(null); }} className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-2">
            <input value={resTitle} onChange={(e) => setResTitle(e.target.value)} placeholder="Title" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
            <input value={resUrl} onChange={(e) => setResUrl(e.target.value)} placeholder="URL (https://...)" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
            <input type="file" multiple onChange={(e) => { const files = e.target.files; if (files && files.length > 1) { (async () => { if (!activeCat) return; setUploading(true); setUploadMsg(`Uploading ${files.length} files...`); try { for (const f of Array.from(files)) { const fd = new FormData(); fd.append('file', f); fd.append('category', String(activeCat)); const up = await fetch('/api/upload', { method: 'POST', body: fd }); const upData = await up.json(); if (up.ok && upData?.url) { const r = await fetch('/api/resources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: activeCat, title: f.name, url: upData.url }) }); const created = await r.json(); setResources((x) => [...x, created]); } } setUploadMsg('Upload complete'); } catch (err) { setUploadMsg(`Upload error: ${String(err)}`); } finally { setUploading(false); setTimeout(() => setUploadMsg(''), 2500); } })(); e.target.value = ''; } else { setUploadFile(files?.[0] || null); } }} className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
            <input value={resNotes} onChange={(e) => setResNotes(e.target.value)} placeholder="Notes" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
            <button className="md:col-span-4 rounded bg-emerald-600 px-3 py-2 text-sm text-white">Add</button>
          </form>

          {/* Pager */}
          <div className="mt-4 flex items-center gap-2">
            <button disabled={resOffset === 0} onClick={() => setResOffset((o) => Math.max(0, o - resLimit))} className="px-3 py-2 text-xs rounded border border-slate-700 text-slate-300 disabled:opacity-50">Prev</button>
            <button disabled={resOffset + resLimit >= resTotal} onClick={() => setResOffset((o) => o + resLimit)} className="px-3 py-2 text-xs rounded border border-slate-700 text-slate-300 disabled:opacity-50">Next</button>
          </div>
        </section>
      </div>

      {/* Chat section (toggle) */}
      {showChat && (
        <div className="mx-auto max-w-6xl px-6 pt-4 pb-40 space-y-4">
          {error && (<div className="rounded border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-200">{error}</div>)}
          {messages.length === 0 && !error && (<div className="rounded border border-slate-800 bg-slate-900/40 px-6 py-12 text-center"><div className="mb-2 text-yellow-300">System online</div><div className="text-slate-400 text-sm">Start chatting below.</div></div>)}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`${m.role === 'user' ? 'bg-emerald-900/30 border-emerald-700/40' : 'bg-slate-900/60 border-slate-700/60'} border rounded px-4 py-3 max-w-[80%]`}>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
              </div>
            </div>
          ))}
          {loading && (<div className="text-xs text-slate-400">Processing…</div>)}
          <div ref={endRef} />
        </div>
      )}

      {/* Composer */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-800 bg-slate-950/95">
        <form onSubmit={onSubmit} className="mx-auto max-w-6xl px-6 py-4 flex gap-3">
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message…" className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm outline-none focus:border-yellow-400" />
          <button type="submit" disabled={loading} className="rounded-lg bg-yellow-400 px-5 py-3 text-black text-sm font-semibold disabled:opacity-60">Send</button>
        </form>
      </div>
    </main>
  );
}
                    const up = await fetch('/api/upload', { method: 'POST', body: fd });
                    const upData = await up.json();
                    if (up.ok && upData?.url) {
                      const r = await fetch('/api/resources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: activeCat, title: f.name, url: upData.url }) });
                      const created = await r.json();
                      setResources((x) => [...x, created]);
                    }
                  }
                  setUploadMsg('Upload terminé');
                } catch (err) {
                  setUploadMsg(`Erreur d\u2019upload: ${String(err)}`);
                } finally {
                  setUploading(false);
                  setTimeout(() => setUploadMsg(''), 2500);
                }
              })();
              e.target.value = '';
            } else {
              setUploadFile(files?.[0] || null);
            }
          }} className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
          <input value={resNotes} onChange={(e) => setResNotes(e.target.value)} placeholder="Notes" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
          <button className="rounded bg-emerald-600 px-3 py-2 text-sm text-white">Ajouter</button>
        </form>

        <div className="mt-3 flex items-center gap-2">
          <button disabled={resOffset === 0} onClick={() => setResOffset((o) => Math.max(0, o - resLimit))} className="px-3 py-2 text-xs rounded border border-slate-700 text-slate-300 disabled:opacity-50">Précédent</button>
          <button disabled={resOffset + resLimit >= resTotal} onClick={() => setResOffset((o) => o + resLimit)} className="px-3 py-2 text-xs rounded border border-slate-700 text-slate-300 disabled:opacity-50">Suivant</button>
          <select value={resLimit} onChange={(e) => { setResLimit(Number(e.target.value)); setResOffset(0); }} className="px-2 py-2 text-xs rounded border border-slate-700 bg-slate-900 text-slate-300">
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </div>
      </section>

      {/* Environment Index (metadata only) */}
      <section className="mx-auto max-w-3xl px-4 pt-6">
        <h2 className="text-sm text-slate-300 mb-2">Environnements (index sécurisé)</h2>
        <div className="space-y-2">
          {envItems.length === 0 ? (
            <div className="text-xs text-slate-400">Aucune entrée — ajoutez des noms de variables (pas de valeurs).</div>
          ) : (
            envItems.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900 px-3 py-2">
                <div className="flex-1">
                  <div className="text-sm text-slate-200">{e.name}</div>
                  <div className="text-xs text-slate-500">{e.service || '—'} · {e.location || '—'} · {e.description || ''}</div>
                </div>
                <span className={`text-xs px-2 py-1 rounded border ${envPresence[e.name] ? 'border-emerald-700 text-emerald-400' : 'border-slate-700 text-slate-400'}`}>{envPresence[e.name] ? 'Présent' : 'Absent'}</span>
                <button
                  onClick={async () => {
                    await fetch('/api/env', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id }) });
                    setEnvItems((arr) => arr.filter((x) => x.id !== e.id));
                  }}
                  className="px-2 py-1 text-xs rounded border border-red-700 text-red-500"
                >Supprimer</button>
              </div>
            ))
          )}
        </div>
        <form
          onSubmit={async (ev) => {
            ev.preventDefault();
            const name = newEnvName.trim(); if (!name) return;
            const r = await fetch('/api/env', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, service: newEnvService || undefined, description: newEnvDesc || undefined, location: newEnvLoc || undefined }) });
            const created = await r.json();
            setEnvItems((x) => [...x, created]);
            setNewEnvName(''); setNewEnvService(''); setNewEnvDesc('');
          }}
          className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2"
        >
          <input value={newEnvName} onChange={(e) => setNewEnvName(e.target.value)} placeholder="Nom de la variable (ex: OPENAI_API_KEY)" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
          <input value={newEnvService} onChange={(e) => setNewEnvService(e.target.value)} placeholder="Service" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
          <input value={newEnvDesc} onChange={(e) => setNewEnvDesc(e.target.value)} placeholder="Description" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
          <input value={newEnvLoc} onChange={(e) => setNewEnvLoc(e.target.value)} placeholder="Localisation (ex: vercel:production)" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
          <button className="md:col-span-4 rounded bg-emerald-600 px-3 py-2 text-sm text-white">Ajouter</button>
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
