# Changelog

## 1.5.0 — 2026-10-18
- Real drop physics: discs fall under gravity, squash on impact and bounce once or twice in the slot.
  Higher drops land harder: bigger squash, a deeper board thud, stronger haptics and a softer second click on the bounce.
- New game: the board's "lever" releases and every disc clatters out through the bottom.
- Undo lifts the disc back up and out of its column. The next-disc preview glides between columns on a spring.
- Wins: a line draws itself through the winning four while those discs pop in sequence. The other discs fade back more cleanly.
- Screen transitions: forward slides in from the right, back from the left, and the home board morphs into the game board
  (on browsers with View Transitions; others get a gentle slide).
- Springs everywhere: buttons and cards give under your finger; sheets rise with a little overshoot and can be dragged
  down (or flicked) to dismiss; dialogs, the result card and toasts spring in; scores pop when they change; home cards rise in sequence.
- Frosted glass across the whole app (cards, player chips, buttons, inputs, toasts, chat) over a slowly drifting ambient light.
- Fixed: a focus outline showed around the board after tapping; it now appears only for keyboard users.
- All motion respects Reduce motion (system setting or Settings → Animation).

## 1.4.0 — 2026-10-18
- New palettes drawn from the UI Inspo board.
  - Light "Bone & Slate": warm bone paper, slate-teal board, ink-black buttons and soft neumorphic depth
    (raised cards, pressed-in inputs and toggles).
  - Dark "Ink & Copper": blue-black ink surfaces, midnight slate board and a copper-to-gold accent on the main buttons.
- New disc colour: Caramel.
- Frosted cards and sheets now take their tint from the theme tokens.

## 1.3.0 — 2026-10-18
- New graphite dark theme (dark grey, not pure black) with one lime accent, glowing discs and outlined cards.
- Material-style shapes everywhere: pill buttons, 24–28px rounded cards; result cards, sheets and dialogs are frosted glass.
- Online chat behind one Chat button: one-tap quick phrases (Oh shit, Omo, Wow, Nice one, Sharpp, GG), emoji reactions,
  and a short message log with free text. Messages pop up over the sender's player card and vanish with the room.
- Privacy: once a room has two players only they can read it (including chat), and nobody can list rooms.
  Old rooms are tidied up by the devices that played in them.
- Includes the 1.2.1 Replay removal.

## 1.2.1 — 2026-10-17
- Removed the Replay button from the end-of-game card (it was easy to tap by mistake instead of Play again).

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
