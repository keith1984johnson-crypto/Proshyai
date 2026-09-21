const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');
const { CREDIT_COSTS } = require('../config');

const router = express.Router();

// POST /api/music  { prompt, lyrics, genre, durationSeconds, instrumental }
// If `lyrics` is provided (e.g. from the songwriting tool), this generates
// a demo recording of that song rather than a purely instrumental track.
router.post('/', async (req, res) => {
  const { prompt, lyrics = '', genre = 'cinematic', durationSeconds = 30, instrumental = false } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const result = await withFallback({
    hasKey: !!process.env.SUNO_API_KEY || !!process.env.STABILITY_AUDIO_KEY,
    user: req.user,
    cost: CREDIT_COSTS.music,
    run: async () => {
      // Example using Stability AI's audio generation endpoint.
      // Swap for Suno's API if you have access — better suited to full songs with vocals.
      const r = await fetch('https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.STABILITY_AUDIO_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          prompt: `${genre} track: ${prompt}${instrumental ? ', instrumental only' : ''}${lyrics ? `. Lyrics: ${lyrics.slice(0, 500)}` : ''}`,
          duration: durationSeconds
        })
      });
      if (!r.ok) throw new Error(`Stability Audio error ${r.status}: ${await r.text()}`);
      const buffer = await r.buffer();
      const audioUrl = `data:audio/mpeg;base64,${buffer.toString('base64')}`;
      return { audioUrl };
    },
    demo: async () => ({
      audioUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3'
    })
  });

  res.json({ jobId: newJobId(), prompt, genre, durationSeconds, instrumental, ...result });
});

module.exports = router;
