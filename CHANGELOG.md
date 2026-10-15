# Changelog

## 1.2.0 — 2026-10-15
- Timed matches (2 Players and Online): per-move clock (5/10/20/30 s) or total time bank (1/3/5 min, then 5 s per move).
  On timeout: random move with 3 strikes = loss, or lose immediately. Online clocks run on Firebase server time and
  every timeout/forfeit is checked by the database rules.
- Avatars: 15 built-in emoji avatars or initials, shown on the player chips and synced online.
- Settings is now a sheet, so opening it mid-game never resets the game.
- Fixed: the room-code box was squeezed to ~30px and hid typed characters.
- Fixed: a refused online move could leave a phantom disc; corrupt room data can no longer crash a client;
  rejoining clears your "left" flag; a half-finished join no longer leaves a room stuck in "waiting".
- Faster: online screens and the QR library are code-split (main bundle 27 → 18 KB gzipped), the AI worker warms up
  when you open the level picker, and the AI's memory use is capped for low-end phones.
- Stricter rules: status can only go waiting → playing; score can only grow by one result per game.

## 1.1.0 — 2026-10-14
- Simpler first-run experience: one tap from home into any game (no setup screens).
- Plain-language modes: "vs Computer", "2 Players", "Play a friend online".
- Animated mini board on the home screen shows what the game is at a glance.
- Big turn banner with the current player's disc; the next disc floats above the board.
- First-game hint: "Tap a column to drop your disc".
- Tap a player's name to rename them; colours and names live in Settings.
- Online invite screen is now two numbered steps: send the link, or share the code/QR.
- "Rematch" renamed "Play again". Firebase project connected (drop-four-7a440).

## 1.0.0 — 2026-10-14
- First release: Pass & Play, 5-level on-device AI, online rooms (code / QR / link), PWA install and offline play.
- Undo, hints, replay, resume, rematch with alternating first player, live score, emoji reactions.
- Light/dark themes, disc symbols, reduced motion, keyboard play, screen-reader announcements.
- Firebase security rules with emulator tests; Playwright end-to-end tests; GitHub Actions CI.
