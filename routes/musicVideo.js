const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');
const { CREDIT_COSTS } = require('../config');
const { resolveGeminiKey } = require('./account');
const gemini = require('../lib/gemini');

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

  const geminiKey = resolveGeminiKey(req.user);

  const result = await withFallback({
    hasKey: !!geminiKey,
    user: req.user,
    cost: CREDIT_COSTS.musicVideo,
    run: async () => {
      const fullPrompt = `Music video visuals for a song about "${songPrompt}": ${visualPrompt}${lyrics ? `. Thematically matching these lyrics: ${lyrics.slice(0, 300)}` : ''}`;
      const video = await gemini.generateVideo(geminiKey, fullPrompt, { aspectRatio: '16:9' });

      return video.videoUrl
        ? {
            videoUrl: video.videoUrl,
            status: 'complete',
            note: 'Visuals only - pair with a track from Music to finish the video.'
          }
        : { status: 'processing', operation: video.operationName };
    },
    demo: async () => ({
      status: 'demo-complete',
      videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
    })
  });

  res.json({ jobId: newJobId(), songPrompt, visualPrompt, duration, ...result });
});

module.exports = router;
