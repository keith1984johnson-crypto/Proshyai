const express = require('express');
const fetch = require('node-fetch');
const { withFallback, newJobId } = require('./_utils');
const { CREDIT_COSTS } = require('../config');
const { generateSpeech, DEMO_AUDIO_URL } = require('./voiceover');

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

// Generates a narration track for a Pixar scene, if narration text was
// given. Returns null if not requested, so callers can skip it cleanly.
// NOTE: this returns a separate audio file — combining it with the video
// into one file needs a muxing step (e.g. ffmpeg), same limitation as
// music videos elsewhere in this project.
async function maybeGenerateNarration(narrationText, user) {
  if (!narrationText) return null;

  return withFallback({
    hasKey: !!process.env.ELEVENLABS_API_KEY,
    user,
    cost: CREDIT_COSTS.pixarNarration,
    run: async () => ({ narrationAudioUrl: await generateSpeech(narrationText) }),
    demo: async () => ({ narrationAudioUrl: DEMO_AUDIO_URL })
  });
}

// `req.user` is a snapshot taken by identifyUser at the start of the request,
// so its credit balance goes stale the moment anything is charged. A route
// that spends twice (video + narration, or one charge per scene) must carry
// the updated balance forward, or the second check passes against money that
// is already gone and the account is driven negative.
function applySpend(user, result) {
  if (!user || typeof result?.creditsRemaining !== 'number') return user;
  return { ...user, credits: result.creditsRemaining };
}

// POST /api/pixar/short-film  { prompt, duration, narration }
// A single Pixar-style clip, up to whatever max length the video provider
// allows. `narration` is optional — if given, a separate spoken narration
// track is generated alongside the video.
router.post('/short-film', async (req, res) => {
  const { prompt, duration = 10, narration = '' } = req.body;
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

  const narrationResult = await maybeGenerateNarration(narration, applySpend(req.user, result));

  res.json({
    jobId: newJobId(),
    prompt,
    duration,
    ...result,
    ...(narrationResult ? { narration: narrationResult } : {}),
    note: narrationResult
      ? 'Video and narration are separate files — combine them with a video editor or an ffmpeg muxing step (not automated here yet).'
      : undefined
  });
});

// POST /api/pixar/long-film  { title, scenes: [ "scene 1 description", ... ], narration }
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
//
// `narration` is optional whole-film narration text (not per-scene) — one
// narration track is generated for the entire film, to be laid over the
// eventually-stitched final cut.
router.post('/long-film', async (req, res) => {
  const { title = 'Untitled', scenes, narration = '' } = req.body;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return res.status(400).json({ error: 'scenes must be a non-empty array of scene descriptions' });
  }

  const hasKey = !!process.env.LUMA_API_KEY || !!process.env.RUNWAY_API_KEY;
  const sceneResults = [];
  let liveUser = req.user;

  for (const scenePrompt of scenes) {
    const result = await withFallback({
      hasKey,
      user: liveUser,
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
    liveUser = applySpend(liveUser, result);
    if (result.requiresCredits) break;
  }

  const narrationResult = await maybeGenerateNarration(narration, liveUser);

  res.json({
    jobId: newJobId(),
    title,
    totalScenes: scenes.length,
    scenesQueued: sceneResults.length,
    scenes: sceneResults,
    ...(narrationResult ? { narration: narrationResult } : {}),
    note: 'Each scene is a separate generated clip. Combining them (and the narration track, if generated) into one continuous film requires a stitching step (e.g. ffmpeg) after all clips finish rendering — not yet implemented.'
  });
});

module.exports = router;
