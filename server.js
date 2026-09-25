require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const { router: authRouter } = require('./routes/auth');
const { router: billingRouter, stripeWebhookHandler } = require('./routes/billing');
const { identifyUser } = require('./middleware/auth');

const imageRoutes = require('./routes/image');       // /text-to-image, /image-to-image
const videoRoutes = require('./routes/video');        // /text-to-video, /image-to-video
const songwritingRoutes = require('./routes/songwriting');
const musicRoutes = require('./routes/music');
const musicVideoRoutes = require('./routes/musicVideo');
const filmRoutes = require('./routes/film');
const { router: voiceoverRoutes } = require('./routes/voiceover');
const { router: accountRoutes, hasGeminiKey } = require('./routes/account');
const { router: oauthRoutes, isConfigured: googleConfigured, callbackUrl } = require('./routes/oauth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ credentials: true }));

// Stripe webhook needs the RAW body for signature verification, so this is
// registered before express.json() touches the body.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());
app.use(identifyUser); // attaches req.user (with live credit balance) if logged in
app.use(express.static(path.join(__dirname, 'public')));

// --- Auth & billing ---
app.use('/api/auth', authRouter);
app.use('/api/auth', oauthRoutes);       // /api/auth/google, /api/auth/google/callback
app.use('/api/billing', billingRouter);

// --- Generation routes ---
// Demo mode stays open to everyone. Each route checks req.user's credit
// balance internally and only spends credits on a successful real call.
app.use('/api', imageRoutes);          // POST /api/text-to-image, /api/image-to-image
app.use('/api/video', videoRoutes);    // POST /api/video/text-to-video, /image-to-video
app.use('/api/songwriting', songwritingRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/music-video', musicVideoRoutes);
app.use('/api/voiceover', voiceoverRoutes);       // POST /api/voiceover
app.use('/api/account', accountRoutes);          // BYOK: Gemini key connect/status/disconnect
app.use('/api/film', filmRoutes);         // POST /api/film/short-film, /api/film/long-film

// Which providers are configured + credit/plan config (frontend uses this)
app.get('/api/status', (req, res) => {
  res.json({
    // Account-aware: a user who connected their own key (BYOK) has these
    // tools available even when the server itself has no Gemini key.
    //
    // Images are gated separately: Gemini's free tier allows 0 image
    // requests per day, so a free key can generate lyrics but every image
    // call returns 429. Showing the image tools by default would put two
    // permanently-broken tools back on the page. Set GEMINI_IMAGE_ENABLED=1
    // once the account has paid image access.
    image: hasGeminiKey(req.user) && process.env.GEMINI_IMAGE_ENABLED === '1',
    video: hasGeminiKey(req.user) && process.env.GEMINI_VIDEO_ENABLED === '1',
    songwriting: hasGeminiKey(req.user),
    music: (hasGeminiKey(req.user) && process.env.GEMINI_MUSIC_ENABLED === '1') || !!process.env.ELEVENLABS_API_KEY,
    voiceover: !!process.env.ELEVENLABS_API_KEY,
    billingConfigured: !!process.env.STRIPE_SECRET_KEY,
    googleLogin: googleConfigured()
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ProShy AI running at http://localhost:${PORT}`);
  // Printed at boot so the value to paste into Google Cloud Console is
  // never a guess - it is whatever this process will actually send.
  console.log(
    `Google sign-in: ${googleConfigured() ? 'configured' : 'not configured'} | redirect URI: ${callbackUrl()}`
  );
});
