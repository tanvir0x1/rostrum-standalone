# Rostrum

Upload a photograph, see it animated sixteen different ways at once, record any take
as a looping video clip. Google sign-in, a credit system, and a payment integration
are included.

A rostrum camera is the animation stand used to shoot still artwork with motion —
the thing that made the Ken Burns effect possible. That's the whole idea here.

---

## Read this first: what "animate" means in this project

This is **motion applied to a still image**, computed in the browser with Canvas 2D:
camera moves, warps, light, grain, chroma tricks. It is **not** generative AI video.
It will not make a person in the photo blink, turn their head, or speak. Nothing in
this repo can do that, and no free service I can point you to reliably does it either.

I'm drawing this line clearly because "animate any photo" usually means the generative
thing, and if that's what you need, this project is the wrong starting point — you'd
need a hosted image-to-video model, and those cost money per generation. There's a
section at the bottom on wiring one in.

What you do get, at no running cost: sixteen effects, real-time preview, unlimited
free use, video export, and a working accounts-and-billing skeleton.

**I have not seen these effects render.** I verified the code compiles, that every
effect runs without exceptions or NaN geometry, and that the Next.js build passes.
Whether each one actually looks good on your photographs is something only you can
judge. Expect to tune the constants.

---

## Two ways to run this

### 1. `dist/rostrum-standalone.html` — no setup at all

One file. Double-click it, or drag it into a browser. No install, no keys, no account,
no server. All sixteen effects and video export work. No sign-in, no payments.

Use this to decide whether the effects are worth building a product around before you
spend an evening on OAuth.

Rebuild it after editing `lib/effects.js`:

```bash
npm run standalone
```

### 2. The full Next.js app

```bash
cp .env.example .env.local     # then fill it in — see below
npm install
npx prisma db push             # creates dev.db
npm run dev                    # http://localhost:3000
```

---

## Setting up Google sign-in

1. Go to the Google Cloud Console, create a project.
2. **APIs & Services → OAuth consent screen.** External. Fill in app name, support
   email, developer email. While in "Testing" mode only accounts you add to the test
   user list can sign in. Publishing to production may require verification depending
   on the scopes you request — this project only asks for the default profile and
   email, which is the least demanding case.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web
   application.**
4. Authorised redirect URIs — add both:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://YOURAPP.vercel.app/api/auth/callback/google`
5. Copy the client ID and secret into `.env.local`.
6. Generate a session secret: `openssl rand -base64 32` → `NEXTAUTH_SECRET`.

The exact menu wording in the Google Cloud Console changes fairly often. If the labels
above don't match what you see, the concepts still hold: consent screen, then a Web
OAuth client, then redirect URIs.

---

## Deploying free

**Free domain names, the honest version.** The thing you're probably thinking of —
Freenom's free `.tk`, `.ml`, `.ga`, `.cf`, `.gq` — is gone. Freenom stopped new
registrations in 2023 after a lawsuit from Meta and announced in February 2024 that it
was exiting the domain business entirely. There is no comparable free registrar left
that I'd point you to.

What's actually free and works today is a **subdomain from your host**:

| Host | Free domain | Runs this app? |
|---|---|---|
| Vercel | `yourapp.vercel.app` | Yes — best fit for Next.js |
| Netlify | `yourapp.netlify.app` | Yes, with their Next adapter |
| Cloudflare Pages | `yourapp.pages.dev` | Yes, with some config |
| Render | `yourapp.onrender.com` | Yes |
| GitHub Pages | `you.github.io` | Standalone HTML only — no server |

There are also community subdomain registries (`is-a.dev`, `js.org`, `eu.org`) that
give out free names under their domain, usually by pull request or application with
eligibility rules. I haven't verified their current terms — check before relying on one.

A real `.com` is roughly USD 10–15 a year. If this becomes a product, buy one.

### Vercel steps

1. Push to GitHub.
2. Import the repo at vercel.com.
3. Switch the Prisma datasource in `prisma/schema.prisma` from `sqlite` to
   `postgresql`. Serverless functions have an ephemeral filesystem — a SQLite file
   will not survive. Free Postgres is available from Neon, Supabase and Vercel itself;
   free-tier limits change, so check current terms.
4. Add every variable from `.env.example` in Vercel's project settings.
5. Set `NEXTAUTH_URL` to your real `https://` URL.
6. Add the production callback URL to your Google OAuth client.
7. Deploy, then run `npx prisma db push` against the production `DATABASE_URL` once.

---

## Payments

### Stripe will probably not work for you

You're in Bangladesh. Based on what I could find, Stripe does not support Bangladesh as
a merchant country — a Bangladesh-registered business cannot open a Stripe account
directly. Your *customers* in Bangladesh can pay a Stripe checkout with a Visa or
Mastercard; the restriction is on where the merchant is, not the payer.

I could not verify this against Stripe's own documentation — my sources were secondary.
**Check Stripe's official supported-countries page before you plan around this.**

Common workarounds, none of which I'm recommending, all of which have real cost and
legal weight: forming a company in a supported country (US LLC, UK Ltd, Singapore),
or using a merchant-of-record service that sells on your behalf. Getting these wrong
creates tax and compliance problems, so talk to an accountant rather than a blog post.

