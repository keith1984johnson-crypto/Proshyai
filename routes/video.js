const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');
const { CREDIT_COSTS } = require('../config');
const { resolveGeminiKey } = require('./account');
const gemini = require('../lib/gemini');

const router = express.Router();

// POST /api/video/text-to-video  { prompt, duration, aspectRatio }
router.post('/text-to-video', async (req, res) => {
  const { prompt, duration = 5, aspectRatio = '16:9' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const geminiKey = resolveGeminiKey(req.user);

  const result = await withFallback({
    hasKey: !!geminiKey,
    user: req.user,
    cost: CREDIT_COSTS.textToVideo,
    run: async () => {
      const video = await gemini.generateVideo(geminiKey, prompt, { aspectRatio });
      return video.videoUrl
        ? { videoUrl: video.videoUrl, status: 'complete' }
        : { status: 'processing', operation: video.operationName, note: 'Still rendering - check back shortly.' };
    },
    demo: async () => ({
      status: 'demo-complete',
      videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
    })
  });

  res.json({ jobId: newJobId(), prompt, duration, aspectRatio, ...result });
});

// POST /api/video/image-to-video  { imageUrl, prompt, duration }
router.post('/image-to-video', async (req, res) => {
  const { imageUrl, prompt = '', duration = 5 } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

  const geminiKey = resolveGeminiKey(req.user);

  const result = await withFallback({
    hasKey: !!geminiKey,
    user: req.user,
    cost: CREDIT_COSTS.imageToVideo,
    run: async () => {
      const sourceRes = await fetch(imageUrl);
      if (!sourceRes.ok) throw new Error('Could not fetch the source image');
      const buffer = await sourceRes.buffer();
      const mimeType = (sourceRes.headers.get('content-type') || 'image/png').split(';')[0];

      const video = await gemini.generateVideo(geminiKey, prompt || 'Animate this image naturally.', {
        image: { base64: buffer.toString('base64'), mimeType }
      });

      return video.videoUrl
        ? { videoUrl: video.videoUrl, status: 'complete' }
        : { status: 'processing', operation: video.operationName, note: 'Still rendering - check back shortly.' };
    },
    demo: async () => ({
      status: 'demo-complete',
      videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
    })
  });

  res.json({ jobId: newJobId(), imageUrl, prompt, duration, ...result });
});

module.exports = router;
