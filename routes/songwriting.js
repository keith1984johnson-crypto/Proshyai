const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');
const { CREDIT_COSTS } = require('../config');
const { resolveOpenAIKey } = require('./account');

const router = express.Router();

// POST /api/songwriting  { topic, genre, mood }
// Generates original song lyrics from a topic/genre/mood using an LLM.
router.post('/', async (req, res) => {
  const { topic, genre = 'pop', mood = 'upbeat' } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic is required' });

  // The user's own key takes precedence over the server's (BYOK).
  const openaiKey = resolveOpenAIKey(req.user);

  const result = await withFallback({
    hasKey: !!openaiKey,
    user: req.user,
    cost: CREDIT_COSTS.songwriting,
    run: async () => {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a professional songwriter. Write original, complete song lyrics with clear verse/chorus structure. Output only the lyrics, no commentary.' },
            { role: 'user', content: `Write ${genre} song lyrics about "${topic}" with a ${mood} mood.` }
          ],
          temperature: 0.9
        })
      });
      if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${await r.text()}`);
      const data = await r.json();
      return { lyrics: data.choices?.[0]?.message?.content || '' };
    },
    demo: async () => ({
      lyrics: `[Verse 1]\n(Demo lyrics about "${topic}")\nThis is a placeholder verse,\nAdd OPENAI_API_KEY for the real thing.\n\n[Chorus]\nDemo mode, demo mode,\nSubscribe or add credits to unlock the song.`
    })
  });

  res.json({ jobId: newJobId(), topic, genre, mood, ...result });
});

module.exports = router;
