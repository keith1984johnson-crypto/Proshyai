const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');
const { CREDIT_COSTS } = require('../config');

const router = express.Router();

// POST /api/music-video  { songPrompt, visualPrompt, lyrics, duration }
// Generates a video sequence styled to match a song/lyrics theme. In a real
// integration this would: 1) generate/receive the audio track, 2) generate
// a matching video, 3) combine them server-side (e.g. with ffmpeg) before
// returning a single file. This scaffold generates the visual half and
// documents where the audio-muxing step plugs in.
router.post('/', async (req, res) => {
  const { songPrompt, visualPrompt, lyrics = '', duration = 30 } = req.body;
  if (!songPrompt || !visualPrompt) {
    return res.status(400).json({ error: 'songPrompt and visualPrompt are required' });
  }

  const result = await withFallback({
    hasKey: !!process.env.RUNWAY_API_KEY || !!process.env.LUMA_API_KEY,
    user: req.user,
    cost: CREDIT_COSTS.musicVideo,
    run: async () => {
      const fullPrompt = `Music video visuals for a song about "${songPrompt}": ${visualPrompt}${lyrics ? `. Thematically matching these lyrics: ${lyrics.slice(0, 300)}` : ''}`;
      const r = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.LUMA_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt, aspect_ratio: '16:9' })
      });
      if (!r.ok) throw new Error(`Luma error ${r.status}: ${await r.text()}`);
      const data = await r.json();
      // NOTE: real production flow — once both the audio (from /api/music)
      // and this video job finish, mux them together (e.g. ffmpeg) and
      // serve the combined file. That combining step isn't included here.
      return { jobId: data.id, status: data.state || 'queued', pollUrl: `/api/music-video/status/${data.id}`, note: 'Video generated; combine with an /api/music track server-side to produce the final music video file.' };
    },
    demo: async () => ({
      status: 'demo-complete',
      videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
    })
  });

  res.json({ jobId: newJobId(), songPrompt, visualPrompt, duration, ...result });
});

module.exports = router;
