# CLAUDE.md

Read this at the start of every session. Update it when reality changes.

## 1. What this project is

- A collection of small browser games for the owner (personal / learning project).
- **Graveward** (`graveward/`) is the first and big one: a first-person, pixelated, bloody dungeon crawler for 1-4 local players (split-screen), inspired by Crawl's hero-vs-ghosts structure. Bots fill empty slots.
- Stack: plain HTML/CSS/JS ES modules. No framework, no bundler, **no npm dependencies**. All art and audio are generated in code.
- Run: `cd graveward && python3 -m http.server 8000` then open `http://localhost:8000` (or `npm run dev` there). The root `index.html` is a menu linking to each game.
- Build: `cd graveward && npm run build` copies the game to `graveward/dist/` (it is just a copy).
- Test (Node 22, no deps): `cd graveward && npm test` (244 content checks + 6 headless bot matches).
- Browser tests need Playwright: `npm run test:browser` (menus, two keyboards, fake gamepad, audio).

## 2. How to work with me

- Explain in plain language. If you must use a jargon word, define it in a few words.
- Short bullets, not long paragraphs.
- Be blunt and direct. No cheerleading, no padding.
- If something is a bad idea, say so before doing it.
- Casual, conversational tone.
- Multiple ways to do something? Give your pick and why in 1-2 lines. Don't dump a survey.

## 3. Rules for making changes

- Bigger than a small fix? Make a plan first and wait for my OK. (Exception: when I explicitly say to work autonomously, as with the Graveward build.)
- Don't delete or rewrite files I didn't ask about.
- Don't install new packages or add libraries/CDN scripts without telling me why first.
- After changes, tell me what changed and exactly how to check it works.
- Commit to git in small steps with clear messages.
- Develop on the branch I gave you for the session. Don't push elsewhere. No PRs unless I ask.

## 4. Project notes

### Layout
- `index.html` (root): menu page. `graveward/`: the game (`index.html`, `style.css`, `game.js` bootstrap, `src/`, `tools/`).
- `graveward/src/`: `data.js` = all content as data (tune numbers here). `match.js` = game director. `world.js/combat.js/hero.js/ghost.js/boss.js/ai.js` = simulation (no DOM, runs in Node). `renderer.js/scene.js/hud.js/ui.js/fx.js/audio.js/input.js/game.js` = presentation.
- `graveward/README.md` (player + dev guide) and `DECISIONS.md` (why things are the way they are).

### Style
- Folders lowercase; JS `camelCase`, `UPPER_SNAKE` constants, `const`/`let` only. Keep sim modules free of DOM/canvas/audio imports.
- Gameplay randomness goes through the seeded RNG (`match.rng` or `grng`), never `Math.random` (visual FX may use it).
- Pixel font is uppercase-only; HUD must stay readable in a 240x135 quadrant.

### Gotchas / don't touch
- Abilities fire on the first tick past windup (tick-size independent). Don't move that back inside the strike window.
- Bot movement is stored in world space and re-projected each tick; don't store local fwd/strafe across ticks.
- Always run `npm test` (and `node tools/sim.mjs --matches 10`) after touching sim code: softlocks show up as "stalled" there.
- `Escape` doesn't reach the page while the pointer is locked; `Tab`/pad Start also pause.
- Browser tests use a hard-coded Chromium path (`CHROMIUM_PATH` overrides it).
