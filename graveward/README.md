# GRAVEWARD

A first-person, pixelated, bloody dungeon crawler for **1 to 4 local players**, in the browser. One player is the living **Hero** fighting through a cursed tomb. Everyone else is a **Ghost** who possesses monsters, traps and statues to kill them. **Whoever lands the killing blow becomes the new Hero.** Reach level 10, enter the portal and slay the boss (controlled by the Ghosts) to win. You get three boss attempts in total, then the beast is free and everybody loses.

It is inspired by the structure of *Crawl* (Powerhoof), translated into a Doom-style first-person view. Every sprite, texture, sound and music track is generated in code. There are no asset files and no dependencies.

## Run it

No install and no build step.

```bash
cd graveward
python3 -m http.server 8000        # or: npm run dev
# open http://localhost:8000
```

ES modules need an HTTP server, so opening `index.html` straight from disk will not work.

Static build (a plain copy you can host anywhere: itch.io, GitHub Pages, S3):

```bash
npm run build                      # -> dist/ (about 500 KB, 29 files)
python3 -m http.server -d dist 8000
```

## Playing

Title -> **Play** -> match setup (total players 2-4, bot skill, floors, gore, seed) -> **lobby**.
In the lobby each human joins with a button press and picks a god:

| Device | Join | Move | Look | Attack | Alt (block / ability 2) | Interact | Dodge |
|---|---|---|---|---|---|---|---|
| **Keyboard + mouse (P1)** | `Space` / click | `WASD` | mouse (or `J`/`L`) | left click | right click | `E` | `Space` |
| **Keyboard 2 (P2)** | `Enter` | arrows (`,` `.` strafe) | left/right arrows | `Enter` | right `Shift` | `'` | `/` |
| **Gamepad (Xbox layout)** | `A` | left stick | right stick | `RT` | `LT` | `A` | `B` |

More keys: `R` cast spell / ability 3 (pad `X`), `T` next spell / haunt jump (pad `RB`), `Q` potion (pad `Y`), `G` next potion, `X` swap weapon (pad `LB`), `Shift` sprint (pad `L3`), `Tab` / `Esc` / pad `Start` pause. Everything is rebindable under **Options -> Rebind controls**. Gamepads hot-plug; unplugging one pauses the game.

Any slot that is not a human is a **bot**, so a solo game is 1 human + 3 bots. Bots play both Hero and Ghost roles, and fill unused boss parts.

### The rules in one screen

* **Opening room**: everybody starts as a Hero in a sealed antechamber. Last one standing becomes the first Hero. After 90 s, spikes close in from the walls (sudden death).
* **Hero**: kill monsters, open chests, smash pots for gold, shop, level up (1-10). Level 3 heavy attack (hold), 4 spell slot, 5 dodge roll, 6 block / parry, 7 second spell slot, 10 portal.
* **Rooms lock** when the Hero is inside and any monster, unused pentagram or red crystal remains. The exit trapdoor stays sealed until its room is clear.
* **Ghosts** are invisible to the Hero. Float to a **pentagram** to become one of your god's three monsters, **possess traps**, wake **statues** into giants, haunt props, and collect **ectoplasm** (6 = a slime anywhere). Hurting the Hero earns **Blood**. Every Hero level-up gives everyone else **Wrath**, which you spend between floors to **evolve** your monsters (3 tiers each).
* **Gods**: Ossuar (bone, monsters shrug off the first killing blow), Vorrath (flesh, life-steal), Ashkeleth (mummies, +25% trap damage).
* **Boss**: three to choose from at random, each controlled by the Ghosts (one part each). Only **three attempts** in the whole match. Win with any Hero, at any level, by killing it.

There is a full **How to play** in the game (title menu), plus one-time contextual hints.

## Tools and tests

Everything below runs on Node 22 with no dependencies, except the browser tests, which need Playwright (`npm i -g playwright`, or set `CHROMIUM_PATH`).

| Command | What it does |
|---|---|
| `npm test` | 252 content checks (every monster ability at every tier, every weapon and rarity, spell, potion, artifact, trap, prop haunt, statue, pentagram, all 5 bosses) + 6 full headless bot matches |
| `node tools/sim.mjs --matches 20 --seed 100 --players 4 --skill hard` | Bot-vs-bot simulations with a stall watchdog. Options: `--matches --seed --minutes --floors --players (2-4) --skill (easy/normal/hard) --hz --verbose` |
| `npm run test:browser` | Real-browser end-to-end tests: keyboard menu flow, two-keyboard lobby, movement/attacks, pause, defocus, gamepad (injected fake pad, hot-unplug), audio engine |
| `node tools/shots.mjs <name> [--humans 0 --ff 120 --seed 5 --views 4 --js "..."]` | Screenshots a scenario after fast-forwarding the sim (uses `?auto=1`) |
| `node tools/timeline.mjs 600 <seed> 30` | Prints who is Hero / what everyone is doing over time |

