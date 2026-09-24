const fetch = require('node-fetch');

// Gemini provider (Google AI Studio).
//
// Chosen because the free tier needs no card, which is what makes the text
// and image tools usable while there is no budget for OpenAI.
//
// Uses the current /v1beta/interactions endpoint. The older
// :generateContent shape still exists, but interactions is what the docs
// document now and it returns images and text through one consistent
// response body.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/interactions';

const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

async function callGemini(apiKey, body) {
  const r = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`Gemini error ${r.status}: ${detail.slice(0, 300)}`);
  }

  return r.json();
}

/** Pull the text out of an interactions response, whichever shape it uses. */
function extractText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }

  // Fall back to walking the output blocks.
  const blocks = data.output || data.outputs || [];
  const parts = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (typeof block.text === 'string') parts.push(block.text);
    for (const inner of block.content || []) {
      if (typeof inner.text === 'string') parts.push(inner.text);
    }
  }
  return parts.join('\n').trim();
}

/** Pull base64 image data out of an interactions response. */
function extractImage(data) {
  const direct = data.output_image;
  if (direct && direct.data) {
    return { data: direct.data, mimeType: direct.mime_type || 'image/png' };
  }

  const blocks = data.output || data.outputs || [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const candidates = [block, ...(block.content || [])];
    for (const c of candidates) {
      if (c && c.type === 'image' && c.data) {
        return { data: c.data, mimeType: c.mime_type || 'image/png' };
      }
    }
  }
  return null;
}

/** Generate text (used for song lyrics). */
async function generateText(apiKey, prompt) {
  const data = await callGemini(apiKey, {
    model: TEXT_MODEL,
    input: [{ type: 'text', text: prompt }]
  });

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

  const data = await callGemini(apiKey, { model: IMAGE_MODEL, input });

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

module.exports = { generateText, generateImage, verifyKey, TEXT_MODEL, IMAGE_MODEL };
