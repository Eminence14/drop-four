# Drop Four

A fast, installable four-in-a-row game (PWA).

- **Pass & Play:** two players share one device. Works fully offline.
- **vs AI:** five levels (Beginner → Advanced). The AI runs on the device in a Web Worker, so it works offline.
- **Play Online:** two phones, anywhere. Create a room, then share a 4-character code, a QR code or a link.

Also included: timed matches (per-move or total clock), avatars, undo, hints, replay, a running score, rematches that alternate who goes first, resume after closing the app, emoji reactions online, light/dark themes, colour-blind-friendly disc symbols, sound, vibration and keyboard play.

**Stack:** Vite + TypeScript (no UI framework), `vite-plugin-pwa`, Firebase Realtime Database (free Spark plan) for online rooms, hosted on Netlify. No server code: all online integrity comes from `database.rules.json`.

---

## Run it locally

```bash
npm install
npm run dev          # http://localhost:5173
```

Offline modes work immediately. Online mode is already connected to the `drop-four-7a440` Firebase project via `src/online/config.ts` (public web config). To use a different project, set the `VITE_FIREBASE_*` variables (see below) or edit that file. To test online play *without* Firebase, open two tabs at `http://localhost:5173/?transport=local`. That uses a same-browser test backend.

```bash
npm test             # engine + AI unit tests
npm run typecheck
npm run build        # production build in dist/
npm run preview      # serve the build at http://localhost:4173
npm run e2e          # Playwright end-to-end tests (run `npx playwright install chromium` once)
npm run test:rules   # security-rules tests in the Firebase emulator (needs Java 11+)
npm run icons        # regenerate icons from scripts/make-icons.mjs
```

---

## Set up Firebase (≈10 minutes, free, no card)

1. Go to <https://console.firebase.google.com>, then **Add project**. Name it (e.g. `drop-four`). You can switch Google Analytics off.
2. **Turn on anonymous sign-in:** Build → **Authentication** → Get started → Sign-in method → **Anonymous** → Enable → Save.
3. **Create the database:** Build → **Realtime Database** → Create database. Pick a location close to your players (e.g. `europe-west1` for Africa/Europe), then choose **Start in locked mode**.
4. **Add the security rules:** in Realtime Database → **Rules**, replace everything with the contents of `database.rules.json` and click **Publish**.
   *(Or with the CLI: `npx firebase login`, `npx firebase use --add`, `npx firebase deploy --only database`.)*
5. **Register the web app:** Project settings (gear icon) → General → *Your apps* → Web (`</>`) → register (no Hosting needed). Copy the config values.
6. Copy `.env.example` to `.env` and fill in:
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.<region>.firebasedatabase.app
   VITE_FIREBASE_PROJECT_ID=your-project
   VITE_FIREBASE_APP_ID=...
   ```
   These values are not secret (they ship in every Firebase web app). The rules are what protect the data.
7. Once you've deployed (next section): Authentication → Settings → **Authorized domains** → add your Netlify domain (and custom domain, if any).

The app stays on the free Spark plan. It doesn't use Cloud Functions. If you exceed the free limits, Firebase pauses service rather than billing you, and the app shows "Online play is busy — try again shortly".

---

## Deploy to Netlify

1. Push this folder to a GitHub repo.
2. In Netlify, choose **Add new site** → **Import an existing project** → pick the repo. The build settings come from `netlify.toml` (`npm run build`, publish `dist`).
3. Site configuration → **Environment variables**: add the five `VITE_FIREBASE_*` values from step 6.
4. Deploy. Then add the Netlify URL to Firebase's authorized domains (step 7 above).
5. *(Optional)* Domain management → add a custom domain, e.g. `connect4.victoribidunmoye.me`. Add the CNAME record your DNS provider asks for, and add that domain to Firebase's authorized domains too.

Room links look like `https://your-site/r/K7QM`, and Netlify's SPA redirect sends them to the app.

---

## How it fits together

```
src/engine/game.ts     Pure rules: board, legal moves, win/draw detection (no DOM)
src/ai/search.ts       5 AI levels: heuristics → negamax + alpha-beta + transposition table
src/ai/ai.worker.ts    Runs the AI off the main thread
src/online/            Transport interface + Firebase and same-browser implementations
src/ui/board.ts        Board rendering, drop animation, input (touch, mouse, keyboard)
src/ui/local.ts        Pass & Play and vs AI controller
src/ui/online.ts       Create/join, lobby (code, QR, share), synced game, presence, rematch
src/main.ts            Home, setup, settings, help, install & update prompts, routing
database.rules.json    Server-side referee for online games
```

A game is just its list of moves (e.g. `3342`). The board, whose turn it is and the winner are all derived from that list. Online, the list is stored as one string per room. The rules only accept a write that appends **one** valid column (0–6), by the **player whose turn it is**, while the game is in progress. Both phones recompute the result independently.

See `DECISIONS.md` for the reasoning behind each choice.

### Known limits
- Online, the database can't check whether a column is full or whether the game has already been won. Both clients do check, so a tampered client could only produce a board the honest client refuses to animate. Scores are written by the players at rematch time and could be inflated by a tampered client. That's acceptable for a casual game; fixing it fully would need Cloud Functions (a paid plan).
- Two separate phones can't play each other with no internet at all. Use Pass & Play for fully offline games.
