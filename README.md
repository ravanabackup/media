# Relay

Press play on one device and every other device with the page open shows what's playing, live:
artwork, title, progress, play/pause status and which device it's playing on.

## How it works

- The device that plays reports its state (`POST /api/state`) on every play, pause, seek and track
  change, plus a heartbeat every 2 seconds.
- Every open page listens on a Server-Sent Events stream (`GET /api/stream`) and updates the moment
  something changes. If streaming is blocked, pages fall back to polling `GET /api/state`.
- One device is the source at a time. Pressing play on another device ("Play on this device")
  takes over and continues from the current position.
- The last state is stored in PostgreSQL (`playback_state`), so a page opened later shows it
  immediately.

Media must be played inside this page. Browsers do not let a web page see what other apps
(Spotify, YouTube, ...) are playing.

## Run locally

```bash
cp .env.example .env        # point DATABASE_URL at your PostgreSQL
npm install
npx drizzle-kit push        # create the table
npm run dev
```

Open the page on your computer, choose **Add device**, and scan the QR code with your phone.
Both devices must be able to reach the same server address.

## GitHub Actions

`.github/workflows/ci.yml` runs on every push to `main` and on pull requests. It starts PostgreSQL,
creates the schema, type-checks, builds, boots the production server and runs
`scripts/smoke-test.mjs`, which reports playback as a phone and checks a desktop receives it.

The workflow installs with `npm ci` when a `package-lock.json` is committed and falls back to
`npm install` otherwise, so it passes either way. Committing the lock file is still recommended:
installs become reproducible and the npm cache in CI works.

Run the same smoke test against any running instance:

```bash
BASE_URL=http://127.0.0.1:3000 node scripts/smoke-test.mjs
```

The app needs a Node.js server and PostgreSQL for the live connection, so it cannot be hosted on
GitHub Pages (static files only). Deploy it to a Node host and keep this workflow as the gate.

## Add your own media

Edit `src/lib/media.ts`. Each item needs an `id`, `kind` (`audio` or `video`), `title`, `artist`,
a direct `src` URL (MP3/MP4) and a `thumbnail` URL.
