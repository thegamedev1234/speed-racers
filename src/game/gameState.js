import { createKart } from '../graphics/kartModel.js';
import { ArcadeKartPhysics } from './kartPhysics.js';
import { SKINS } from '../ui/profile.js';

export const GAME_STATES = {
  MENU: 'MENU',
  COUNTDOWN: 'COUNTDOWN',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED'
};

const BOT_CONFIGS = [
  { name: 'TurboBot_X', skin: SKINS[1] || SKINS[0], colorHex: '#06b6d4' },
  { name: 'Apex_Rider', skin: SKINS[2] || SKINS[0], colorHex: '#10b981' },
  { name: 'Nitro_Ghost', skin: SKINS[3] || SKINS[0], colorHex: '#f59e0b' }
];

// Phase 2A pickup placeholders only; ability behavior is intentionally deferred.
const PICKUP_ABILITIES = [
  { id: 'nitro-boost', name: 'Nitro Boost', icon: '⚡', color: '#34f5d0' },
  { id: 'homing-missile', name: 'Homing Missile', icon: '🎯', color: '#ff5da2' }
];

export class GameStateManager {
  constructor({ graphicsManager, profileManager, soundSystem, onStateChange, onCountdownTick, onHUDUpdate, onItemPickup }) {
    this.graphics = graphicsManager;
    this.profile = profileManager;
    this.sound = soundSystem;
    this.onStateChange = onStateChange || (() => {});
    this.onCountdownTick = onCountdownTick || (() => {});
    this.onHUDUpdate = onHUDUpdate || (() => {});
    this.onItemPickup = onItemPickup || (() => {});

    this.state = GAME_STATES.MENU;

    // Showroom & Player kart
    this.playerKart = createKart(this.profile.getActiveSkin());
    this.graphics.scene.add(this.playerKart.root);

    // Lightweight arcade handling; keep the state object shared for HUD/race stats.
    this.physics = new ArcadeKartPhysics({ bounds: this.graphics.arenaBounds.drivableLimit });
    this.playerPhysics = this.physics.state;
    this.pickupAbility = null;
    this.pickupSequence = 0;
    this.bumpSoundCooldown = 0;

    // Bots array
    this.bots = [];

    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false,
      drift: false
    };

    // Match metadata
    this.matchOptions = {
      isPrivate: false,
      roomCode: null,
      gameMode: 'Free For All',
      botsEnabled: true,
      maxPlayers: 4
    };
    this.matchTimer = 0;
    this.countdownSeconds = 3;
    this.countdownTimerId = null;