### The realistic options for a Bangladesh-based merchant

- **SSLCommerz** — the most widely used local gateway
- **aamarPay**, **ShurjoPay** — comparable local gateways
- **bKash Payment Gateway** — for mobile wallet payments
- **Payoneer Checkout**, **2Checkout/Verifone** — for international customers

I don't have verified, current API specifications for any of these, so I have **not**
written integration code that I can't stand behind. `lib/payments/local-gateway.js` is
a deliberately empty stub with the interface it needs to satisfy. Fill it in from the
merchant docs your provider hands you at onboarding.

### How payments are wired

Everything goes through `lib/payments/index.js`. Set `PAYMENT_PROVIDER` to:

- `none` — buttons are visibly disabled, the rest of the app works normally
- `stripe` — the reference implementation, fully written
- `local` — your gateway, once you implement the stub

Credits are granted **only** by the signature-verified webhook at
`/api/stripe/webhook`. The `success_url` redirect is not proof of payment — anyone can
type that URL. If you implement a local gateway, hold that line: verify server-to-server
against the gateway's own validation endpoint before granting anything.

Test the webhook locally:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

---

## Known limitations

Things that will bite you, listed plainly:

1. **The paywall is advisory, not enforced.** Video is rendered in the user's browser.
   `/api/export` spends a credit and unlocks the watermark-free path, but anyone who
   opens DevTools can flip `watermark.current` and record for free. Real enforcement
   means rendering server-side with ffmpeg, which costs CPU per clip and is a different
   architecture. For a small product, accept the leakage.

2. **Export format is WebM, not MP4.** `MediaRecorder` produces WebM in Chrome, Edge and
   Firefox. Safari's support is inconsistent and the code falls back to MP4 where
   available, but I haven't tested it on Safari. WebM does not upload cleanly everywhere
   — some social platforms reject it. Converting to MP4 in-browser needs `ffmpeg.wasm`,
   which adds roughly 25 MB of WebAssembly to the page.

3. **Recording is real-time screen capture of the canvas.** If a frame takes too long to
   draw, the clip drops that frame. 1080p with the pixel-heavy effects (Ripple, Liquid,
   Dissolve) will stutter on slower machines. 720p is the safe default. Backgrounding
   the tab during recording throttles `requestAnimationFrame` and will ruin the clip.

4. **The contact sheet drives 16 canvases at once.** It's throttled to 20fps and shares
   one source buffer, but it is still the heaviest thing on the page. On a low-end phone,
   consider rendering only the visible takes with an `IntersectionObserver`.

5. **No file size limit on upload.** A 50 MP photo will make `createSource` slow.
   Add a check.

6. **No rate limiting on the API routes.** Add some before this is public.

7. **Effect constants are unvalidated by eye.** I tuned them by reasoning, not by
   looking. Displacement amplitudes, particle counts and grain opacity are all in
   `lib/effects.js` and are the first things to adjust.

---

## Adding real AI animation later

If you want generative motion — a face that moves, a scene that plays — you need a
hosted image-to-video model. Replicate, Runway, Luma, Kling and others sell this by
the generation.

I'm not writing that adapter for you, because I'd have to guess at the model
identifier, the request shape and the price, and a guess that looks confident is worse
than no code. Get the current docs from whichever provider you pick and write against
those.

Two things to plan for regardless of provider:

- **The API key must stay on the server.** Call it from a Next.js route handler, never
  from the browser. A key in client JavaScript is a public key.
- **Generation costs money per call, so the credit check has to happen server-side and
  before the call.** This is the one place where the advisory paywall above becomes a
  real financial hole. Spend the credit first, then generate.

That also flips the economics of the whole app: the browser effects cost you nothing to
run, so the free tier can be unlimited. A generative tier cannot be.

---

## Project layout

```
lib/effects.js              the motion engine — all 16 effects, no dependencies
lib/payments/               provider abstraction: stripe.js written, local-gateway.js stubbed
lib/auth.js                 NextAuth config, Google provider, JWT sessions
lib/plans.js                credit packs
components/Studio.jsx       upload, stage, controls, recording
components/ContactSheet.jsx the 16 live thumbnails
app/api/export/route.js     spends a credit, logs the export
app/api/stripe/webhook/     grants credits — the only place that does
scripts/build-standalone.mjs inlines the engine into one HTML file
scripts/smoke-test.mjs      runs every effect against a fake canvas (npm run smoke)
```

## The sixteen takes

Slow push · Sway · Breathe · Glitch · Ripple · Shine · Projector · Dissolve ·
Duotone cycle · Zoom pulse · Shutter · VHS · Card turn · Liquid · Bokeh · Spotlight

Each is loop-safe by construction: the frame at `t=0` is identical to the frame at
`t=1`, so a clip recorded over one cycle loops without a seam. If you add an effect,
keep that property — drive everything from `t * 2π` or a ping-pong of `t`.

## Versions

Pinned to Next 14 / React 18 / NextAuth 4, a combination I'm confident works together.
Newer versions exist. NextAuth's successor is Auth.js v5, whose configuration differs
substantially — if you upgrade, expect to rewrite `lib/auth.js` and the route handler.
