const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');
const { CREDIT_COSTS } = require('../config');

const router = express.Router();

const PIXAR_STYLE_PREFIX = '3D animated Pixar-style scene, vibrant colors, expressive characters, warm cinematic lighting, storybook charm:';

async function generatePixarClip(prompt, aspectRatio = '16:9') {
  const r = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.LUMA_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: `${PIXAR_STYLE_PREFIX} ${prompt}`, aspect_ratio: aspectRatio })
  });
  if (!r.ok) throw new Error(`Luma error ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return { jobId: data.id, status: data.state || 'queued' };
}

// POST /api/pixar/short-film  { prompt, duration }
// A single Pixar-style clip, up to whatever max length the video provider allows.
router.post('/short-film', async (req, res) => {
  const { prompt, duration = 10 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const result = await withFallback({
    hasKey: !!process.env.LUMA_API_KEY || !!process.env.RUNWAY_API_KEY,
    user: req.user,
    cost: CREDIT_COSTS.pixarShortFilm,
    run: async () => {
      const clip = await generatePixarClip(prompt);
      return { jobId: clip.jobId, status: clip.status, pollUrl: `/api/pixar/status/${clip.jobId}` };
    },
    demo: async () => ({
      status: 'demo-complete',
      videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
    })
  });

  res.json({ jobId: newJobId(), prompt, duration, ...result });
});

// POST /api/pixar/long-film  { title, scenes: [ "scene 1 description", "scene 2 description", ... ] }
//
// IMPORTANT LIMITATION: video generation providers (Luma, Runway, etc.) only
// produce short clips per call — there is no API that generates a finished
// multi-minute film in one request. This route queues one generation job per
// scene you describe, Pixar-styled, and returns all the job/poll info at
// once. Turning the finished clips into one continuous film file requires a
// video-stitching step (e.g. ffmpeg concatenation) run after every scene's
// clip has finished rendering — that stitching step is not implemented here
// yet. Wire it up as: poll all pollUrls until each is complete, download
// each finished clip, then ffmpeg-concat them in scene order.
router.post('/long-film', async (req, res) => {
  const { title = 'Untitled', scenes } = req.body;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return res.status(400).json({ error: 'scenes must be a non-empty array of scene descriptions' });
  }

  const hasKey = !!process.env.LUMA_API_KEY || !!process.env.RUNWAY_API_KEY;
  const sceneResults = [];

  for (const scenePrompt of scenes) {
    const result = await withFallback({
      hasKey,
      user: req.user,
      cost: CREDIT_COSTS.pixarLongFilmScene,
      run: async () => {
        const clip = await generatePixarClip(scenePrompt);
        return { jobId: clip.jobId, status: clip.status, pollUrl: `/api/pixar/status/${clip.jobId}` };
      },
      demo: async () => ({
        status: 'demo-complete',
        videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
      })
    });

    sceneResults.push({ scenePrompt, ...result });
    if (result.requiresCredits) break;
  }

  res.json({
    jobId: newJobId(),
    title,
    totalScenes: scenes.length,
    scenesQueued: sceneResults.length,
    scenes: sceneResults,
    note: 'Each scene is a separate generated clip. Combining them into one continuous film requires a stitching step (e.g. ffmpeg) after all clips finish rendering — not yet implemented.'
  });
});

module.exports = router;
