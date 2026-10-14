# Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **Name "Drop Four"**, original logo (2×2 discs on an indigo tile) | "Connect 4" is a Hasbro trademark. The name says what you do. |
| 2 | **Vanilla TypeScript, no UI framework** | Keeps the main bundle at ~30 KB gzipped (budget was 150 KB). The UI is a handful of screens, and a ~30-line `h()` helper is enough. |
| 3 | **The move list is the only game state** | It makes undo, replay, resume, online sync and debugging trivial. Everything else is derived. |
| 4 | **Online moves stored as one string (`"3342"`)** | The security rules can then check "append exactly one digit 0–6, by the right player" with `beginsWith`/`length`/`matches`. A list of child nodes would need number→string key tricks that rules handle poorly. One write per move is also the cheapest on the free tier. |
| 5 | **Empty move list = node absent** | Avoids relying on empty-string storage. A reset deletes `moves`, which the rules only allow together with a `gameNumber` increment after both players asked for a rematch. |
| 6 | **Rematch: first writer wins** | Both clients try the reset when both flags are set. The rules accept only `gameNumber + 1`, so the second attempt fails harmlessly. No server needed. |
| 7 | **Firebase loaded lazily, and excluded from the offline precache** | Offline modes never download the ~77 KB gzipped SDK. It's cached at runtime the first time Online is opened. |
| 8 | **Transport interface + same-browser test backend (`?transport=local`)** | The whole online flow (create, join, play, rematch, reload) is covered by Playwright without needing Firebase. Swapping to another backend later (e.g. Cloudflare) only means adding one more transport. |
| 9 | **Anonymous auth + rejoin by uid** | No sign-up. Firebase persists the anonymous user, so reloading or reopening the app returns you to your seat. The app auto-rejoins your last room unless you left it. |
| 10 | **Room codes: 4 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`** | No 0/O or 1/I/L confusion. That gives 923k codes. Collisions are rejected by the rules and the client retries. |
| 11 | **Rooms expire 24 h after the last activity, with client-side cleanup** | No Cloud Functions on Spark, so each room creation deletes up to five expired rooms. The rules only allow deleting expired rooms. |
| 12 | **AI levels** | Beginner: random with centre bias; takes a win only 50% of the time and blocks only 30%. Easy: always wins/blocks, usually avoids setting up the opponent's winning square. Medium: depth-5 negamax, then a random pick among moves within 45 eval points of the best. Hard: iterative deepening to depth 10 in ≤0.9 s. Advanced: iterative deepening up to the end of the game in ≤2.5 s, typically depth 11–12 from the opening and exact in the middle game. Tested: Hard beats Easy and Medium beats Beginner in ≥5 of 6 seeded games. |
| 13 | **AI evaluation** | Counts open 2s and 3s in all 69 four-cell windows, values centre control, and gives threats on the "right" row parity (odd rows for the first player, even for the second) and non-immediate threats extra weight. That's the classic zugzwang insight, and it makes Hard/Advanced play noticeably more strategically. |
| 14 | **Minimum AI "thinking" delay (550 ms easy levels, 250 ms deep levels)** | An instant reply feels robotic and is hard to follow on a phone. |
| 15 | **Sounds synthesised with Web Audio** | Zero asset weight, works offline, no licensing. |
| 16 | **Colour-blind-safe default (coral vs blue) + optional disc symbols** | Colour should never be the only signal. |
| 17 | **Discs render behind a CSS-masked frame** | Real "falling into the slot" look with plain DOM + CSS. No canvas, so it stays accessible and crisp at any size. |
| 18 | **Drop animation never blocks the game** | Hidden tabs pause animations, so every drop races a timeout. Without that, a backgrounded phone could stall online sync. |
| 19 | **Score shown includes the just-finished game** | The stored score only changes at rematch, but players expect to see the point immediately. |
| 20 | **Extras added** | Replay of the finished game, hint button, AI "mood" lines on Medium+, emoji reactions, resume prompt, auto-rejoin, per-level win/loss record, home-screen shortcut to vs AI. |
| 21 | **v1.1: remove setup screens** | Following "invisible interface" lessons from digital Connect Four work: sensible defaults, edit in place. New players reach the board in one tap; the computer level is chosen in a bottom sheet that starts the game. |
| 22 | **Plain-language labels** | "vs Computer" / "2 Players" / "Play a friend online" read more clearly to first-timers than "AI" / "Pass & Play". |
| 23 | **Turn banner + floating next disc + one-time coach mark** | Answers the two questions new players have: whose turn is it, and what do I tap? |
| 24 | **Database region us-central1** | The default location was kept when the database was created. For a turn-based game the extra round trip is barely noticeable. |
