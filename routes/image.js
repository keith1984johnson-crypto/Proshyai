const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');

const router = express.Router();

router.post('/', async (req, res) => {
  const { prompt, style = 'cinematic', size = '1024x1024' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const hasKey = !!process.env.OPENAI_API_KEY;

  const result = await withFallback({
    hasKey,
    canUseRealGeneration: req.canUseRealGeneration,
    run: async () => {
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: `${prompt}, style: ${style}`,
          size
        })
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

module.exports = router;
