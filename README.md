# SUPER RACERS — Neon Deathmatch 🏎️💥

> A fast-paced **3D multiplayer kart combat deathmatch** for the browser.
> Build speed, smash crates, grab a weapon and blow your friends off the map.
> Built with **Vite + Three.js + Socket.IO** — custom arcade physics, zero binary assets.

![status](https://img.shields.io/badge/build-vite-22e1ff) ![three](https://img.shields.io/badge/three.js-r180-ff2bd6) ![net](https://img.shields.io/badge/multiplayer-socket.io-b4ff39)

---

## ⚡ Quick start

```bash
npm install

# option A — one command (game + multiplayer relay)
npm run dev:all

# option B — two terminals
npm run dev        # game        → http://localhost:5173
npm run server     # relay       → http://localhost:3001
```

Open **http://localhost:5173**, click **ENTER THE ARENA**, then hit **PLAY NOW**.
Multiplayer is optional: if no relay answers, the game reports `OFFLINE` and every
mode keeps working with bots.

Production build:

```bash
npm run build      # → dist/
npm run preview    # or: npm start (serves dist/ + socket.io from one process)
```

---

## 🎮 Controls

| Action | Key |
|---|---|
| **Accelerate** | `W` / `↑` |
| **Brake / Reverse** | `S` / `↓` |
| **Steer left** | `A` / `←` (positive Y rotation) |
| **Steer right** | `D` / `→` (negative Y rotation) |
| **FIRE ABILITY** | `SPACE` (hard-coded) |
| **Drift / handbrake** | `SHIFT` |
| **Look behind** | `E` |
| **Scoreboard** | `TAB` (hold) |
| **Reset kart if stuck** | `R` |
| **Horn** | `Q` |
| **Pause** | `ESC` |
| **Orbit / zoom camera** | Mouse drag / wheel |

---

## 🔥 What's in the game

**Kart combat deathmatch**
- 8 hand-tuned kart skins with real physics trade-offs (top speed, acceleration, grip, armour).
- 8 abilities in the crate drop table: 🚀 Homing Missile · 🔫 Machine Gun · 🎇 Triple Rocket ·
  💣 Proximity Mine · 💥 Shockwave · 🔥 Nitro Boost · 🛡️ Energy Shield · 🔧 Nanite Repair.
- 20 respawning item crates, 6 boost pads, ramming damage, explosive knockback, kill streaks.

**3 arenas** — *Neon District*, *Reactor Core*, *Sky Way*. Each with its own palette, obstacle
layout, animated set-dressing, holographic core and boost pad placement.

**2 modes** — *Deathmatch* (first to 15/25 kills, or most kills in 5:00) and
*King of the Hill* (hold the central core to bank points).

**Bots with real brains** — skill-scaled pursuit AI: crate looting, circle-strafing, target
leading, whisker-based obstacle avoidance, drift discipline, trigger discipline per weapon,
finish-the-weak focus fire and unstick manoeuvres. Bots use the *same* physics as you.

**Online play** — create a room (`SR-1234`), share the code, race with up to 8 racers.
The host also simulates its bots, so a 1-player lobby is still chaotic. Snapshot relay at
20 Hz with client-side interpolation and owner-authoritative hit resolution.

**Feel & polish** — third-person chase camera with speed FOV, boost shake, drift, look-behind;
screen shake, pooled GPU particles (sparks, smoke, debris), explosion flashes, damage numbers,
directional damage indicators, hit markers, kill feed, live scoreboard, countdown, victory
ceremonies, bloom post-processing, procedural Web Audio engine note + synthesised SFX/music,
XP levelling with skin unlocks, and settings that persist in `localStorage`.

---

## 🧱 Project structure

```
index.html                  # full UI markup: boot, menu, garage, lobby, HUD, pause, results
style.css                   # hand-built arcade UI (glass panels, neon signage, responsive)
vite.config.js              # 0.0.0.0 dev host + /socket.io → relay proxy
src/
  main.js                   # entry point: wires profile/audio/engine/HUD/menu/net, game loop
  game/
    engine.js               # Three.js renderer, showroom⇄arena scene transitions, FX, camera
    physics.js              # custom arcade physics: AABB + circle + raycast collision world
    input.js                # keyboard + pointer input (W A S D, SPACE = ability)
    combat.js               # crates, ability roster, projectiles, damage, kills
    ai.js                   # bot brains (pursuit, looting, avoidance, trigger discipline)
    arena.js                # 3 arena layouts: colliders, spawns, boost pads, themes
    audio.js                # procedural Web Audio: engine, weapons, UI, music
  graphics/
    karts.js                # procedural 3D kart model (chassis, wheels, flames, glow)
    textures.js             # canvas-generated textures (grids, glows, crates, sky)
  ui/
    menu.js                 # menu/lobby/results controller: modals, garage, toasts, settings
    hud.js                  # health, speedo, ability slot, kill feed, scoreboard, FX layers
    profile.js              # skins, stats, XP progression, persisted settings
  network/
    multiplayer.js          # socket.io client: rooms, 20 Hz state, remote kart interpolation
server/
  server.js                 # Socket.IO relay + static dist/ hosting (also /health, /rooms)
scripts/
  smoke-test.js             # headless test suite for physics, combat, AI, arena, protocol
  dev-all.js                # runs the dev server + relay together
```

---

## 🗺️ Multiplayer protocol (short version)

| Direction | Event | Purpose |
|---|---|---|
| C→S | `room:create` / `room:join` / `room:leave` / `room:config` | room lifecycle |
| C→S | `match:start` | host announces config + the entity ids it simulates |
| C→S | `net:state` | 20 Hz position/health snapshot of owned entities |
| C→S | `net:hit` / `net:crate` / `net:death` | hit, pickup and death reports |
| S→C | `room:update` · `match:start` · `net:snapshot` | lobby + world sync |
| S→C | `net:hit` · `net:crate` · `net:kill` · `match:end` | routed events, score, winner |

The relay is authoritative-lite: it routes hits to the client that owns the target entity,
tallies kills/deaths, and declares the winner when the kill target is reached.

---

## 🧪 Tests

```bash
node scripts/smoke-test.js
```

104 assertions covering the contracts that matter:

- **steering** — `A` produces **positive** Y rotation and arcs world −X, `D` produces
  **negative** Y rotation and arcs world +X, `W` moves along the kart's local forward vector
- AABB wall collision, no tunnelling, drift engagement, kart-vs-kart separation
- arena builds for all three themes, every generated spawn and crate is obstacle-free
- **chase camera sits behind the kart** (never in front) and look-behind flips it
- crate pickup → ability trigger → damage → shield absorption → attributed kill → respawn
- 60-second simulated bot deathmatch with no NaN and a finite, contained physics state
- server protocol surface (`room:*`, `net:*`, `/health`)

---

## 🚀 Deployment

Any static host for the client (`npm run build` → `dist/`).
For multiplayer, run the relay somewhere reachable (`node server/server.js`, `PORT` env respected)
and point players at it in **Settings ▸ SERVER URL** — the game defaults to connecting to its own
origin, and Vite proxies `/socket.io` to the relay in development.

Vercel/Netlify: build `npm run build`, output `dist/`. The relay can run on Render/Fly/Railway
(any Node host); it also serves `dist/` itself, so a single process can host everything.
