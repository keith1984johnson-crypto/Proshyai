const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');

const router = express.Router();

// POST /api/music  { prompt, genre, durationSeconds, instrumental }
router.post('/', async (req, res) => {
  const { prompt, genre = 'cinematic', durationSeconds = 30, instrumental = false } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const hasKey = !!process.env.SUNO_API_KEY || !!process.env.STABILITY_AUDIO_KEY;

  const result = await withFallback({
    hasKey,
    canUseRealGeneration: req.canUseRealGeneration,
    run: async () => {
      // Example using Stability AI's audio generation endpoint
      const r = await fetch('https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.STABILITY_AUDIO_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          prompt: `${genre} track: ${prompt}${instrumental ? ', instrumental only' : ''}`,
          duration: durationSeconds
        })
      });
      if (!r.ok) throw new Error(`Stability Audio error ${r.status}: ${await r.text()}`);
      const buffer = await r.buffer();
      const audioBase64 = `data:audio/mpeg;base64,${buffer.toString('base64')}`;
      return { audioUrl: audioBase64 };
    },
    demo: async () => ({
      audioUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3'
    })
  });

  res.json({ jobId: newJobId(), prompt, genre, durationSeconds, instrumental, ...result });
});

module.exports = router;
