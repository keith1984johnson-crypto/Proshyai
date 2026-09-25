// Every generation tool has a credit cost. Change these anytime — nothing
// else in the code needs to know the actual numbers.
const CREDIT_COSTS = {
  textToImage: 5,
  imageToImage: 5,
  textToVideo: 20,
  imageToVideo: 20,
  songwriting: 3,
  music: 15,
  musicVideo: 30,
  animatedShortFilm: 35,
  animatedLongFilmScene: 35,   // charged per scene, since a long film is built from multiple generated clips
  voiceover: 5,
  filmNarration: 10,       // optional narration track added to an animated film
  vocalGuide: 10            // spoken-word vocal guide added to a music track
};

// New signups get this many credits immediately, no card required —
// this IS the free trial. Set FREE_TRIAL_CREDITS=0 to require payment
// before anything real can be generated.
const FREE_TRIAL_CREDITS = Number.isFinite(Number(process.env.FREE_TRIAL_CREDITS))
  ? Number(process.env.FREE_TRIAL_CREDITS)
  : 25;

// One-off credit packs, for people who want to pay once instead of
// subscribing. The price itself lives in Stripe; this is only the size of
// the bundle that a successful payment grants.
const CREDIT_PACKS = {
  starter: {
    credits: 60,
    label: 'Starter pack',
    blurb: 'One-off top-up, no subscription',
    usd: 5
  }
};

// Display prices, in USD. These are what the UI shows; the amount actually
// charged is whatever the matching Stripe price says, so the two must be
// kept in step.
const PLAN_PRICES = {
  weekly: 9,
  monthly: 19,
  yearly: 149
};

// How many credits a subscriber's account is topped up with each time
// Stripe successfully bills them (weekly / monthly / yearly cadence).
// Configure the actual $ price for each in your Stripe dashboard —
// these numbers are just the credit bundle size that comes with it.
const CREDIT_GRANTS = {
  weekly: 100,
  monthly: 500,
  yearly: 6500
};

module.exports = { CREDIT_COSTS, FREE_TRIAL_CREDITS, CREDIT_GRANTS, CREDIT_PACKS, PLAN_PRICES };
