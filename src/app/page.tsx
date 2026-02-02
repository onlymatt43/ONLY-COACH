"use client";
import { useState, useEffect, useRef } from "react";

type Project = { id: string; name: string; url: string };

export default function Home() {
  const [input, setInput] = useState("");
  const [chat, setChat] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<string>("UNKNOWN");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projName, setProjName] = useState("");
  const [projUrl, setProjUrl] = useState("");

  // Charger l'historique au démarrage
  useEffect(() => {
    // status
    fetch('/api/status')
      .then((res) => res.json())
      .then((s) => setDbStatus((s.db || 'UNKNOWN').toUpperCase()))
      .catch(() => setDbStatus('UNKNOWN'));

    fetch('/api/chat')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setChat(data);
          setErrorMsg(null);
        } else {
          console.warn('Unexpected history payload', data);
          setChat([]);
          if (data.error) setErrorMsg(`${data.error}: ${data.details || ''}`);
        }
      })
      .catch((error) => {
        console.error('Failed to load history', error);
        setChat([]);
        setErrorMsg(`Connection Failed: ${String(error)}`);
      });
    // load shortcuts from localStorage
    try {
      const raw = localStorage.getItem('om43:projects');
      if (raw) setProjects(JSON.parse(raw));
    } catch (e) {
      console.warn('Failed to read projects from localStorage', e);
    }
  }, []);

  // Scroll automatique vers le bas
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { role: 'user', content: input };
    setChat((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      if (data && data.role && data.content) {
        setChat((prev) => [...prev, data]);
      } else {
        console.warn('Unexpected chat payload', data);
      }
    } catch (error) {
      console.error('Failed to send message', error);
    }
    setLoading(false);
  };

  // Projects helpers
  useEffect(() => {
    try {
      localStorage.setItem('om43:projects', JSON.stringify(projects));
    } catch (e) {
      console.warn('Failed to save projects', e);
    }
  }, [projects]);

  const addProject = (e?: React.FormEvent) => {
    e?.preventDefault();
    const name = projName.trim();
    const url = projUrl.trim();
    if (!name || !url) return;
    setProjects((p) => [{ id: String(Date.now()), name, url }, ...p]);
    setProjName('');
    setProjUrl('');
  };

  const removeProject = (id: string) => {
    setProjects((p) => p.filter((x) => x.id !== id));
  };

  return (
    <main className="flex flex-col h-screen bg-[#050a0a] text-gray-200 font-mono">
      {/* Sidebar: projets */}
      <aside className="hidden md:flex flex-col w-64 p-4 gap-4 border-r border-[#0f2222] fixed left-0 top-0 bottom-0 bg-[#041010]/50 backdrop-blur z-20">
        <h2 className="text-sm text-gray-300 uppercase tracking-wider">Projets</h2>
        <div className="flex-1 overflow-y-auto space-y-2">
          {projects.length === 0 && (
            <div className="text-xs text-gray-500">Aucun projet — ajoute un raccourci.</div>
          )}
          {projects.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <a href={p.url} target="_blank" rel="noreferrer" className="flex-1 text-sm text-[#BFDCDC] hover:underline truncate">
                {p.name}
              </a>
              <button onClick={() => removeProject(p.id)} className="text-xs text-red-400 px-2 py-1 rounded border border-red-600/30 hover:bg-red-600/10">
                ×
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={addProject} className="pt-2 border-t border-[#072020]">
          <input value={projName} onChange={(e) => setProjName(e.target.value)} placeholder="Nom" className="w-full mb-2 p-2 rounded bg-[#071616] text-sm" />
          <input value={projUrl} onChange={(e) => setProjUrl(e.target.value)} placeholder="URL (https://...)" className="w-full mb-2 p-2 rounded bg-[#071616] text-sm" />
          <div className="flex gap-2">
            <button type="submit" className="flex-1 text-xs bg-[#0f6b5a] px-2 py-2 rounded">Ajouter</button>
            <button type="button" onClick={() => { setProjName(''); setProjUrl(''); }} className="text-xs px-2 py-2 rounded border border-[#0f6b5a]">Clear</button>
          </div>
        </form>
      </aside>
      {/* Header Techno */}
      <div className="p-6 border-b border-[#1a2e2e] bg-[#050a0a]/90 backdrop-blur fixed w-full z-10 flex justify-between items-center">
        <h1 className="text-xl tracking-widest text-[#FFD700] uppercase font-bold">
          System <span className="text-gray-600">///</span> OM43
        </h1>
        <div className="flex gap-2 text-xs text-[#004d40]">
          <span className="border border-[#004d40] px-2 py-1 rounded">DB: {dbStatus}</span>
          <span className="border border-[#004d40] px-2 py-1 rounded">AI: CONNECTED</span>
        </div>
      </div>

      {/* Zone de Chat */}
      <div className="flex-1 overflow-y-auto p-6 pt-24 pb-32 space-y-6 md:pl-80">
        {errorMsg && (
          <div className="mx-auto max-w-2xl p-4 bg-red-900/20 border border-red-500/50 rounded text-red-200 text-sm font-mono">
            <h3 className="font-bold mb-2">SYSTEM ALERT</h3>
            <p>{errorMsg}</p>
            <p className="mt-2 text-xs opacity-70">Check Vercel Environment Variables (TURSO_AUTH_TOKEN)</p>
          </div>
        )}
        {chat.length === 0 && !loading && !errorMsg && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-600 text-sm space-y-4">
            <p className="uppercase tracking-widest">System Online</p>
            <p>Commencez la conversation ou ajoutez un projet via la barre latérale.</p>
          </div>
        )}
        {chat.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] p-4 rounded-lg backdrop-blur-md border ${
                msg.role === 'user'
                  ? 'bg-[#1a2e2e]/40 border-[#FFD700]/20 text-[#FFD700] rounded-br-none'
                  : 'bg-black/40 border-gray-800 text-gray-300 rounded-bl-none shadow-[0_0_15px_rgba(0,0,0,0.5)]'
              }`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start animate-pulse">
            <div className="bg-black/40 border border-gray-800 p-3 rounded text-xs text-gray-500">
              PROCESSING DATA STREAM...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div className="fixed bottom-0 w-full bg-[#050a0a] p-6 border-t border-[#1a2e2e]">
        <form onSubmit={sendMessage} className="relative max-w-4xl mx-auto flex gap-4">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ENTER COMMAND..."
            className="w-full bg-[#0a1414] border border-[#1a2e2e] rounded p-4 text-[#FFD700] focus:outline-none focus:border-[#FFD700] focus:ring-1 focus:ring-[#FFD700] transition-all placeholder-gray-700"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-8 bg-[#FFD700] text-black font-bold rounded hover:bg-[#e6c200] disabled:opacity-50 transition-colors uppercase tracking-wider"
          >
            Send
          </button>
        </form>
      </div>
    </main>
  );
}
