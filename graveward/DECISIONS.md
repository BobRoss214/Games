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
* Bosses: Sarcophagus Colossus (chest cracks open after fist slams), Jackal King (heads take double damage mid-attack), Bandage Mother (unwrap both arms to expose the core). Boss HP scales up by 28% per missing Ghost and bot Ghosts fill the empty parts. Phases at 66% and 33% add falling rocks and faster parts.
* Treasure rooms are usually guarded by pentagrams so they lock: tempting and dangerous.
* Hero XP table is 75/190/340/540/800/1130/1530/2000/2550 to reach levels 2-10, tuned with bot sims so a good Hero reaches 10 around floors 4-5.
* If floors run out, depth loops with the themes repeating and monsters scaling, so the game never dead-ends before someone reaches the boss.
* Bots: three skills that change think rate, aim error, dodge/block chance and how quickly Ghosts commit. Ghost bots claim targets so they do not all take the same pentagram.
* Lighting is intentionally dark: ambient is cold blue-black, torches are warm and few, and ghosts near the Hero stutter torches and the lantern, so a flicker tells the Hero they are being watched.

## Balance results (headless bot matches)

At the final settings (4 bots, normal), 10 consecutive seeds: 0 crashes or stalls, about 60% ended in a boss victory and 40% in the "devoured" ending, 19-37 min of game time (median about 26), 19-59 Hero swaps. Humans think slower than bots, so real matches run longer.

Not done: the two bonus bosses (Sand Devourer, Beating Heart), online multiplayer, damage numbers.
