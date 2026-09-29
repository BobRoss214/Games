# CLAUDE.md

Read this at the start of every session. Repo was empty when this was written,
so anything marked (planned) doesn't exist yet. Update this file as reality changes.

## 1. What this project is

- A collection of small games that run in the browser.
- Personal project for learning. Just for the owner, not a product. Simple beats clever.
- Stack: plain HTML, CSS, and JavaScript. No framework, no bundler, no npm (for now).
- Run: `python3 -m http.server 8000` in the repo root, then open `http://localhost:8000`.
  - Opening a game's `index.html` directly also works, unless it uses ES modules
    (browsers block those from `file://`). Use the server if in doubt.
- Build: none. Nothing to compile.
- Test: none yet. Check by playing the game in a browser. If we add tests, put the command here.

## 2. How to work with me

- Explain in plain language. If you must use a jargon word, define it in a few words.
- Short bullets, not long paragraphs.
- Be blunt and direct. No cheerleading, no padding.
- If something is a bad idea, say so before doing it.
- Casual, conversational tone.
- Multiple ways to do something? Give your pick and why in 1-2 lines. Don't dump a survey.

## 3. Rules for making changes

- Bigger than a small fix? Make a plan first and wait for my OK before touching code.
- Don't delete or rewrite files I didn't ask about.
- Don't install new packages or add libraries/CDN scripts without telling me why first.
- After changes, tell me:
  - what you changed
  - how to check it works (exact steps, e.g. "run the server, open /snake/, press arrow keys")
- Commit to git in small steps with clear messages (what changed and why, one idea per commit).
- Develop on the branch I gave you for the session. Don't push elsewhere. No PRs unless I ask.

## 4. Project notes

### Folder layout (planned)

- `index.html` at the root: a simple menu page linking to each game.
- One folder per game, e.g. `snake/`, `pong/`. Each is self-contained:
  - `index.html`, `style.css`, `game.js`
- `shared/` for code used by 2+ games (only create it when a second game actually needs it).
- Don't share code between games early. Copy-paste first, extract later.

### Style choices (planned defaults, change if I say otherwise)

- Folder names: lowercase, one word or `kebab-case`.
- JS: `camelCase` for variables/functions, `UPPER_SNAKE` for constants, `const`/`let` only (no `var`).
- Vanilla JS with a `<canvas>` for game rendering unless a game is better as plain DOM.
- Game loop uses `requestAnimationFrame`, and movement is based on elapsed time, not frame count.
- Keep each game playable with keyboard; add touch controls only if I ask.
- No build step means no TypeScript, no JSX, no imports from npm.

### Known problems / don't touch

- Nothing yet. Repo is brand new.
- Add entries here when we hit a gotcha, so we don't relearn it.
