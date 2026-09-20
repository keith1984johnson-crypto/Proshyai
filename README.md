# ProShy AI

A creative studio website for proshyai.com: text-to-image, image-to-image,
text-to-video, image-to-video, songwriting (lyrics), music generation, and
music videos — all in one place, with accounts and credit-based subscriptions.

## How it works

- **No account needed** to try any tool — every tool runs in **demo mode**
  (placeholder results) for anyone, so the site is always usable.
- **Signing up is the free trial**: every new account gets **25 free
  credits** immediately, no card required. Spend them on real generations.
- **Subscriptions top up credits** on a Weekly / Monthly / Yearly cadence —
  handled by Stripe. Credits roll over and are only spent on successful
  real generations (never on demo results).

### Credit costs (edit anytime in `config.js`)

| Tool | Cost |
|---|---|
| Text to image | 5 |
| Image to image | 5 |
| Text to video | 20 |
| Image to video | 20 |
| Songwriting (lyrics) | 3 |
| Music | 15 |
| Music video | 30 |

### Credit grants per plan (edit anytime in `config.js`)

| Plan | Credits granted per billing cycle |
|---|---|
| Weekly | 100 |
| Monthly | 500 |
| Yearly | 6500 |

These numbers are just the credit bundle size — the actual **price** you
charge for each plan is set in Stripe's dashboard when you create the
Price objects (see setup below).

## Setup

```bash
npm install
cp .env.example .env
# fill in whichever keys you have — see below
npm start
```

Open http://localhost:3000

### 1. Session secret (required for login to work at all)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Paste the output into `JWT_SECRET` in `.env`.

### 2. Provider keys (optional — each unlocks its own tool)

| Feature | Provider | Env var |
|---|---|---|
| Text/image-to-image, songwriting | OpenAI | `OPENAI_API_KEY` |
| Video (text/image-to-video, music video visuals) | Luma / Runway | `LUMA_API_KEY`, `RUNWAY_API_KEY` |
| Music | Stability Audio / Suno | `STABILITY_AUDIO_KEY`, `SUNO_API_KEY` |

Without a key, that tool stays in demo mode for everyone, including paying subscribers.

### 3. Stripe billing (required for paid plans to work)

1. Create a Stripe account, get your **Secret key** from
   **Developers → API keys** → `STRIPE_SECRET_KEY`.
2. Go to **Product catalog** and create **3 recurring prices** (weekly,
   monthly, yearly billing interval) — copy each **Price ID** into
   `STRIPE_PRICE_WEEKLY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`.
3. Go to **Developers → Webhooks**, add an endpoint at
   `https://yourdomain.com/api/billing/webhook`, and select these events:
   `checkout.session.completed`, `invoice.paid`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
   Copy the **Signing secret** into `STRIPE_WEBHOOK_SECRET`.

`invoice.paid` is what re-grants credits on every renewal — without that
event enabled, subscribers would only get credits once (at signup) and
never again.

## Data storage note

Accounts and credit balances live in a local SQLite file (`proshy.db`)
next to the app. Most hosts (Railway included, without an attached volume)
wipe the filesystem on every redeploy — meaning **all accounts and credit
balances would reset** the next time you push code. Fine for early testing;
before real users rely on this, either attach a persistent volume or move
to a hosted Postgres database (Railway has a one-click add-on for this).

## Project structure

```
server.js               Express app, wires everything together
config.js                Credit costs + plan credit grants (edit these freely)
db.js                    SQLite setup (users table with credit balance)
routes/
  auth.js                 signup / login / logout / me
  billing.js               Stripe checkout + webhook (grants credits)
  image.js                 text-to-image, image-to-image
  video.js                  text-to-video, image-to-video
  songwriting.js            lyrics generation
  music.js                  music/track generation (optionally from lyrics)
  musicVideo.js             music video visuals generation
  _utils.js                 shared demo/credit-gated fallback helper
middleware/auth.js       identifies logged-in user, deducts credits
public/                  the studio UI (7 tools, login, plan picker)
```
