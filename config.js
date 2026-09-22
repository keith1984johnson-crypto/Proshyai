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
  voiceover: 10,
  pixarNarration: 10,
  vocalGuide: 10,
  pixarShortFilm: 35,
  pixarLongFilmScene: 35   // charged per scene, since a long film is built from multiple generated clips
};

// New signups get this many credits immediately, no card required —
// this IS the free trial. Change the number to adjust trial generosity.
const FREE_TRIAL_CREDITS = 25;

// How many credits a subscriber's account is topped up with each time
// Stripe successfully bills them (weekly / monthly / yearly cadence).
// Configure the actual $ price for each in your Stripe dashboard —
// these numbers are just the credit bundle size that comes with it.
const CREDIT_GRANTS = {
  weekly: 100,
  monthly: 500,
  yearly: 6500
};

module.exports = { CREDIT_COSTS, FREE_TRIAL_CREDITS, CREDIT_GRANTS };