    this.bindKeyboard();
  }

  bindKeyboard() {
    const controlKeys = new Set([
      'KeyW', 'ArrowUp', 'KeyS', 'ArrowDown',
      'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight', 'Space'
    ]);

    window.addEventListener('keydown', event => {
      const target = event.target;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (!controlKeys.has(event.code)) return;

      if (this.state === GAME_STATES.COUNTDOWN || this.state === GAME_STATES.PLAYING) {
        event.preventDefault();
      }

      switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.up = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.keys.down = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = true;
          break;
        case 'Space':
          this.keys.drift = true;
          break;
      }
    });

    window.addEventListener('keyup', event => {
      switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.up = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.keys.down = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = false;
          break;
        case 'Space':
          this.keys.drift = false;
          break;
      }
    });

    window.addEventListener('blur', () => this.resetKeys());
  }

  resetKeys() {
    this.keys.up = false;
    this.keys.down = false;
    this.keys.left = false;
    this.keys.right = false;
    this.keys.drift = false;
  }

  updatePlayerSkin() {
    const skin = this.profile.getActiveSkin();
    this.playerKart.applySkin(skin);
  }

  startMatch(options = {}) {
    this.matchOptions = {
      isPrivate: options.isPrivate || false,
      roomCode: options.roomCode || null,
      gameMode: options.gameMode || 'Free For All',
      botsEnabled: options.botsEnabled !== undefined ? options.botsEnabled : true,
      maxPlayers: options.maxPlayers || 4
    };

    this.state = GAME_STATES.COUNTDOWN;
    this.matchTimer = 0;
    this.pickupAbility = null;
    this.bumpSoundCooldown = 0;
    this.resetKeys();
    this.graphics.arena.resetCrates();
    this.onStateChange(this.state, this.matchOptions);

    // Position the player at the starting grid, facing toward +Z.
    this.physics.reset({ x: 0, z: 15, rotationY: 0 });
    this.playerKart.root.position.set(0, 0, 15);
    this.playerKart.root.rotation.set(0, 0, 0);

    // Clear previous bots
    this.clearBots();

    // Spawn 3 Bot Karts if enabled
    if (this.matchOptions.botsEnabled) {
      this.spawnBots();
    }

    // Switch camera to in-game chase camera
    this.graphics.setCameraGame(this.playerKart);

    // Begin Countdown 3... 2... 1... GO!
    this.runCountdown();
  }

  spawnBots() {
    const spawnOffsets = [
      { x: -5.5, z: 12, rot: 0 },
      { x: 5.5, z: 12, rot: 0 },
      { x: 0, z: 7, rot: 0 }
    ];

    BOT_CONFIGS.forEach((botCfg, idx) => {
      const offset = spawnOffsets[idx % spawnOffsets.length];
      const botKart = createKart(botCfg.skin);
      botKart.root.position.set(offset.x, 0, offset.z);
      botKart.root.rotation.y = offset.rot;

      this.graphics.scene.add(botKart.root);

      this.bots.push({
        id: `bot_${idx}`,
        name: botCfg.name,
        colorHex: botCfg.colorHex,
        kart: botKart,
        x: offset.x,
        z: offset.z,
        rotationY: offset.rot,
        speed: 0,
        targetSpeed: 16 + Math.random() * 5,
        steer: 0,
        wanderTimer: Math.random() * 2,
        wanderDir: 0,
        distanceTraveled: 0
      });
    });
  }

  clearBots() {
    this.bots.forEach(b => {
      this.graphics.scene.remove(b.kart.root);
    });
    this.bots = [];
  }

  runCountdown() {
    let count = 3;
    this.onCountdownTick(count);
    this.sound.playCountdownTick();

    clearInterval(this.countdownTimerId);
    this.countdownTimerId = setInterval(() => {
      count--;
      if (count > 0) {
        this.onCountdownTick(count);
        this.sound.playCountdownTick();
      } else if (count === 0) {
        this.onCountdownTick('GO!');
        this.sound.playCountdownGo();
        this.sound.startEngine();
        this.state = GAME_STATES.PLAYING;
        this.onStateChange(this.state, this.matchOptions);
      } else {
        clearInterval(this.countdownTimerId);
        this.onCountdownTick(null); // Clear countdown display
      }
    }, 1000);
  }

  exitToMenu() {
    clearInterval(this.countdownTimerId);
    this.sound.stopEngine();
    this.state = GAME_STATES.MENU;
    this.clearBots();
    this.resetKeys();
    this.pickupAbility = null;
    this.graphics.arena.resetCrates();

    // Reset player position to the showroom origin.
    this.physics.reset({ x: 0, z: 0, rotationY: 0 });
    this.playerKart.root.position.set(0, 0, 0);
    this.playerKart.root.rotation.set(0, 0, 0);

    this.graphics.setCameraShowroom();
    this.onStateChange(this.state);
  }

  update(dt) {
    if (this.state === GAME_STATES.MENU) {
      // Rotate kart in showroom based on graphics showroom spin
      const spin = this.graphics.update(dt);
      this.playerKart.root.rotation.y = spin;
      this.playerKart.update({ speed: 0, steer: 0, dt, isDrifting: false });
      return;
    }

    if (this.state === GAME_STATES.COUNTDOWN) {
      // Camera updates and engine idle during countdown
      this.graphics.update(dt, 0);
      this.playerKart.update({ speed: 0, steer: 0, dt, isDrifting: false });
      this.bots.forEach(bot => {
        bot.kart.update({ speed: 0, steer: 0, dt, isDrifting: false });
      });
      return;
    }

    if (this.state === GAME_STATES.PLAYING) {
      this.matchTimer += dt;

      // 1. Update Player Physics
      this.updatePlayerPhysics(dt);

      // 2. Update Bots AI
      this.updateBotsAI(dt);

      // 3. Audio & Camera Update
      const speedNorm = this.playerPhysics.speed / this.playerPhysics.maxSpeed;
      this.sound.updateEngine(speedNorm);
      this.graphics.update(dt, this.playerPhysics.speed);

      // 4. Update HUD Stats & Standings
      this.broadcastHUD();
    }
  }

  updatePlayerPhysics(dt) {
    const p = this.playerPhysics;
    const throttle = this.keys.up === this.keys.down
      ? 0
      : (this.keys.up ? 1 : -1);
    const steer = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    const movement = this.physics.step({
      dt,
      throttle,
      steer,
      drifting: this.keys.drift
    });

    if (this.bumpSoundCooldown > 0) {
      this.bumpSoundCooldown = Math.max(0, this.bumpSoundCooldown - dt);
    }
    if (movement.collided && movement.impactSpeed > 5 && this.bumpSoundCooldown === 0) {
      this.sound.playBump();
      this.bumpSoundCooldown = 0.35;
    }

    const crate = this.graphics.arena.collectAlongPath(
      movement.startX,
      movement.startZ,
      movement.endX,
      movement.endZ
    );
    if (crate) this.grantPickupAbility(crate);

    this.playerKart.root.position.set(p.x, 0, p.z);
    this.playerKart.root.rotation.y = p.rotationY;
    this.playerKart.update({
      speed: p.speed,
      steer: p.steer,
      dt,
      isDrifting: p.isDrifting
    });
  }

  grantPickupAbility(crate) {
    const ability = PICKUP_ABILITIES[Math.floor(Math.random() * PICKUP_ABILITIES.length)];
    this.pickupAbility = { ...ability, slotId: ++this.pickupSequence };

    this.sound.playPickup();
    this.onItemPickup(this.pickupAbility, crate);
  }

  updateBotsAI(dt) {
    const boundLimit = this.graphics.arenaBounds.drivableLimit - 0.8;
    const avoidDistance = 14.0;

    this.bots.forEach(bot => {
      // 1. Wander Timer updates
      bot.wanderTimer -= dt;
      if (bot.wanderTimer <= 0) {
        bot.wanderTimer = 1.2 + Math.random() * 2.0;
        bot.wanderDir = (Math.random() - 0.5) * 1.8;
        bot.targetSpeed = 14 + Math.random() * 7;
      }

      // 2. Wall Avoidance Steering
      let wallAvoidanceSteer = 0;
      if (bot.x > boundLimit - avoidDistance) {
        wallAvoidanceSteer -= 1.2; // Positive yaw steers right; turn left toward center.
      } else if (bot.x < -boundLimit + avoidDistance) {
        wallAvoidanceSteer += 1.2;
      }

      if (bot.z > boundLimit - avoidDistance) {
        wallAvoidanceSteer += (bot.x > 0 ? -1 : 1) * 1.0;
      } else if (bot.z < -boundLimit + avoidDistance) {
        wallAvoidanceSteer += (bot.x > 0 ? 1 : -1) * 1.0;
      }

      // Combine wander steering with wall avoidance
      const desiredSteer = wallAvoidanceSteer !== 0 ? wallAvoidanceSteer : bot.wanderDir;
      bot.steer += (desiredSteer - bot.steer) * 2.5 * dt;

      // Speed acceleration towards target speed
      bot.speed += (bot.targetSpeed - bot.speed) * 1.8 * dt;

      // Update bot rotation
      bot.rotationY += bot.steer * dt * 1.8;

      // Velocity move
      const forwardX = Math.sin(bot.rotationY);
      const forwardZ = Math.cos(bot.rotationY);

      let nextX = bot.x + forwardX * bot.speed * dt;
      let nextZ = bot.z + forwardZ * bot.speed * dt;

      // Clamp bot to arena bounds
      if (Math.abs(nextX) > boundLimit) {
        nextX = Math.sign(nextX) * boundLimit;
        bot.rotationY += Math.PI * 0.7; // Turn around
      }
      if (Math.abs(nextZ) > boundLimit) {
        nextZ = Math.sign(nextZ) * boundLimit;
        bot.rotationY += Math.PI * 0.7;
      }

      bot.x = nextX;
      bot.z = nextZ;
      bot.distanceTraveled += bot.speed * dt;

      // Update Three.js model
      bot.kart.root.position.set(bot.x, 0, bot.z);
      bot.kart.root.rotation.y = bot.rotationY;
      bot.kart.update({
        speed: bot.speed,
        steer: bot.steer,
        dt,
        isDrifting: false
      });
    });
  }

  broadcastHUD() {
    // Calculate speed in km/h (speed * 3.6 conversion for realistic arcade feel)
    const kmh = Math.round(Math.abs(this.playerPhysics.speed) * 3.6);

    // Calculate standings by distance / score
    const racers = [
      {
        name: this.profile.getUsername(),
        isPlayer: true,
        score: Math.floor(this.playerPhysics.distanceTraveled * 10),
        color: '#ef4444'
      },
      ...this.bots.map(b => ({
        name: b.name,
        isPlayer: false,
        score: Math.floor(b.distanceTraveled * 10),
        color: b.colorHex
      }))
    ];

    racers.sort((a, b) => b.score - a.score);
    racers.forEach((r, idx) => {
      r.position = idx + 1;
    });

    const playerRank = racers.find(r => r.isPlayer)?.position || 1;

    this.onHUDUpdate({
      speedKmh: kmh,
      matchTimer: this.matchTimer,
      racers,
      playerRank,
      gameMode: this.matchOptions.gameMode,
      roomCode: this.matchOptions.roomCode,
      activeAbility: this.pickupAbility
    });
  }
}