URL parameters: `?seed=123&players=3&gore=3&skill=hard&floors=6&pixel=fine&debug=1`, and `&auto=1&humans=1` to skip the menus. `debug=1` shows FPS and exposes `window.graveward`.

## How it is built

```
index.html  style.css  game.js        bootstrap
src/
  util.js            seeded RNG, math, colour packing
  sprites_real.js    realism pass for sprites: 2x shading, grime, HP-based wounds
  sprites_gore.js    gib sprites (limbs, skulls, ribs, meat)
  textures.js        procedural 64x64 textures, then a realism pass upscales them to 128x128 (relief, AO, grime, colour grade)
  pixart.js          tiny pixel-painting toolkit (ellipse, limb, outline...)
  sprites_mon.js     monsters, statues, hero, wisp  (3 evolution tiers each)
  sprites_misc.js    props, pickups, projectiles, bosses, first-person weapons
  sprites.js         lazy sprite/frame registry
  renderer.js        software raycaster: DDA walls, floor casting, sprites,
                     baked+animated light kernels, AO, ordered-dither palette
  map.js             tile grid, doors, persistent blood masks
  dungeon.js         seeded floor generator, room types, opening room, boss map
  data.js            ALL content as data: monsters, gods, weapons, spells, bosses...
  items.js           weapon rarity/effects, chest loot, shop stock
  world.js           entities, collision, LOS, A* pathfinding
  combat.js          damage pipeline, statuses, abilities, projectiles, hazards
  hero.js            Hero controls, progression, inventory, interactions
  ghost.js           Ghost form, possession, traps, props, monster control
  boss.js            5 bosses, weak-spot rules, phases
  tutorial.js        scripted tutorial map + steps (sim-side)
  match.js           the director: phases, role swap, locks, upgrade, portal
  ai.js              Hero bot, Ghost bot, trap bot, monster AI
  scene.js           cameras, sprite lists, torch flicker & dynamic lights
  fx.js hud.js font.js ui.js audio.js input.js game.js   presentation
tools/               sim, smoke, e2e, screenshots, build
```

Design notes:

* **Sim / presentation split.** `match.js` and everything it imports run in plain Node, so the same code plays headless bot matches in CI-style tests and drives the browser.
* **Rendering.** A custom CPU raycaster renders each viewport into a low-res `ImageData` (480x270 total, or 640x360 in options), upscaled with nearest-neighbour. Torch light is baked into a 4x4-per-cell lightmap per torch (with line of sight) and animated by adding/subtracting each torch's kernel every frame, so flicker, ghost-proximity stutter, snuffed torches and pulsing curse rooms cost almost nothing. A contrast curve, wall/floor ambient occlusion and 14-level ordered dithering give the Doom-mod grit. Four viewports cost about 6-7 ms/frame.
* **Determinism.** Gameplay RNG is seeded per match, so a seed reproduces the same dungeon and (for bots) the same match.
* **Audio.** The Web Audio API synthesizes 63 sound effects, per-floor ambience (drone, wind, drips, chains), a reverb bus, spatial panning per viewer, and a layered score (menu, explore, combat, boss, victory, defeat) that responds to danger.

See `DECISIONS.md` for the reasoning behind the main choices and what was researched.

## Status and next steps

The full loop (title -> lobby -> antechamber -> 5+ floors -> upgrade screens -> portal -> a random boss of 5 -> ending) is playable start to finish by any mix of humans and bots and has been simulated across hundreds of seeds without crashes or softlocks.

**Thrown and shot objects use real gravity** (`combat.js`): arrows, bolts, knives, stones, bone shards, spit and ghost-thrown props arc and fall; knives, stones, shards and bones bounce, roll and come to rest (a missed throwing knife becomes a pickup); pots shatter; fireballs and other magic fly straight. Shots leave with a small automatic upward speed so aim stays fair at normal range and only long shots drop. Hits are height-aware (a high lob passes over a short target) and a ground shadow shows where airborne things will land. `node tools/physics.mjs` checks all of it, including 30 Hz vs 60 Hz agreement.

The **TUTORIAL** entry on the title screen runs a scripted 22-step lesson (`src/tutorial.js`): look, move, smash pots, fight, heavy attack, dodge, block, potion, spell, chest, shop, then a ghost lesson (float, possess a pentagram, attack a practice hero). Doors stay sealed until each step is done; the panel shows your own keys and Xbox buttons. `node tools/tutorial.mjs` plays it headless with an autopilot; `node tools/e2e-tutorial.mjs` checks it in a real browser.

Ideas I did not get to: online play, damage numbers, and a Ghost minimap in single-viewport mode.
