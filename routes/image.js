const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');
const { CREDIT_COSTS } = require('../config');
const { resolveGeminiKey } = require('./account');
const gemini = require('../lib/gemini');

const router = express.Router();

// POST /api/text-to-image  { prompt, style, size }
router.post('/text-to-image', async (req, res) => {
  const { prompt, style = 'cinematic', size = '1024x1024' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  // The user's own key takes precedence over the server's (BYOK).
  const geminiKey = resolveGeminiKey(req.user);

  const result = await withFallback({
    hasKey: !!geminiKey,
    user: req.user,
    cost: CREDIT_COSTS.textToImage,
    run: async () => {
      const imageUrl = await gemini.generateImage(
        geminiKey,
        `${prompt}. Style: ${style}. Aspect/size hint: ${size}.`
      );
      return { imageUrl };
    },
    demo: async () => ({
      imageUrl: `https://placehold.co/1024x1024/1a1a2e/eee?text=${encodeURIComponent(prompt.slice(0, 40))}`
    })
  });

  res.json({ jobId: newJobId(), prompt, style, ...result });
});

// POST /api/image-to-image  { imageUrl, prompt }
// Uses Gemini image editing: the source image is passed as a reference.
router.post('/image-to-image', async (req, res) => {
  const { imageUrl, prompt } = req.body;
  if (!imageUrl || !prompt) return res.status(400).json({ error: 'imageUrl and prompt are required' });

  // The user's own key takes precedence over the server's (BYOK).
  const geminiKey = resolveGeminiKey(req.user);

  const result = await withFallback({
    hasKey: !!geminiKey,
    user: req.user,
    cost: CREDIT_COSTS.imageToImage,
    run: async () => {
      // Fetch the source image and hand it to Gemini as a reference.
      const sourceRes = await fetch(imageUrl);
      if (!sourceRes.ok) throw new Error('Could not fetch the source image');
      const sourceBuffer = await sourceRes.buffer();
      const mimeType = sourceRes.headers.get('content-type') || 'image/png';

      const outUrl = await gemini.generateImage(geminiKey, prompt, {
        base64: sourceBuffer.toString('base64'),
        mimeType: mimeType.split(';')[0]
      });

      return { imageUrl: outUrl };
    },
    demo: async () => ({
      imageUrl: `https://placehold.co/1024x1024/1a1a2e/eee?text=${encodeURIComponent('Edited: ' + prompt.slice(0, 30))}`
    })
  });

  res.json({ jobId: newJobId(), prompt, sourceImageUrl: imageUrl, ...result });
});

module.exports = router;
