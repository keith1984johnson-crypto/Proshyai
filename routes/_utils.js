const { v4: uuidv4 } = require('uuid');

// Wraps a provider call. Falls back to a demo placeholder if either:
//  - the required provider API key isn't configured, or
//  - the requester isn't a logged-in user with an active subscription
// (canUseRealGeneration). This keeps demo mode open to everyone while
// reserving real, paid-for generation for subscribers.
async function withFallback({ hasKey, canUseRealGeneration, run, demo }) {
  if (!hasKey || !canUseRealGeneration) {
    return { demo: true, requiresSubscription: hasKey && !canUseRealGeneration, ...(await demo()) };
  }
  try {
    return { demo: false, ...(await run()) };
  } catch (err) {
    console.error('Provider call failed, falling back to demo:', err.message);
    return { demo: true, error: err.message, ...(await demo()) };
  }
}

function newJobId() {
  return uuidv4();
}

module.exports = { withFallback, newJobId };
