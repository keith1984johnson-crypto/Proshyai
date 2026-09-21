const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');
const { CREDIT_COSTS } = require('../config');

const router = express.Router();

// POST /api/text-to-image  { prompt, style, size }
router.post('/text-to-image', async (req, res) => {
  const { prompt, style = 'cinematic', size = '1024x1024' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const result = await withFallback({
    hasKey: !!process.env.OPENAI_API_KEY,
    user: req.user,
    cost: CREDIT_COSTS.textToImage,
    run: async () => {
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt: `${prompt}, style: ${style}`, size })
      });
      if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${await r.text()}`);
      const data = await r.json();
      const imageUrl = data.data?.[0]?.url || `data:image/png;base64,${data.data?.[0]?.b64_json}`;
      return { imageUrl };
    },
    demo: async () => ({
      imageUrl: `https://placehold.co/1024x1024/1a1a2e/eee?text=${encodeURIComponent(prompt.slice(0, 40))}`
    })
  });

  res.json({ jobId: newJobId(), prompt, style, ...result });
});

// POST /api/image-to-image  { imageUrl, prompt }
// Uses OpenAI's image edit endpoint to transform an existing image.
router.post('/image-to-image', async (req, res) => {
  const { imageUrl, prompt } = req.body;
  if (!imageUrl || !prompt) return res.status(400).json({ error: 'imageUrl and prompt are required' });

  const result = await withFallback({
    hasKey: !!process.env.OPENAI_API_KEY,
    user: req.user,
    cost: CREDIT_COSTS.imageToImage,
    run: async () => {
      // Fetch the source image, then send it + prompt to OpenAI's edit endpoint.
      const sourceRes = await fetch(imageUrl);
      if (!sourceRes.ok) throw new Error('Could not fetch the source image');
      const sourceBuffer = await sourceRes.buffer();

      const FormData = require('form-data');
      const form = new FormData();
      form.append('image', sourceBuffer, { filename: 'source.png', contentType: 'image/png' });
      form.append('prompt', prompt);
      form.append('model', 'gpt-image-1');

      const r = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() },
        body: form
      });
      if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${await r.text()}`);
      const data = await r.json();
      const outUrl = data.data?.[0]?.url || `data:image/png;base64,${data.data?.[0]?.b64_json}`;
      return { imageUrl: outUrl };
    },
    demo: async () => ({
      imageUrl: `https://placehold.co/1024x1024/1a1a2e/eee?text=${encodeURIComponent('Edited: ' + prompt.slice(0, 30))}`
    })
  });

  res.json({ jobId: newJobId(), prompt, sourceImageUrl: imageUrl, ...result });
});

module.exports = router;
