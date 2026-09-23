const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');
const { CREDIT_COSTS } = require('../config');

const router = express.Router();

const DEMO_AUDIO_URL = 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3';

// Shared by this route and by the narration/vocal-guide add-ons in
// pixar.js and music.js. Not a demo/credit wrapper itself — callers wrap it
// with withFallback so credits and demo mode stay consistent everywhere.
async function generateSpeech(text, voiceId = '21m00Tcm4TlvDq8ikWAM') {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' })
  });
  if (!r.ok) throw new Error(`ElevenLabs error ${r.status}: ${await r.text()}`);
  const buffer = await r.buffer();
  return `data:audio/mpeg;base64,${buffer.toString('base64')}`;
}

// POST /api/voiceover  { text, voiceId }
router.post('/', async (req, res) => {
  const { text, voiceId } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  const result = await withFallback({
    hasKey: !!process.env.ELEVENLABS_API_KEY,
    user: req.user,
    cost: CREDIT_COSTS.voiceover,
    run: async () => ({ audioUrl: await generateSpeech(text, voiceId) }),
    demo: async () => ({ audioUrl: DEMO_AUDIO_URL })
  });

  res.json({ jobId: newJobId(), text, voiceId, ...result });
});

module.exports = { router, generateSpeech, DEMO_AUDIO_URL };
