const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');
const { CREDIT_COSTS } = require('../config');
const { resolveGeminiKey } = require('./account');
const gemini = require('../lib/gemini');

const router = express.Router();

// POST /api/songwriting  { topic, genre, mood }
// Generates original song lyrics from a topic/genre/mood using an LLM.
router.post('/', async (req, res) => {
  const { topic, genre = 'pop', mood = 'upbeat' } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic is required' });

  // The user's own key takes precedence over the server's (BYOK).
  const geminiKey = resolveGeminiKey(req.user);

  const result = await withFallback({
    hasKey: !!geminiKey,
    user: req.user,
    cost: CREDIT_COSTS.songwriting,
    run: async () => {
      const lyrics = await gemini.generateText(
        geminiKey,
        [
          'You are a professional songwriter. Write original, complete song lyrics',
          'with clear verse/chorus structure. Output only the lyrics, no commentary.',
          '',
          `Write ${genre} song lyrics about "${topic}" with a ${mood} mood.`
        ].join('\n')
      );
      return { lyrics };
    },
    demo: async () => ({
      lyrics: `[Verse 1]\n(Demo lyrics about "${topic}")\nThis is a placeholder verse,\nAdd GEMINI_API_KEY for the real thing.\n\n[Chorus]\nDemo mode, demo mode,\nSubscribe or add credits to unlock the song.`
    })
  });

  res.json({ jobId: newJobId(), topic, genre, mood, ...result });
});

module.exports = router;
