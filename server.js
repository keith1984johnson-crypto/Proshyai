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
const pixarRoutes = require('./routes/pixar');

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
app.use('/api/billing', billingRouter);

// --- Generation routes ---
// Demo mode stays open to everyone. Each route checks req.user's credit
// balance internally and only spends credits on a successful real call.
app.use('/api', imageRoutes);          // POST /api/text-to-image, /api/image-to-image
app.use('/api/video', videoRoutes);    // POST /api/video/text-to-video, /image-to-video
app.use('/api/songwriting', songwritingRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/music-video', musicVideoRoutes);
app.use('/api/pixar', pixarRoutes);       // POST /api/pixar/short-film, /api/pixar/long-film

// Which providers are configured + credit/plan config (frontend uses this)
app.get('/api/status', (req, res) => {
  res.json({
    image: !!process.env.OPENAI_API_KEY,
    video: !!process.env.RUNWAY_API_KEY || !!process.env.LUMA_API_KEY,
    songwriting: !!process.env.OPENAI_API_KEY,
    music: !!process.env.SUNO_API_KEY || !!process.env.STABILITY_AUDIO_KEY,
    billingConfigured: !!process.env.STRIPE_SECRET_KEY
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ProShy AI running at http://localhost:${PORT}`);
});
