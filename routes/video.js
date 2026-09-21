const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');

const router = express.Router();

// POST /api/video/text-to-video   { prompt, duration, aspectRatio }
router.post('/text-to-video', async (req, res) => {
  const { prompt, duration = 5, aspectRatio = '16:9' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const hasKey = !!process.env.RUNWAY_API_KEY || !!process.env.LUMA_API_KEY;

  const result = await withFallback({
    hasKey,
    canUseRealGeneration: req.canUseRealGeneration,
    run: async () => {
      // Example using Luma Dream Machine API (swap for Runway if preferred)
      const r = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.LUMA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt, aspect_ratio: aspectRatio })
      });
      if (!r.ok) throw new Error(`Luma error ${r.status}: ${await r.text()}`);
      const data = await r.json();
      // Real API is async — you'd poll data.id until status === 'completed'
      return { jobId: data.id, status: data.state || 'queued', pollUrl: `/api/video/status/${data.id}` };
    },
    demo: async () => ({
      status: 'demo-complete',
      videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
    })
  });

  res.json({ jobId: newJobId(), prompt, duration, aspectRatio, ...result });
});

// POST /api/video/image-to-video   { imageUrl, prompt, duration }
router.post('/image-to-video', async (req, res) => {
  const { imageUrl, prompt = '', duration = 5 } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

  const hasKey = !!process.env.RUNWAY_API_KEY;

  const result = await withFallback({
    hasKey,
    canUseRealGeneration: req.canUseRealGeneration,
    run: async () => {
      const r = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RUNWAY_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Runway-Version': '2024-11-06'
        },
        body: JSON.stringify({ promptImage: imageUrl, promptText: prompt, model: 'gen3a_turbo', duration })
      });
      if (!r.ok) throw new Error(`Runway error ${r.status}: ${await r.text()}`);
      const data = await r.json();
      return { jobId: data.id, status: 'queued', pollUrl: `/api/video/status/${data.id}` };
    },
    demo: async () => ({
      status: 'demo-complete',
      videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
    })
  });

  res.json({ jobId: newJobId(), imageUrl, prompt, duration, ...result });
});

// Pixar-style is text-to-video with a style preset baked into the prompt
router.post('/pixar-style', async (req, res) => {
  const { prompt, duration = 6 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  const pixarPrompt = `3D animated Pixar-style short film scene, vibrant colors, expressive characters, cinematic lighting: ${prompt}`;
  const aspectRatio = '16:9';

  const hasKey = !!process.env.RUNWAY_API_KEY || !!process.env.LUMA_API_KEY;

  const result = await withFallback({
    hasKey,
    canUseRealGeneration: req.canUseRealGeneration,
    run: async () => {
      const r = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.LUMA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt: pixarPrompt, aspect_ratio: aspectRatio })
      });
      if (!r.ok) throw new Error(`Luma error ${r.status}: ${await r.text()}`);
      const data = await r.json();
      return { jobId: data.id, status: data.state || 'queued', pollUrl: `/api/video/status/${data.id}` };
    },
    demo: async () => ({
      status: 'demo-complete',
      videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
    })
  });

  res.json({ jobId: newJobId(), prompt: pixarPrompt, duration, aspectRatio, ...result });
});

module.exports = router;
