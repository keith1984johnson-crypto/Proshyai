const fetch = require('node-fetch');

// Gemini provider (Google AI Studio).
//
// Chosen because the free tier needs no card, which is what makes the text
// and image tools usable with no budget at all.
//
// Uses the current /v1beta/interactions endpoint. The older
// :generateContent shape still exists, but interactions is what the docs
// document now and it returns images and text through one consistent
// response body.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/interactions';

// gemini-2.5-flash is closed to new API keys, so default to a current one.
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.6-flash';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';

// Free-tier text models return 503 "high demand" fairly often. One retry and
// a second model turn a transient spike into a slight delay instead of a
// demo placeholder for the user.
const TEXT_FALLBACK_MODEL = process.env.GEMINI_TEXT_FALLBACK_MODEL || 'gemini-flash-lite-latest';

// Veo 3.1 for video, Lyria 3 for music. Both verified present on the API
// key; both require billing to be enabled (the free tier grants 0 quota).
const VIDEO_MODEL = process.env.GEMINI_VIDEO_MODEL || 'veo-3.1-fast-generate-preview';
const MUSIC_MODEL = process.env.GEMINI_MUSIC_MODEL || 'lyria-3.5';

const MODELS_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callGemini(apiKey, body) {
  const r = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const detail = await r.text();
    const err = new Error(`Gemini error ${r.status}: ${detail.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }

  return r.json();
}

/** Try each model in turn, retrying once on a transient status. */
async function callWithFallback(apiKey, models, input) {
  let lastError;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGemini(apiKey, { model, input });
      } catch (err) {
        lastError = err;
        if (!RETRYABLE.has(err.status)) throw err;
        if (attempt === 0) await sleep(700);
      }
    }
  }

  throw lastError;
}

/**
 * Walk the content parts of an interactions response.
 *
 * The documented convenience properties (output_text / output_image) are not
 * present on the wire: a real response carries a `steps` array, where the
 * useful part is the step of type "model_output" (there is also a "thought"
 * step with no content). Both shapes are handled so this keeps working if
 * the convenience fields appear later.
 */
function* contentParts(data) {
  for (const step of data.steps || []) {
    for (const part of step.content || []) yield part;
  }
  for (const block of data.output || data.outputs || []) {
    if (block && block.type) yield block;
    for (const part of block.content || []) yield part;
  }
}

function extractText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const part of contentParts(data)) {
    if (part.type === 'text' && typeof part.text === 'string') parts.push(part.text);
  }
  return parts.join('\n').trim();
}

function extractImage(data) {
  if (data.output_image && data.output_image.data) {
    return { data: data.output_image.data, mimeType: data.output_image.mime_type || 'image/png' };
  }

  for (const part of contentParts(data)) {
    if (part.type === 'image' && part.data) {
      return { data: part.data, mimeType: part.mime_type || 'image/png' };
    }
  }
  return null;
}

/** Generate text (used for song lyrics). */
async function generateText(apiKey, prompt) {
  const data = await callWithFallback(apiKey, [TEXT_MODEL, TEXT_FALLBACK_MODEL], [
    { type: 'text', text: prompt }
  ]);

  const text = extractText(data);
  if (!text) throw new Error('Gemini returned no text');
  return text;
}

/**
 * Generate an image, optionally editing a source image.
 * Returns a data: URL ready for an <img src>.
 */
async function generateImage(apiKey, prompt, sourceImage) {
  const input = [{ type: 'text', text: prompt }];

  if (sourceImage && sourceImage.base64) {
    input.push({
      type: 'image',
      mime_type: sourceImage.mimeType || 'image/png',
      data: sourceImage.base64
    });
  }

  const data = await callWithFallback(apiKey, [IMAGE_MODEL], input);

  const image = extractImage(data);
  if (!image) throw new Error('Gemini returned no image');
  return `data:${image.mimeType};base64,${image.data}`;
}

/** Cheap credential check used when a user connects their own key. */
async function verifyKey(apiKey) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
    headers: { 'x-goog-api-key': apiKey }
  });
  return { ok: r.ok, status: r.status, detail: r.ok ? null : (await r.text()).slice(0, 200) };
}

/** POST to a model endpoint that is not the interactions API. */
async function callModel(apiKey, model, method, body) {
  const r = await fetch(`${MODELS_BASE}/models/${model}:${method}`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const detail = await r.text();
    const err = new Error(`Gemini ${model} error ${r.status}: ${detail.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/**
 * Video generation with Veo.
 *
 * Veo is long-running: the first call returns an operation name, which is
 * polled until done. Returns the finished video URI plus the operation name,
 * so a caller can poll itself instead of blocking if it prefers.
 */
async function startVideo(apiKey, prompt, { aspectRatio = '16:9', image } = {}) {
  const instance = { prompt };
  if (image && image.base64) {
    instance.image = { bytesBase64Encoded: image.base64, mimeType: image.mimeType || 'image/png' };
  }

  const op = await callModel(apiKey, VIDEO_MODEL, 'predictLongRunning', {
    instances: [instance],
    parameters: { aspectRatio }
  });

  if (!op.name) throw new Error('Veo did not return an operation name');
  return op.name;
}

/** Poll a Veo operation once. Returns { done, videoUri, error }. */
async function pollVideo(apiKey, operationName) {
  const r = await fetch(`${MODELS_BASE}/${operationName}`, { headers: { 'x-goog-api-key': apiKey } });
  if (!r.ok) throw new Error(`Veo poll error ${r.status}: ${(await r.text()).slice(0, 200)}`);

  const data = await r.json();
  if (!data.done) return { done: false };
  if (data.error) throw new Error(`Veo failed: ${data.error.message || 'unknown error'}`);

  const response = data.response || {};
  const samples =
    response.generateVideoResponse?.generatedSamples ||
    response.generatedSamples ||
    response.videos ||
    [];
  const uri = samples[0]?.video?.uri || samples[0]?.uri || null;

  return { done: true, videoUri: uri };
}

/** Start a video and wait for it, within a bounded time. */
async function generateVideo(apiKey, prompt, options = {}) {
  const operationName = await startVideo(apiKey, prompt, options);
  const timeoutMs = Number(options.timeoutMs || 240000);
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    await sleep(6000);
    const status = await pollVideo(apiKey, operationName);
    if (status.done) {
      if (!status.videoUri) throw new Error('Veo finished without returning a video');
      return { videoUrl: status.videoUri, operationName };
    }
  }

  // Not a failure: hand the caller the operation so it can keep polling.
  return { videoUrl: null, operationName, stillRunning: true };
}

/**
 * Music generation with Lyria.
 *
 * Lyria is exposed through generateContent, not predict - the API reports
 * supportedGenerationMethods: ['generateContent', 'countTokens'], and the
 * predict endpoints 404. Audio comes back as an inlineData part.
 */
async function generateMusic(apiKey, prompt, { durationSeconds = 30 } = {}) {
  const data = await callModel(apiKey, MUSIC_MODEL, 'generateContent', {
    contents: [{ parts: [{ text: `${prompt}. Target length: ${durationSeconds} seconds.` }] }]
  });

  for (const candidate of data.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.inlineData && part.inlineData.data) {
        return `data:${part.inlineData.mimeType || 'audio/mpeg'};base64,${part.inlineData.data}`;
      }
    }
  }

  throw new Error('Lyria returned no audio');
}

module.exports = {
  generateText,
  generateImage,
  generateVideo,
  startVideo,
  pollVideo,
  generateMusic,
  verifyKey,
  TEXT_MODEL,
  IMAGE_MODEL,
  VIDEO_MODEL,
  MUSIC_MODEL
};
