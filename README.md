# PORTFALL — a three.js tactical FPS

**One port. Two crews. Forty seconds of fuse.**

PORTFALL is a round-based tactical FPS set in a container port at dusk. Two
five-bot crews fight over two cargo sites: the Breakers arm a Hullbreaker
charge, the Harborwatch hold the cranes and the cold store. Money earned round
to round buys rifles, armor and utility, accuracy beats spray, and every round
is a small economy and a smaller war. One original map, full bot squads with
roles, a complete buy phase — all in static files on three.js, no build step,
no network.

## How a match works

- First to 9 round wins, max 16 rounds; sides swap after round 8.
- Buy/freeze 15 s → Live 105 s → if the charge is armed, the round extends to
  the 40 s fuse → End screen 5 s with the winner, reason and income.
- Breakers win by eliminating the Harborwatch or detonating the charge.
  Harborwatch win by pulling the charge or by timer expiry with no charge armed.
- Arming takes 4.0 s on a site pad; pulling takes 6.0 s (3.0 s with an
  Override Key). The charge carrier drops it on death; anyone on the attacking
  team can pick it up.

## Systems

- **Economy:** start $800. Round win $1,900 ($2,100 by objective); loss
  $1,400 + $500 per consecutive loss (cap $2,900); kill $300; arming $300;
  pulling $300. Prices: Mule .50 $700, Sparrow-9 $1,250, Breakwater 12
  $1,100, Kestrel AR $2,700, Gullwing DMR $3,100, Harpoon-7 $4,350, Weave Vest
  $650, Weave + Cap $1,000, Override Key $400, Scrap Grenade $300, Flare Pop
  $200, Fog Canister $300. Weapons and armour persist until death.
- **Gunplay:** headshots ×4 (×2 shotgun), spread that blooms while moving and
  tightens standing or crouched, first-shot accuracy, vertical recoil, damage
  falloff, armour that absorbs 50%.
- **Bots:** Leader / Entry ×2 / Support / Anchor per team. They buy by role,
  roll out on waypoint routes, hold angles, engage in 3–5 round bursts with a
  0.45 s reaction delay, hear gunfire within 25 m, rotate to retake, and arm
  or pull the charge on their own. They finish full rounds with no human input.
- **The map:** Kestrel Bay Terminal, 110 × 80 m. Site A — Crane Row, under a
  gantry crane (amber beacon). Site B — Cold Store warehouse interior (cyan
  beacon). Mid — Customs Yard with container rows and an inspection arch.
  Connectors: Customs Link, Service Run, and an exposed elevated Catwalk.

## Controls

WASD move · Mouse look · Click fire · R reload · B buy menu · E arm / pull
charge · 1/2/3 weapon slots · 4/5/6 Scrap / Flare / Fog · Shift sneak ·
Ctrl crouch · Space jump · Right mouse scope (Harpoon-7) · Tab scoreboard.

## Originality

All names, the map, the art and the sounds are original and generated
procedurally for this entry. The game is Counter-Strike-STYLE (round,
objective and economy structure) and copies no commercial game's assets,
names, maps or audio.

## Tech notes

- three.js 0.187.0, vendored from the kit, byte for byte. Static files, no
  build step, no network at runtime. All textures are canvas-generated; all
  sounds are WebAudio-synthesised.
- Deterministic generator (`main.ts`): fixed-seed PRNG, no timestamps, two
  runs write byte-identical output.
- Fixed 60 Hz simulation apart from rendering; merged static geometry,
  instanced props, one shadow-casting light; ~120 draw calls max, 60 fps target.
- Serve locally: `node serve.ts`, then open http://localhost:8080.
- Screenshots: `?shot=cover|sitea|buy|siteb&seed=N` renders a deterministic
  frame and sets `window.__shotReady`. Bot-only match test:
  `?botmatch=1&fast=1` runs a full match with no human input.
