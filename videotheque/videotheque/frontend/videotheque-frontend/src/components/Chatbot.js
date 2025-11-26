import React, { useState } from 'react';

const Chatbot = () => {
  const [messages, setMessages] = useState([{ from: 'bot', text: 'Salut, je suis là pour t’aider 💬' }]);
  const [input, setInput] = useState('');

  const handleSend = async () => {
    const newMessages = [...messages, { from: 'user', text: input }];

    // Appel fictif à ton backend ou à une API IA
    const response = await fetch('http://localhost:3001/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input }),
    });

    const data = await response.json();

    setMessages([...newMessages, { from: 'bot', text: data.reply }]);
    setInput('');
  };

  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, width: 300, background: '#eee', padding: 10 }}>
      <h4>Assistant IA</h4>
      <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 10 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ textAlign: msg.from === 'bot' ? 'left' : 'right' }}>
            <p><strong>{msg.from === 'bot' ? '🤖' : '👤'}:</strong> {msg.text}</p>
          </div>
        ))}
      </div>
      <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Pose une question..." />
      <button onClick={handleSend}>Envoyer</button>
    </div>
  );
};

export default Chatbot;