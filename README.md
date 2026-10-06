# SUPER RACERS 🏎️💨

> A fast-paced 3D browser-based kart combat game inspired by *Smash Karts*, built with Three.js, Vite, and modern web standards. Ready for one-click deployment on Vercel.

---

## 🌟 Features (Phase 1 Setup)

- **3D Showroom & Viewport:**
  - Fullscreen Three.js background canvas with soft ambient, directional, and rim studio lighting.
  - Procedural composite 3D Kart model with chassis body, front nose cone, headlights, side intake pods, cockpit, steering wheel, driver bobblehead with helmet and visor, chrome engine block with exhaust pipes, and 4 animated rolling wheels.
  - Interactive rotating pedestal with mouse/touch drag-to-rotate support.

- **Player Profile & Customization:**
  - Dynamic user profile with persistent `localStorage` support.
  - Auto-generated default username (`Racer_####`), editable via in-game modal with validation.
  - Level badge, XP bar, and currency balances (🪙 Coins and 💎 Gems).
  - Skin Garage with live 3D preview and 5 color schemes:
    - 🔴 **Red Comet** (Crimson body, gold accents)
    - 🔵 **Neon Blue** (Electric cyan, navy chassis)
    - 🟢 **Emerald Flash** (Venom green, carbon fiber details)
    - 🟡 **Golden Jet** (Championship gold alloy)
    - 🟣 **Cyber Purple** (Synthwave violet, neon pink highlights)

- **Arcade Menu & Navigation:**
  - Stylized 3D retro arcade game header with floating animation.
  - **PLAY (Instant vs Bots):** Transitions camera smoothly into the battle arena floor with a dramatic "3... 2... 1... GO!" countdown and spawns 3 AI bot racers.
  - **CREATE PRIVATE ROOM Modal:** Configurable game modes (*Free For All*, *Team Battle*, *Coin Rush*), player limits (4, 8, 12), bot-fill toggle, and room code generator.
  - **JOIN PRIVATE ROOM Input:** Code validator for room IDs (e.g. `SR-8921`) with status notifications.
  - **Bottom Control Bar:** Master volume / sound synthesizer toggle, server region selector (US-East, US-West, EU-Central, ASIA-East), and settings modal.

- **In-Game Match Arena Prototype:**
  - Responsive kart physics with acceleration, braking/reverse, steering, and drift mechanics.
  - 3 AI Bot karts featuring wander steering and arena wall avoidance.
  - Live HUD with digital speedometer (KM/H), race timer, live standings leaderboard, and Exit to Menu [ESC].
  - Zero-dependency Web Audio API sound effects for clicks, countdown ticks, GO chime, engine acceleration, and wall impacts.

---

## 📂 Project Structure

```
├── index.html              # Main HTML5 entry point & UI overlay markup
├── package.json            # Project dependencies and npm scripts
├── vite.config.js          # Vite configuration with 0.0.0.0 binding
├── style.css               # Arcade styling, glassmorphism UI, responsive design
└── src/
    ├── main.js             # Application initialization and main render loop
    ├── ui/
    │   ├── profile.js      # LocalStorage profile manager & skin catalog
    │   └── menuUI.js       # UI controllers, modal dialogs, and HUD bindings
    ├── graphics/
    │   ├── scene.js        # Three.js scene, camera modes, studio & arena environments
    │   └── kartModel.js    # Stylized 3D kart geometry, materials, and animations
    └── game/
        ├── gameState.js    # State machine, player physics, bot AI steering
        └── audio.js        # Web Audio API procedural sound synthesizer
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- npm or pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/thegamedev1234/speed-racers.git
cd speed-racers

# Install dependencies
npm install

# Start local development server
npm run dev
```

The game will be available at `http://localhost:5173`.

### Production Build

```bash
npm run build
npm run preview
```

---

## 🎮 Controls

| Action | Key(s) |
|---|---|
| **Accelerate** | `W` or `↑ Up Arrow` |
| **Brake / Reverse** | `S` or `↓ Down Arrow` |
| **Steer Left / Right** | `A` / `D` or `←` / `→` |
| **Drift / Power Slide** | `SPACE` |
| **Exit to Menu** | `ESC` |
| **Showroom Rotate** | Mouse Click & Drag / Touch Swipe |

---

## 🌐 Deployment to Vercel

The project includes standard Vite build scripts (`npm run build` outputs to `dist/`). To deploy:
1. Push code to GitHub repository `thegamedev1234/speed-racers`.
2. Connect the repository in Vercel.
3. Framework Preset: **Vite** (Build command: `npm run build`, Output directory: `dist`).
