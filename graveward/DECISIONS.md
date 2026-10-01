# DECISIONS

One line of reasoning per non-trivial decision, plus what was researched.

## Research (Crawl by Powerhoof)

Only search-result summaries were reachable (the wiki, Steam guide and Wikipedia are blocked by the sandbox egress proxy), so rules came from those snippets, the design brief, and my own knowledge of the game.

Confirmed from sources and matched in the game:
* All players start as humans in the first room and fight until one is left; the survivor becomes the first Hero and the rest become ghosts.
* The **killing blow on the Hero** makes the killer the new Hero and the dead Hero a ghost.
* Ghosts can possess traps, furniture, pentagrams (summoning circles that give a random monster from your god), statues and boss parts; they collect **ectoplasm** (6 gives a slime follower) and get **vitae/wrath** when the Hero levels up, spent between floors to evolve monsters.
* Level **10** unlocks the portal room; the boss is chosen from three per game and is controlled by the ghosts.
* **Three attempts in total** across all players; on the third the seal breaks and the Hero is devoured (everyone loses). Matched exactly.
* Exit room has a trapdoor in a corner that is locked while monsters or **red crystals** remain; red crystals keep trap rooms locked; the shop has **one entrance** with a hammer-and-anvil sign over the doorway in the adjacent room; most floors have a shop.
* Every dungeon has a portal room and an exit.

Where I had to choose (brief was silent or ambiguous):
* Each player keeps their **own** hero level/XP/gold/items across swaps (brief default). New Hero respawns at the death spot with 60% HP and 3.2 s invulnerability.
* If a Hero dies to something with no player credit, the last player to damage them (within 10 s) gets it, otherwise the highest-Blood Ghost.
* Boss failure sends the Hero back to the portal room at 25% HP; the third failure ends the game with everyone losing, ranked by Blood/XP.

## Technical decisions

* **Plain JavaScript ES modules, no bundler, no npm dependencies** (the brief recommended TypeScript + Vite but said to change it and log why). The repo's `CLAUDE.md` says plain HTML/CSS/JS with no build step, and it keeps the game zero-install and trivially hostable. `dist/` is a straight copy.
* **Custom CPU raycaster** rather than WebGL: total control over the dithered palette look, identical output everywhere, runs headlessly for screenshots, and 4 viewports cost about 6 ms/frame.
* **Sim/presentation split**: `match.js` has no DOM/canvas/audio imports, so bot matches run in Node at 30 Hz for balance testing. This is what made automated full-match balance testing possible.
* **Light kernels instead of dynamic lights**: each torch bakes a sparse kernel (with line of sight) into a lightmap; the animated part is just adding a delta each frame. Cheap, and it lets ghosts make nearby torches stutter and die.
* **Fixed 60 Hz simulation step** with a rendering accumulator; hit-stop freezes the sim for 40-70 ms.
* **Abilities execute on the first tick past windup**, not inside a fixed time window, so results do not depend on tick size (found via 30 Hz vs 60 Hz sims).
* **Movement of bots is stored in world space** and re-projected every tick (a local-space version spiralled while turning).
* **Determinism**: gameplay RNG seeded per match; visual effects use `Math.random`.
* **Internal resolution 480x270** (fine mode 640x360), integer-scaled with `image-rendering: pixelated`. Split-screen: 1 = full, 2 = side by side, 3-4 = quadrants (the 4th quadrant of a 3-human game is a scoreboard and minimap).
* **Vertical FOV is widened for narrow viewports** so split-screen keeps a usable horizontal field of view.
* Ghosts are **wall-blocked but door-passing**; a "haunt jump" key teleports between pentagrams, traps, statues and the Hero, so navigating a big dungeon is never a chore.
* **Pentagram fallback**: if a room is locked with unused pentagrams and no ghost takes them for 26 s, hollow shades spawn from them, so an AFK ghost cannot softlock the Hero.
* **Locked rooms release when the Hero is not inside**, and the boss arena returns a Hero who slips out of the closing door. Both were softlocks found by simulation.
* **Blood decals** are per-cell 16x16 masks (floor and wall faces), persistent for the whole floor.
* **Escape** exits pointer-lock in browsers and is not delivered as a key event, so `Tab` and gamepad `Start` also pause, and losing pointer-lock pauses automatically.
* **Settings** persist in `localStorage` inside try/catch and the game runs fine without storage.

## Content decisions

* Three gods x three monsters x three evolution tiers, plus slime, slimelet, thralls and hollow shades, and three statue giants. Bone (Ossuar), flesh (Vorrath) and mummies/scarabs (Ashkeleth). All names and designs are original.
* Bosses: Sarcophagus Colossus (chest cracks open after fist slams), Jackal King (heads take double damage mid-attack), Bandage Mother (unwrap both arms to expose the core), plus the two bonus bosses: Sand Devourer (lunge exposes the head; quicksand pits slow and hurt the Hero) and Beating Heart (heart core takes triple damage only while exposed; poison pools in later phases). Boss HP scales up by 28% per missing Ghost and bot Ghosts fill the empty parts. Phases at 66% and 33% add falling rocks and faster parts.
* Treasure rooms are usually guarded by pentagrams so they lock: tempting and dangerous.
* Hero XP table is 75/190/340/540/800/1130/1530/2000/2550 to reach levels 2-10, tuned with bot sims so a good Hero reaches 10 around floors 4-5.
* If floors run out, depth loops with the themes repeating and monsters scaling, so the game never dead-ends before someone reaches the boss.
* Bots: three skills that change think rate, aim error, dodge/block chance and how quickly Ghosts commit. Ghost bots claim targets so they do not all take the same pentagram.
* Lighting is intentionally dark: ambient is cold blue-black, torches are warm and few, and ghosts near the Hero stutter torches and the lantern, so a flicker tells the Hero they are being watched.

