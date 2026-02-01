'use client';
import { useState, useEffect, useRef } from 'react';

export default function Home() {
  const [input, setInput] = useState('');
  const [chat, setChat] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<string>('UNKNOWN');
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
        } else {
          console.warn('Unexpected history payload', data);
          setChat([]);
        }
      })
      .catch((error) => {
        console.error('Failed to load history', error);
        setChat([]);
      });
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

  return (
    <main className="flex flex-col h-screen bg-[#050a0a] text-gray-200 font-mono">
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
      <div className="flex-1 overflow-y-auto p-6 pt-24 pb-32 space-y-6">
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
