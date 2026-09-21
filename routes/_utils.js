const { v4: uuidv4 } = require('uuid');
const { deductCredits } = require('../middleware/auth');

// Wraps a provider call. Falls back to a demo placeholder unless BOTH:
//  - the required provider API key is configured, AND
//  - the requester is logged in with enough credits for this tool's cost
// On a successful REAL generation, deducts the credits and reports the
// new balance back to the frontend.
async function withFallback({ hasKey, user, cost, run, demo }) {
  const hasEnoughCredits = !!user && user.credits >= cost;
  if (!hasKey || !hasEnoughCredits) {
    return {
      demo: true,
      requiresCredits: hasKey && !hasEnoughCredits,
      creditsNeeded: cost,
      ...(await demo())
    };
  }
  try {
    const result = await run();
    const newBalance = deductCredits(user.id, cost);
    return { demo: false, creditsSpent: cost, creditsRemaining: newBalance, ...result };
  } catch (err) {
    console.error('Provider call failed, falling back to demo:', err.message);
    return { demo: true, error: err.message, creditsNeeded: cost, ...(await demo()) };
  }
}

function newJobId() {
  return uuidv4();
}

module.exports = { withFallback, newJobId };