## Balance results (headless bot matches)

At the final settings (4 bots, normal), 10 consecutive seeds: 0 crashes or stalls, about 60% ended in a boss victory and 40% in the "devoured" ending, 19-37 min of game time (median about 26), 19-59 Hero swaps. Humans think slower than bots, so real matches run longer.

Not done: online multiplayer, damage numbers.

## Tutorial
* Scripted solo run in its own hand-built map (7 rooms in a row, sealed doors) instead of a flag on the normal floors: easier to gate, and the real combat/ghost code still runs.
* Steps complete by watching the same event counters the game already emits (propbreak, dodge, block, potion, spellcast, chestopen, buy, pentagram), so no duplicate detection logic.
* Levels are granted at the step that needs them (3 heavy, 5 dodge, 6 block, 7 spell). The learner cannot die (HP topped up, deaths revived); the practice hero in the ghost lesson takes damage but is healed and never falls, so no role swap happens.
* The ghost lesson resets the pentagram if the player leaves or loses the monster body, so it cannot dead-end.

## Thrown / shot object physics
* Gravity is in wall-heights per second squared (one unit = one wall height, ceiling at 1). Physical things get it; energy (fireball, dark bolt, curse, wave, spark) stays straight so spell aiming is unchanged.
* Players only aim left/right, so physical shots get an automatic upward speed (`autoLob`) that makes them cross their launch height at a reference range (arrows 9 units, knives/stones 8). Arc height is capped under the ceiling, and gravity values are small enough that bots (which aim flat) still hit at normal range.
* Ghost-thrown props use `lobSolution`: a real ballistic arc that lands on the hero's chest, leading a moving hero a little. Flight time is capped at 0.78 s so the arc fits under the ceiling.
* Semi-implicit Euler, same arc at 30 and 60 Hz (tested). Horizontal motion keeps its existing sub-stepping, so fast bolts do not tunnel through thin walls.
* Bouncers (knife, stone, shard, bone) lose energy and damage each bounce, roll with friction, then rest or become a pickup (knife). Pots shatter. Arrows and spit die on the floor or walls.

## Input is never dropped between simulation steps
* The sim runs at a fixed 60 Hz; the screen can refresh much faster (120/144/240 Hz), so many display frames run no simulation step. Mouse movement used to be thrown away at the end of every frame and button presses could vanish in those frames.
* Now mouse movement waits in `mouseDX` until a step uses it (capped per step so a stall cannot whip the camera), and each device source latches that frame's presses/releases at the end of every frame. A press is consumed exactly once even when a frame runs several steps.
* Paused / in menus: pending input is cleared so a menu key cannot fire in the game on resume.
* Regression tests: `tools/e2e-look.mjs` (fast-monitor emulation).

## Darker, more realistic look (stages 1-2)
- `setDarkness(d)` in `renderer.js` scales ambient light, contrast curve, fog, lantern power and vignette together. 0 = the old look, 1 = default, 1.6 max. It is the playability safety valve: Options > DARKNESS.
- Textures are still authored at 64x64 in code, then `realism()` in `textures.js` upscales to 128x128 and adds lit relief, ambient occlusion, mottling, grain, grime and a desaturated/cool-shadow/warm-light grade. Cost: ~200 ms extra at startup, no per-frame cost (60 fps unchanged).
- Output stays pixelated: internal resolution and the Bayer dither are untouched.

## Sprites, gore, bloom (stages 3-4 and polish)
- Monsters/heroes/bosses/first-person weapons go through `realize()` (`sprites_real.js`): 2x upscale with crisp colours, lit relief, edge darkening, grain and grime. Monsters get four wound levels from their HP fraction (frames are cached per level). Corpses always use the fully wounded look.
- Gibs are small sprites (`sprites_gore.js`) that tumble by swapping 90-degree rotations. They bleed in flight, land with the old physics, and stay on the floor (cap 260). Kills start a slowly spreading pool; monsters under half HP leave a blood trail.
- Blood masks are 32x32 per cell (were 16x16) with soft edges, a dark rim and wall drips.
- Bloom (Options > GLOW) works on a quarter-size copy of each view: about 0.2 ms per view. Weapon/hand moved up so the fist is visible above the HUD bar.
- Measured: 4.0 ms/frame (1 view) and 7.9 ms (4 views) in headless Chromium, vs 4.0 / 6.9 before the overhaul.

## Looking without pointer lock
- Browsers only grant pointer lock to top-level pages in most embeds; a sandboxed iframe (like a hosted preview) silently refuses. Before, the mouse did nothing then except at the screen edges.
- Now, when the mouse is not captured, plain mouse movement over the game turns the camera (gain 1.6, since the cursor has limited room) and pushing into an edge keeps turning. `tools/e2e-look.mjs` tests this inside a sandboxed iframe with W held.
- Options > LOOK WITHOUT MOUSE CAPTURE turns it off. The banner says when the page blocks capture.
- Laptop touchpads: many laptops switch the touchpad off while a key is held ("ignore touchpad while typing"). The browser then never receives mouse movement, so no code can fix looking with the touchpad while holding WASD. Arrow keys turn while walking (and are named in the tutorial and the first hint); a gamepad right stick or a USB mouse also avoids it.
- Hands-free walking for touchpad laptops: F toggles auto-walk (S or pressing it again stops; it also stops on pause). After one tap the keys are free, so the touchpad works while walking. F3 opens an input test (mouse events, capture state, keys held) to prove what the browser receives. Both are rebindable (Controls page).
