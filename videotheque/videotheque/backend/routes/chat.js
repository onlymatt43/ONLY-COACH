const express = require('express');
const router = express.Router();
require('dotenv').config();

// If OPENAI_API_KEY exists and the openai package is installed we'll attempt a chat completion
let OpenAIClient = null;
try {
  // require only if available — allows the server to run without the dependency installed
  const { OpenAI } = require('openai');
  if (process.env.OPENAI_API_KEY) {
    OpenAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
} catch (e) {
  // openai package not installed or other error — we'll fallback to placeholder reply.
  console.warn('OpenAI client not available (openai package missing or configured). Falling back to simple reply.');
}

router.post('/chat', async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ reply: 'Message manquant.' });

  if (OpenAIClient) {
    try {
      // use chat completions via the OpenAI client if available
      const completion = await OpenAIClient.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: "Tu es un assistant sensible, curieux et respectueux qui aide à explorer la sexualité consciente et artistique.",
          },
          { role: 'user', content: message },
        ],
        temperature: 0.7,
      });

      const reply = completion?.choices?.[0]?.message?.content || "Désolé, aucune réponse disponible.";
      return res.json({ reply });
    } catch (err) {
      console.error('OpenAI call failed, returning fallback:', err?.message || err);
      return res.status(500).json({ reply: "Erreur côté IA — essaie plus tard." });
    }
  }

  // fallback behaviour when OpenAI isn't configured — simple canned response
  return res.json({ reply: "L'IA n'est pas encore connectée. (fichier de secours)" });
});

module.exports = router;