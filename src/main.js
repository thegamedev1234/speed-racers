import '../style.css';
import { ProfileManager } from './ui/profile.js';
import { SoundSystem } from './game/audio.js';
import { GraphicsManager } from './graphics/scene.js';
import { GameStateManager, GAME_STATES } from './game/gameState.js';
import { MenuUI } from './ui/menuUI.js';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) {
    console.error('Canvas element #bg-canvas not found.');
    return;
  }

  // 1. Initialize Profile Manager
  const profileManager = new ProfileManager();

  // 2. Initialize Audio System
  const soundSystem = new SoundSystem(profileManager);

  // 3. Initialize Three.js Graphics Scene & Showroom
  const graphicsManager = new GraphicsManager(canvas);

  let ui = null;

  // 4. Initialize Game State Manager
  const gameState = new GameStateManager({
    graphicsManager,
    profileManager,
    soundSystem,
    onStateChange: (state, matchOptions) => {
      if (state === GAME_STATES.MENU) {
        ui.setMenuView();
      } else if (state === GAME_STATES.COUNTDOWN || state === GAME_STATES.PLAYING) {
        ui.setGameView(matchOptions);
      }
    },
    onCountdownTick: (value) => {
      ui.showCountdown(value);
    },
    onHUDUpdate: (hudData) => {
      ui.updateHUD(hudData);
    }
  });

  // 5. Initialize Menu UI
  ui = new MenuUI({
    profileManager,
    soundSystem,
    onStartPlay: (options) => {
      gameState.startMatch(options);
    },
    onJoinRoom: (roomCode) => {
      gameState.startMatch({
        isPrivate: true,
        roomCode,
        gameMode: 'Private Match',
        botsEnabled: true,
        maxPlayers: 4
      });
    },
    onCreateRoom: (options) => {
      gameState.startMatch(options);
    },
    onExitMatch: () => {
      gameState.exitToMenu();
    },
    onSkinSelect: (skin, isCommitted) => {
      if (isCommitted) {
        gameState.updatePlayerSkin();
      } else {
        // Live preview on hover
        gameState.playerKart.applySkin(skin);
      }
    }
  });

  // 6. Main Game Loop with Clock / Delta Time
  let lastTime = performance.now();

  function animate(now) {
    requestAnimationFrame(animate);

    const dt = Math.min((now - lastTime) / 1000, 0.1); // clamp delta time
    lastTime = now;

    gameState.update(dt);
    graphicsManager.render();
  }

  requestAnimationFrame(animate);
});
