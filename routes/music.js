const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');
const { CREDIT_COSTS } = require('../config');
const { generateSpeech, DEMO_AUDIO_URL } = require('./voiceover');
const { resolveGeminiKey } = require('./account');
const gemini = require('../lib/gemini');

const router = express.Router();

// `req.user` is a snapshot taken by identifyUser at the start of the request,
// so its credit balance goes stale the moment anything is charged. A route
// that spends twice (track + vocal guide) must carry the updated balance
// forward, or the second check passes against money that is already gone.
function applySpend(user, result) {
  if (!user || typeof result?.creditsRemaining !== 'number') return user;
  return { ...user, credits: result.creditsRemaining };
}

// POST /api/music  { prompt, lyrics, genre, durationSeconds, instrumental, addVocalGuide }
// If `lyrics` is provided (e.g. from the songwriting tool), the instrumental
// prompt is informed by them. If `addVocalGuide` is also true, a SEPARATE
// spoken-word performance of the lyrics is generated via ElevenLabs.
//
// HONEST LIMITATION: ElevenLabs is text-to-speech, not a singing voice — the
// vocal guide is a spoken/expressive read of the lyrics, not a melodic sung
// vocal on pitch with the track. It's useful as a guide vocal or lyric demo,
// not a finished, radio-ready vocal performance. It's also a separate audio
// file from the instrumental track — combining the two into one mixed file
// needs an audio-mixing step (not automated here yet).
router.post('/', async (req, res) => {
  const { prompt, lyrics = '', genre = 'cinematic', durationSeconds = 30, instrumental = false, addVocalGuide = false } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const geminiKey = resolveGeminiKey(req.user);
  const geminiMusicEnabled = Boolean(geminiKey) && process.env.GEMINI_MUSIC_ENABLED === '1';

  const result = await withFallback({
    hasKey: geminiMusicEnabled || !!process.env.ELEVENLABS_API_KEY,
    user: req.user,
    cost: CREDIT_COSTS.music,
    run: async () => {
      const description = `${genre} track: ${prompt}${instrumental ? ', instrumental only' : ''}${lyrics ? `. Lyrics: ${lyrics.slice(0, 500)}` : ''}`;

      // Lyria first when it is available; ElevenLabs Music is the backup,
      // and also the only option while Gemini billing is off.
      if (geminiMusicEnabled) {
        try {
          return { audioUrl: await gemini.generateMusic(geminiKey, description, { durationSeconds }), provider: 'lyria' };
        } catch (err) {
          console.error('[music] Lyria failed, falling back to ElevenLabs:', err.message);
          if (!process.env.ELEVENLABS_API_KEY) throw err;
        }
      }

      const r = await fetch('https://api.elevenlabs.io/v1/music', {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg'
        },
        body: JSON.stringify({
          prompt: description,
          music_length_ms: Math.min(Math.max(Number(durationSeconds) * 1000, 3000), 600000),
          force_instrumental: Boolean(instrumental)
        })
      });
      if (!r.ok) throw new Error(`ElevenLabs Music error ${r.status}: ${await r.text()}`);
      const buffer = await r.buffer();
      return { audioUrl: `data:audio/mpeg;base64,${buffer.toString('base64')}`, provider: 'elevenlabs' };
    },
    demo: async () => ({
      audioUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3'
    })
  });

  let vocalGuide = null;
  if (addVocalGuide && lyrics) {
    vocalGuide = await withFallback({
      hasKey: !!process.env.ELEVENLABS_API_KEY,
      user: applySpend(req.user, result),
      cost: CREDIT_COSTS.vocalGuide,
      run: async () => ({ vocalGuideAudioUrl: await generateSpeech(lyrics) }),
      demo: async () => ({ vocalGuideAudioUrl: DEMO_AUDIO_URL })
    });
  }

  res.json({
    jobId: newJobId(),
    prompt,
    genre,
    durationSeconds,
    instrumental,
    ...result,
    ...(vocalGuide ? { vocalGuide } : {}),
    ...(vocalGuide ? { vocalGuideNote: 'Spoken-word vocal guide, not a sung performance — a separate file from the instrumental track.' } : {})
  });
});

module.exports = router;
