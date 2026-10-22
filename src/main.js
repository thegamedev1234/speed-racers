/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SUPER RACERS — Neon Deathmatch
 *  3D multiplayer kart combat deathmatch. Entry point / game orchestrator.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Boot order:  ProfileManager → SoundSystem → Engine(showroom) → HUD → MenuUI
 *  Match order: CollisionWorld → arena build → karts → CombatSystem → loop
 */

import * as THREE from 'three';

import { ProfileManager, skinModifiers, getSkin } from './ui/profile.js';
import { SoundSystem } from './game/audio.js';
import { InputManager } from './game/input.js';
import { CollisionWorld, KartBody, resolveRamming, ARCADE } from './game/physics.js';
import { CombatSystem } from './game/combat.js';
import { Engine } from './game/engine.js';
import { HUD } from './ui/hud.js';
import { MenuUI } from './ui/menu.js';
import { NetworkManager } from './network/multiplayer.js';
import { BotBrain, createBotRoster } from './game/ai.js';
import { buildKartMesh } from './graphics/karts.js';
import { KART_SPAWNS, CRATE_SPAWNS, pickSpawnAwayFrom, generateSpawnPoints, THEMES } from './game/arena.js';
import {
  MatchStateManager, MATCH_STATE, matchDurationFor, MAX_DELTA, COUNTDOWN_SECONDS,
} from './game/match-state.js';

const WEAPON_ICONS = {
  missile: '🚀', triple: '🎇', mine: '💣', gun: '🔫', shockwave: '💥',
  boost: '🔥', shield: '🛡️', repair: '🔧', rocket: '🚀', ram: '💢', crash: '💀', self: '💀',
};

/** Fixed physics step — the loop sub-steps so a slow frame never spikes physics. */
const PHYSICS_STEP = 1 / 60;
/** Hard cap on sub-steps per frame (300 ms of catch-up, then time is dropped). */
const MAX_SUBSTEPS = 8;
/** How often a repeating frame error is allowed to reach the console (ms). */
const ERROR_LOG_THROTTLE = 1000;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class Game {
  constructor() {
    this.profile = new ProfileManager();
    this.audio = new SoundSystem(this.profile);
    // global keyboard: bound to `window`, so W A S D / SPACE / arrows work
    // without the canvas having to be clicked first (see focusGameWindow()).
    this.input = new InputManager(window);
    this.world = new CollisionWorld();

    this.engine = new Engine({
      container: document.getElementById('viewport'),
      profile: this.profile,
      callbacks: {
        onHurt: (amount, source) => this.onPlayerHurt(amount, source),
        onDamageNumber: (screen, text, kind) => {
          if (this.profile.settings.dmgNumbers) this.hud.damageNumber(screen, text, kind);
        },
        onHitMarker: (lethal) => this.hud.hitMarker(lethal),
      },
    });

    this.hud = new HUD();

    this.menu = new MenuUI({
      profile: this.profile,
      audio: this.audio,
      callbacks: {
        onPlay: (config) => this.startLocalMatch(config),
        onCreateRoom: (config) => this.createOnlineRoom(config),
        onJoinRoom: (code) => this.joinOnlineRoom(code),
        onLobbyStart: (config) => this.startOnlineMatch(config),
        onLobbyLeave: () => this.leaveLobby(),
        onLobbyConfig: (config) => this.net.updateLobbyConfig(config),
        onRematch: () => this.rematch(),
        onMainMenu: () => this.quitToMenu(),
        onSkinPreview: (skin) => this.engine.updateMenuSkin(skin),
        onSettingsChange: (key, value) => this.onSettingChanged(key, value),
      },
    });

    this.net = new NetworkManager({
      profile: this.profile,
      callbacks: {
        createVisual: (skin, entity) => this.createRemoteVisual(skin, entity),
        removeVisual: (visual) => this.removeRemoteVisual(visual),
        onStatus: (state, label) => this.menu.setNetStatus(state, label),
        onRoom: (payload) => this.onRoomUpdate(payload),
        onStart: (payload) => this.onNetworkMatchStart(payload),
        onHit: (payload) => this.onNetworkHit(payload),
        onCrate: (payload) => this.onNetworkCrate(payload),
        onKill: (payload) => this.onNetworkKill(payload),
        onMatchEnd: (payload) => this.onNetworkMatchEnd(payload),
        onPlayerLeft: (payload) => this.menu.toast('A racer left the arena', 'warn', '🚪'),
        onError: (message) => this.menu.toast(message, 'error', '⚠️'),
      },
    });

    this.combat = null;
    this.entries = [];          // { kart, visual, brain, entityId, ownerId, local }
    this.playerEntry = null;
    this.match = null;
    this.state = null;          // MatchStateManager for the running match
    this.mode = 'menu';
    this.paused = false;
    this.clock = new THREE.Clock();
    this.accum = 0;
    this.frame = 0;
    this.startedAt = 0;
    this.frameErrors = 0;
    this.lastFrameErrorAt = 0;
    this.lastErrorText = '';

    this.input.onEscape = () => {
      if (this.menu.activeModal) { this.menu.closeModals(); return; }
      this.togglePause();
    };
    this.bindExtraUI();
  }

  /* ══════════════════════════════════════════════════════════════
     BOOT
     ══════════════════════════════════════════════════════════════ */
  async start() {
    this.menu.buildGarage();
    await this.menu.runBoot();
    this.menu.showMenu();
    this.audio.startMusic('menu');

    // best-effort connection probe so the footer dot tells the truth
    this.net.connect().then((res) => {
      if (!res.ok) this.menu.setNetStatus('warn', 'OFFLINE · bot matches ready');
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.match && this.match.state === MATCH_STATE.PLAYING) this.setPaused(true);
    });

    this.clock.getDelta();
    this.loop();
  }

  loop = () => {
    // ⚠️  Everything — including the clock read and the input reset — lives
    //     inside this single try/catch. One unexpected error must never stop
    //     the frame: it is logged and the next frame runs normally, so the
    //     render loop can never freeze on the player.
    try {
      requestAnimationFrame(this.loop);

      // delta is hard-capped so a tab-switch, a GC pause or a slow frame can
      // never hand physics a 5-second step (NaN / infinite acceleration spikes).
      const raw = this.clock.getDelta();
      const dt = Number.isFinite(raw) ? Math.min(MAX_DELTA, Math.max(0, raw)) : 0;
      this.frame++;

      this.updateFrame(dt);
    } catch (err) {
      this.reportFrameError(err);
    } finally {
      // input edges (pressed/released this frame) are consumed exactly once,
      // even when the frame threw halfway through.
      try { this.input.endFrame(); } catch { /* noop */ }
    }
  };

  /** One frame: fixed-step simulation + a single render. */
  updateFrame(dt) {
    if (this.paused) {
      this.accum = 0;
      this.engine.update(dt, this.mode === 'menu' ? this.showroomCamTarget() : this.idleCamTarget());
      this.engine.render();
      return;
    }

    if (this.mode === 'menu') {
      this.accum = 0;
      this.engine.update(dt, this.showroomCamTarget());
      this.engine.render();
      return;
    }

    // Fixed-timestep accumulator: physics/HUD always see a stable 1/60 s step,
    // no matter how long the frame actually took.
    this.accum = Math.min(this.accum + dt, PHYSICS_STEP * MAX_SUBSTEPS);
    let steps = 0;
    while (this.accum >= PHYSICS_STEP && steps < MAX_SUBSTEPS) {
      this.accum -= PHYSICS_STEP;
      steps++;
      this.updateMatch(PHYSICS_STEP);
      if (this.mode !== 'match') break; // match ended mid-step (results screen)
    }
    if (steps === 0) this.updateMatch(dt); // first frame / very high refresh rate
    this.accum = Math.min(this.accum, PHYSICS_STEP);

    this.engine.render();
  }

  /** Throttled frame-error reporting — no console flooding, no freeze. */
  reportFrameError(err) {
    this.frameErrors++;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const text = String(err && err.stack ? err.stack : err);
    const repeat = text === this.lastErrorText;
    if (!repeat || now - this.lastFrameErrorAt > ERROR_LOG_THROTTLE) {
      this.lastFrameErrorAt = now;
      this.lastErrorText = text;
      console.error(`[Super Racers] frame error #${this.frameErrors}`, err);
    }
  }

  idleCamTarget() {
    const kart = this.playerEntry?.kart || { position: new THREE.Vector3(), yaw: 0, steer: 0, speed: 0, boostTimer: 0 };
    return {
      kart, speedRatio: 0, boosting: false, lookBehind: false,
      lookDelta: { x: 0, y: 0 }, zoom: 0, dragging: false,
    };
  }

  showroomCamTarget() {
    return {
      dragging: this.input.dragging,
      lookDelta: this.input.consumeLook(),
      zoom: this.input.consumeZoom(),
    };
  }

  /* ══════════════════════════════════════════════════════════════
     MATCH SETUP
     ══════════════════════════════════════════════════════════════ */
  /** PLAY NOW → single-player deathmatch against bots. */
  startLocalMatch(config = {}) {
    const conf = { mode: 'deathmatch', bots: 5, target: 15, arena: 'neon', ...config };
    this.menu.hide();
    this.beginMatch({
      config: conf,
      online: false,
      entities: [],
    });
  }

  createOnlineRoom(config) {
    // config comes straight from the "Create Private Game" modal (mode, timer /
    // kill limit, max players, weapons, arena, bots toggle, …) plus a unique
    // room code. The host is the authoritative client: it simulates bots, crate
    // spawns, score and the match clock for everyone in the room.
    const conf = { mode: 'deathmatch', bots: 3, target: 15, arena: 'neon', ...config };
    this.menu.toast('Creating room…', '', '🛰️');
    this.net.createRoom(conf).then((res) => {
      if (!res.ok) {
        this.menu.setNetStatus('err', 'NO SERVER · bot matches ready');
        this.menu.toast('No game server reachable — starting a bot match instead', 'warn', '🤖');
        this.startLocalMatch(conf);
      }
    });
  }

  joinOnlineRoom(code) {
    this.menu.toast(`Joining ${code}…`, '', '🛰️');
    this.net.joinRoom(code).then((res) => {
      if (!res.ok) {
        this.menu.setNetStatus('err', 'NO SERVER · bot matches ready');
        this.menu.toast('Could not reach the server — check Settings ▸ Server URL', 'error', '📡');
      }
    });
  }

  onRoomUpdate(payload) {
    this.lobbyConfig = payload.config;
    this.menu.showLobby({ code: payload.code, isHost: payload.isHost });
    this.menu.updateLobby({
      code: payload.code,
      players: payload.players.map((p) => {
        const skin = getSkin(p.skin);
        return { ...p, color: skin.body, accent: skin.accent };
      }),
      isHost: payload.isHost,
      config: payload.config,
    });
    if (!this.menu.toastShownForRoom) {
      this.menu.toast(`Room ${payload.code} — share the code to invite racers`, 'success', '🎟️');
      this.menu.toastShownForRoom = payload.code;
    }
  }

  /** Host pressed START MATCH in the lobby. */
  startOnlineMatch(config) {
    if (!this.net.connected) {
      this.menu.toast('Server offline — starting bots only', 'warn', '🤖');
      this.startLocalMatch(config);
      return;
    }
    const myId = this.net.socket.id;
    const conf = { ...this.lobbyConfig, ...config };
    const entities = [{
      id: myId, ownerId: myId, name: this.profile.name, skin: this.profile.skinId, isBot: false,
    }];
    const botCount = conf.bots || 0;
    const roster = createBotRoster(botCount, { playerLevel: this.profile.level });
    roster.forEach((bot, i) => {
      entities.push({
        id: `${myId}#bot${i}`, ownerId: myId, name: bot.name, skin: bot.skin.id, isBot: true, skill: bot.skill,
      });
    });
    this.pendingRoster = roster;
    this.net.startMatch(conf, entities);
  }

  /** Everyone (host + clients) receives match:start. */
  onNetworkMatchStart(payload) {
    const myId = this.net.socket.id;
    const roster = this.pendingRoster || createBotRoster(0);
    this.pendingRoster = null;

    const entities = payload.entities.map((e, i) => {
      const bot = roster[i - 1] || roster.find((b) => b.name === e.name);
      return {
        ...e,
        local: e.ownerId === myId,
        skill: e.isBot ? (bot?.skill ?? 0.55) : 0.6,
        aggression: e.isBot ? (bot?.aggression ?? 0.5) : 0.6,
        modBias: e.isBot ? (bot?.modBias ?? 1) : 1,
      };
    });

    // Bots we simulate are declared by us and appear in our own roster order.
    const myBots = entities.filter((e) => e.local && e.isBot);
    myBots.forEach((e, i) => {
      const bot = roster[i];
      if (bot) { e.skill = bot.skill; e.aggression = bot.aggression; e.modBias = bot.modBias; }
    });

    this.menu.hide();
    this.beginMatch({ config: payload.config, online: true, entities, startAt: payload.startAt });
  }

  leaveLobby() {
    this.net.leaveRoom();
    this.menu.toastShownForRoom = null;
    this.menu.showMenu();
    this.menu.setNetStatus(this.net.connected ? 'ok' : 'warn', this.net.connected ? 'ONLINE · ready' : 'OFFLINE · bot matches ready');
  }

  /* ══════════════════════════════════════════════════════════════
     MATCH LIFECYCLE
     ══════════════════════════════════════════════════════════════ */
  beginMatch({ config, online, entities = [], startAt = 0 }) {
    const theme = THEMES[config.arena] ? config.arena : 'neon';
    const mode = config.mode === 'koth' ? 'koth' : 'deathmatch';
    const target = config.target === 'time' ? 'time' : Number(config.target) || 15;

    this.mode = 'match';
    this.paused = false;
    this.entries = [];
    this.playerEntry = null;

    // 1) fresh collision world + arena scene (the hard scene swap)
    this.world.clear();
    this.arena = this.engine.buildArenaScene(theme, this.world);
    this.hud.fade(true, 'ENTERING ARENA');
    setTimeout(() => this.hud.fade(false), 260);

    // 2) crates
    this.combat?.dispose();
    this.combat = new CombatSystem({
      scene: this.engine.scene,
      world: this.world,
      audio: this.audio,
      fx: this.engine,
      buildCrate: this.engine.makeCrateBuilder(theme),
      getKarts: () => this.entries.map((e) => e.kart),
      getPlayer: () => this.playerEntry?.kart,
      events: {
        onKill: (killer, victim, weapon, selfDestruct) => this.onKill(killer, victim, weapon, selfDestruct),
        onCratePickup: (crate, kart, ability) => this.onCratePickup(crate, kart, ability),
        onAbilityUsed: (kart, ability) => this.onAbilityUsed(kart, ability),
        onStatus: (kart, status) => this.onStatus(kart, status),
        onDamage: (target, amount, source, opts) => this.onDamage(target, amount, source, opts),
      },
    });
    this.combat.spawnCrates(CRATE_SPAWNS);
    this.combat.externalDamageHandler = (target, amount, source, opts) => this.forwardDamage(target, amount, source, opts);

    // 3) karts — player first, then bots / remote entities
    this.spawnPool = generateSpawnPoints(this.world, 12);
    const spawns = [...this.spawnPool].sort(() => Math.random() - 0.5);
    let spawnIdx = 0;

    if (online) {
      this.myId = this.net.socket.id;
      entities.forEach((e) => {
        const skin = getSkin(e.skin);
        const spawn = spawns[spawnIdx++ % spawns.length];
        if (e.local) {
          const mods = skinModifiers(skin);
          const modBias = e.isBot ? e.modBias : 1;
          this.addKart({
            id: e.id, name: e.name, skin, spawn,
            mods: {
              maxSpeed: mods.maxSpeed * modBias,
              accel: mods.accel * modBias,
              grip: mods.grip * modBias,
              maxHealth: mods.maxHealth,
            },
            isPlayer: !e.isBot,
            local: true,
            isBot: e.isBot,
            skill: e.skill,
            aggression: e.aggression,
          });
        } else {
          // remote entity — visual + interpolated body only
          const entity = this.net.entities.get(e.id) || e;
          this.net.ensureRemote(entity);
          const remote = this.net.remotes.get(e.id);
          if (remote) {
            remote.kart.name = e.name;
            this.entries.push({
              kart: remote.kart, visual: remote.visual, entityId: e.id,
              ownerId: e.ownerId, local: false, isBot: !!e.isBot,
            });
          }
        }
      });
    } else {
      // player
      const playerSkin = this.profile.skin;
      this.addKart({
        id: 'player', name: this.profile.name, skin: playerSkin,
        spawn: spawns[spawnIdx++ % spawns.length],
        mods: skinModifiers(playerSkin), isPlayer: true, local: true,
      });
      // bots
      const roster = this.pendingRoster || createBotRoster(config.bots ?? 5, { playerLevel: this.profile.level });
      this.pendingRoster = null;
      roster.slice(0, config.bots ?? 5).forEach((bot) => {
        const mods = skinModifiers(bot.skin);
        this.addKart({
          id: bot.id, name: bot.name, skin: bot.skin,
          spawn: spawns[spawnIdx++ % spawns.length],
          mods: {
            maxSpeed: mods.maxSpeed * bot.modBias,
            accel: mods.accel * bot.modBias,
            grip: mods.grip * bot.modBias,
            maxHealth: mods.maxHealth,
          },
          isPlayer: false, local: true, isBot: true,
          skill: bot.skill, aggression: bot.aggression,
        });
      });
    }

    this.playerEntry = this.entries.find((e) => e.kart.isPlayer) || this.entries[0];

    // 3b) every kart is guaranteed spawnable + alive before the first step
    this.validateEntries();

    // 4) match state — one manager owns the countdown + the match clock.
    //    Timer rounds run for matchSeconds; kill-limit rounds run 3:00.
    const duration = matchDurationFor({ mode, target, matchSeconds: config.matchSeconds });
    this.state = new MatchStateManager({
      duration,
      countdown: COUNTDOWN_SECONDS,
      onCountdown: (text, sub, isNumber) => {
        this.hud.countdown(text, sub);
        this.audio.countdownBeep(!isNumber);
      },
      onStart: () => {
        // "GO!" stays on screen for a beat after the karts unlock
        const token = this.state;
        setTimeout(() => { if (this.state === token) this.hud.countdown(null); }, 420);
        this.hud.banner('FIGHT!', 'gold', 900);
        this.audio.countdownBeep(true);
      },
      onSecond: (seconds) => this.hud.setTimer(seconds),
      onTimeUp: () => this.endMatch('time-up'),
      onTick: (snap) => { this.match && (this.match.timeLeft = snap.timeLeft); },
    });

    this.match = {
      config, mode, target, online,
      state: MATCH_STATE.STARTING,      // mirrored from the state manager each frame
      countdown: COUNTDOWN_SECONDS,
      elapsed: 0,
      timeLeft: duration,
      scores: new Map(entities.map((e) => [e.id, { kills: 0, deaths: 0, streak: 0 }])),
      padCooldown: new Map(),
      remotePing: 0,
      kothTarget: mode === 'koth' ? (config.kothTargetSeconds ?? 60) : 0, // seconds of zone control to win
      hillHolder: null,
      hillInside: [],
      winnerKart: null,
    };
    this.accum = 0;

    this.audio.init();
    this.audio.startMusic('match');
    this.audio.startEngine();
    this.hud.show();
    this.hud.setMode(
      mode === 'koth' ? 'KING OF THE HILL' : 'NEON DEATHMATCH',
      mode === 'koth' ? 'HOLD THE CORE TO SCORE' : (target === 'time' ? 'MOST KILLS IN 5:00' : `FIRST TO ${target} KILLS`),
    );
    this.hud.setScore(0);
    // HUD clock starts on the full match time (3:00) and counts down.
    this.hud.setTimer(this.state.timeLeft);
    this.hud.clearStatusChips();
    this.hud.setAbility(null, 0);
    this.hud.countdown(String(COUNTDOWN_SECONDS), 'GET READY');

    // 5) keyboard focus — the first WASD / SPACE press must register instantly
    this.focusGameWindow();
  }

  /** Give the canvas/window input focus so PLAY needs no extra click. */
  focusGameWindow() {
    try {
      const canvasFocused = this.engine.focusCanvas?.() ?? false;
      if (!canvasFocused && typeof window.focus === 'function') window.focus();
    } catch (err) {
      console.warn('[Super Racers] could not focus the game canvas', err);
    }
  }

  /**
   * Kart / bot spawn sanity pass. Runs *before* the first physics step so every
   * entry has a real position, yaw and health — bots included — which keeps the
   * AI from reading uninitialised properties on frame 1.
   */
  validateEntries() {
    const spawns = this.spawnPool?.length ? this.spawnPool : KART_SPAWNS;
    this.entries.forEach((entry, i) => {
      const kart = entry.kart;
      if (!kart) return;
      const repaired = kart.ensureValid();     // fills defaults + kills NaN
      if (repaired) {
        const spawn = spawns[i % spawns.length] || { x: 0, z: 0, yaw: 0 };
        kart.position.set(spawn.x, 0, spawn.z);
        kart.velocity.set(0, 0, 0);
        kart.yaw = spawn.yaw || 0;
        console.warn(`[Super Racers] repaired uninitialised kart "${kart.name || kart.id}"`);
      }
    });
    if (!this.entries.length) console.warn('[Super Racers] match started with no karts');
  }

  addKart({
    id, name, skin, spawn, mods, isPlayer, local, isBot = false, skill = 0.6, aggression = 0.5,
  }) {
    // every kart is born with a full state: finite spawn, 100 HP (skin-scaled
    // armour), zero velocity — nothing the first physics step could trip over.
    const safeSpawn = (spawn && Number.isFinite(spawn.x) && Number.isFinite(spawn.z))
      ? { x: spawn.x, y: 0, z: spawn.z, yaw: spawn.yaw || 0 }
      : { x: 0, y: 0, z: 0, yaw: 0 };
    const kart = new KartBody({
      id: id || `kart-${this.entries.length}`,
      name: name || 'Racer',
      mods: mods || {},
      spawn: safeSpawn,
      isPlayer: !!isPlayer,
      skinId: skin?.id || 'comet',
    });
    kart.ensureValid();
    const visual = buildKartMesh(skin || getSkin(kart.skinId));
    visual.group.position.copy(kart.position);
    visual.group.rotation.y = kart.yaw;
    this.engine.scene.add(visual.group);

    // shield bubble (hidden until the ability is used)
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(2.55, 20, 14),
      new THREE.MeshBasicMaterial({
        color: skin.glow, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    bubble.position.y = 1;
    bubble.visible = false;
    visual.group.add(bubble);

    const entry = {
      kart, visual, bubble, entityId: id, ownerId: id, local, isBot,
      brain: (!isPlayer && local) ? new BotBrain(kart, { skill, aggression, id }) : null,
    };
    this.entries.push(entry);
    return entry;
  }

  createRemoteVisual(skin, entity) {
    const visual = buildKartMesh(skin);
    visual.group.position.set(0, 0.6, 0);
    this.engine.scene.add(visual.group);
    return visual;
  }

  removeRemoteVisual(visual) {
    if (!visual) return;
    this.engine.scene.remove(visual.group);
  }

  /* ══════════════════════════════════════════════════════════════
     FRAME — match update
     ══════════════════════════════════════════════════════════════ */
  updateMatch(dt) {
    const match = this.match;
    if (!match) { this.mode = 'menu'; return; }
    const karts = this.entries.map((e) => e.kart);

    /* match clock ---------------------------------------------------------
       The MatchStateManager owns STARTING (3…2…1…GO!) → PLAYING (3:00 ticking
       down) → OVER. Mirror it onto `match` so every other system keeps reading
       the same shape.                                                    */
    if (this.state) {
      this.state.update(dt);
      match.state = this.state.state;
      match.elapsed = this.state.elapsed;
      match.timeLeft = this.state.timeLeft;
      match.countdown = this.state.countdownLeft;
    }
    const racing = match.state === MATCH_STATE.PLAYING;
    const frozen = !racing;

    /* player --------------------------------------------------- */
    const axes = this.input.axes(dt);
    const playerKart = this.playerEntry?.kart;
    if (playerKart) {
      const input = frozen || !playerKart.alive
        ? { throttle: 0, steerSmooth: 0, drift: false }
        : {
          throttle: axes.throttle,
          steerSmooth: axes.steerSmooth,
          drift: axes.drift,
        };
      // SPACEBAR fires the currently held ability
      if (racing && axes.abilityPressed && playerKart.alive) this.combat.useAbility(playerKart);
      if (racing && this.input.wasPressed('reset') && playerKart.alive) this.resetStuckKart(playerKart);
      if (racing && this.input.wasPressed('horn')) this.audio.horn();

      playerKart.update(dt, input, this.world, karts);
      this.syncVisual(this.playerEntry, dt);
    }

    /* bots ----------------------------------------------------- */
    const ctx = { karts, world: this.world, combat: this.combat, crates: this.combat?.crates || [], time: performance.now() / 1000 };
    for (const entry of this.entries) {
      if (!entry.local || !entry.brain) continue;
      if (frozen) {
        entry.kart.update(dt, { throttle: 0, steerSmooth: 0, drift: false }, this.world, karts);
      } else if (!entry.brainBroken) {
        // A single misbehaving bot must never be able to kill the frame.
        try {
          entry.brain.update(dt, ctx);
        } catch (err) {
          entry.brainBroken = true;
          entry.brain.input = { throttle: 0, steerSmooth: 0, drift: false };
          console.error(`[Super Racers] bot "${entry.kart?.name}" AI halted`, err);
        }
        entry.kart.update(dt, entry.brain.input, this.world, karts);
      } else {
        entry.kart.update(dt, { throttle: 0, steerSmooth: 0, drift: false }, this.world, karts);
      }
      this.syncVisual(entry, dt);
    }

    /* combat --------------------------------------------------- */
    if (racing) {
      this.combat.update(dt, karts);
      resolveRamming(karts, this.combat);
      this.updateBoostPads(dt, karts);
      this.updateKoth(dt, karts);
    } else {
      this.combat.time += dt;
      this.animateCrates(dt);
    }

    /* remote interpolation -------------------------------------- */
    this.net.update(dt);
    for (const entry of this.entries) {
      if (entry.local) continue;
      const v = entry.visual;
      if (!v) continue;
      v.group.position.copy(entry.kart.position);
      v.group.rotation.y = entry.kart.yaw;
      v.group.visible = entry.kart.alive;
      v.wheels.forEach((w) => { w.rotation.x += dt * (3 + entry.kart.speed * 1.2); });
      v.frontWheels.forEach((w) => { w.rotation.y = 0; });
      v.flames.forEach((f) => { f.visible = false; });
      if (v.glow) v.glow.material.opacity = 0.35;
    }

    /* respawns -------------------------------------------------- */
    if (racing) {
      for (const entry of this.entries) {
        const kart = entry.kart;
        if (entry.local && !kart.alive && this.combat.time >= kart.respawnAt) {
          this.respawnKart(entry);
        }
      }
    }

    /* HUD ------------------------------------------------------ */
    this.updateHud(dt, karts);

    /* camera + render ------------------------------------------ */
    const look = this.input.consumeLook();
    const zoom = this.input.consumeZoom();

    // Match over: do NOT freeze — keep simulating and orbit the winning kart
    // while the VICTORY / DEFEAT card is on screen.
    if (this.match && this.match.state === MATCH_STATE.OVER) {
      this.engine.rig.orbitYaw += dt * 0.4;
    }

    const camKart =
      this.match?.state === MATCH_STATE.OVER && this.match.winnerKart
        ? this.match.winnerKart
        : playerKart && playerKart.alive ? playerKart
        : playerKart || { position: new THREE.Vector3(), yaw: 0, steer: 0, speed: 0, boostTimer: 0 };
    this.engine.update(dt, {
      kart: camKart,
      speedRatio: clamp((camKart.speed || 0) / (ARCADE.BASE_MAX_SPEED * 1.15), 0, 1),
      boosting: !!(camKart.boostTimer > 0),
      lookBehind: this.input.isDown('lookBehind'),
      lookDelta: look,
      zoom,
      dragging: this.input.dragging,
    });
    if (this.arena) this.arena.update(dt, this.engine.time);

    /* engine audio --------------------------------------------- */
    if (playerKart) {
      const speedRatio = clamp(Math.abs(playerKart.forwardSpeed) / ARCADE.BASE_MAX_SPEED, 0, 1);
      this.audio.updateEngine(speedRatio, Math.abs(axes.throttle), playerKart.boostTimer > 0);
      if (playerKart.drifting && this.frame % 12 === 0) this.audio.skid();
    }

    /* network -------------------------------------------------- */
    if (match.online) {
      const owned = this.entries.filter((e) => e.local).map((e) => ({ kart: e.kart, id: e.entityId }));
      this.net.maybeSendState(owned);
    }
  }

  animateCrates(dt) {
    // keep crate bobbing while frozen (countdown) without advancing combat
    for (const crate of this.combat.crates) {
      crate.spin += dt * 1.6;
      crate.mesh.rotation.y = crate.spin;
      crate.mesh.position.y = 0.98 + Math.sin(this.combat.time * 2 + crate.phase) * 0.22;
    }
  }

  syncVisual(entry, dt) {
    const { kart, visual } = entry;
    if (!visual) return;
    visual.group.position.copy(kart.position);
    visual.group.rotation.y = kart.yaw;
    visual.group.visible = kart.alive;

    const spin = (6 + Math.abs(kart.forwardSpeed) * 1.5) * dt;
    visual.wheels.forEach((w) => { w.rotation.x += spin; });
    visual.frontWheels.forEach((w) => { w.rotation.y = kart.steer * 0.45; });

    const boosting = kart.boostTimer > 0;
    visual.flames.forEach((f, i) => {
      f.visible = boosting;
      if (boosting) {
        const s = 0.7 + Math.sin(this.engine.time * 40 + i) * 0.25 + Math.random() * 0.15;
        f.scale.set(s, s * 1.2, s);
      }
    });
    if (visual.glow) {
      visual.glow.material.opacity = boosting ? 0.85 : 0.45;
      visual.glow.material.color.setHex(boosting ? 0xff7a1a : (getSkin(kart.skinId).glow));
    }
    if (entry.bubble) {
      entry.bubble.visible = kart.shield > 0;
      if (kart.shield > 0) {
        entry.bubble.material.opacity = 0.14 + Math.sin(this.engine.time * 6) * 0.06;
        entry.bubble.material.color.setHex(getSkin(kart.skinId).glow);
      }
    }
    // small impact sparks when scraping walls
    if (kart.wallGrind > 0.6 && this.frame % 3 === 0) {
      this.engine.sparks(kart.position.clone().setY(0.7), { count: 3, color: 0xffc23d, speed: 7 });
    }
    if (kart.landedHard > 0.2) {
      kart.landedHard = 0;
      this.engine.smoke(kart.position.clone().setY(0.2), { count: 5, scale: 0.7, color: 0x9a94b0 });
      if (kart.isPlayer) this.audio.land();
    }
  }

  updateBoostPads(dt, karts) {
    if (!this.arena) return;
    const now = this.combat.time;
    for (let i = 0; i < this.arena.boostPads.length; i++) {
      const pad = this.arena.boostPads[i];
      for (const kart of karts) {
        if (!kart.alive) continue;
        const dx = kart.position.x - pad.x;
        const dz = kart.position.z - pad.z;
        if (dx * dx + dz * dz > pad.radius * pad.radius) continue;
        const key = `${i}:${kart.id}`;
        if ((this.match.padCooldown.get(key) || 0) > now) continue;
        this.match.padCooldown.set(key, now + 1.4);
        kart.addBoost(1.25, 1.38);
        if (kart.isPlayer) {
          this.audio.boost();
          this.hud.banner('BOOST PAD!', '', 700);
        }
        this.engine.sparks(kart.position.clone().setY(0.4), { count: 12, color: 0xffc23d, speed: 10, up: true });
      }
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
     KING OF THE HILL — glowing rotating neon zone at the arena centre
     ════════════════════════════════════════════════════════════════════════ */

  ensureHillZone() {
    if (this.hillZone) return this.hillZone;
    const group = new THREE.Group();

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(6.5, 9.5, 64),
      new THREE.MeshBasicMaterial({
        color: 0x22e1ff, transparent: true, opacity: 0.45,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    group.add(ring);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(9, 9, 0.4, 48),
      new THREE.MeshBasicMaterial({
        color: 0x161038, transparent: true, opacity: 0.35,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    base.position.y = 0.26;
    group.add(base);

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.85, 1),
      new THREE.MeshBasicMaterial({ color: 0xff2bd6 }),
    );
    core.position.y = 1.5;
    group.add(core);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 20, 14),
      new THREE.MeshBasicMaterial({
        color: 0x22e1ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    group.add(halo);

    this.hillZone = { group, ring, base, core, halo };
    this.engine.scene.add(group);
    return this.hillZone;
  }

  updateKoth(dt, karts) {
    const match = this.match;
    if (match.mode !== 'koth') return;

    const zone = this.ensureHillZone();
    zone.group.position.set(0, 0, 0);
    zone.group.rotation.y += dt * 1.2;
    zone.core.position.y = 1.5 + Math.sin(this.engine.time * 2.5) * 0.35;
    zone.halo.material.opacity = 0.3 + Math.sin(this.engine.time * 3) * 0.15;

    const radius = 9;
    const inside = karts.filter((k) => k.alive && Math.hypot(k.position.x, k.position.z) < radius);
    match.hillInside = inside;
    const contested = inside.length >= 2;
    const holder = contested ? null : inside[0];
    match.hillHolder = holder;

    if (holder) {
      holder.kothScore = (holder.kothScore || 0) + dt;
      if (holder.isPlayer && this.frame % 30 === 0) {
        this.hud.setHint('HOLDING THE CORE — +1 point per second', true);
      }
      zone.ring.material.color.set(0x22e1ff);
      zone.base.material.color.set(0x22e1ff);
      zone.core.material.color.set(0x22e1ff);
      zone.core.material.emissive.set(0x22e1ff);
    } else {
      zone.ring.material.color.set(contested ? 0xff3b5c : 0x6b6b6b);
      zone.base.material.color.set(contested ? 0xff3b5c : 0x2a1a1a);
      zone.core.material.color.set(contested ? 0xff3b5c : 0x4a4a4a);
      zone.core.material.emissive.set(contested ? 0xff3b5c : 0x220a0a);
    }

    if (!holder) return;
    const holderEntry = this.entries.find((e) => e.kart === holder);
    if (this.match.online && holderEntry && !holderEntry.local) return; // the owner client announces the win
    if ((holder.kothScore || 0) >= match.kothTarget) this.endMatch('koth-target', holder);
  }

  resetStuckKart(kart) {
    const spawn = pickSpawnAwayFrom([], this.spawnPool || KART_SPAWNS);
    kart.position.set(spawn.x, 0, spawn.z);
    kart.velocity.set(0, 0, 0);
    this.engine.sparks(kart.position.clone().setY(1), { count: 20, color: 0x22e1ff, speed: 10, up: true });
    if (kart.isPlayer) this.hud.banner('REPOSITIONED', '', 700);
  }

  respawnKart(entry) {
    const kart = entry.kart;
    const spawn = pickSpawnAwayFrom(
      this.entries.filter((e) => e !== entry).map((e) => e.kart),
      this.spawnPool || KART_SPAWNS,
    );
    kart.respawn(spawn);
    kart.invuln = 2.6;
    this.engine.sparks(kart.position.clone().setY(1), { count: 26, color: getSkin(kart.skinId).glow, speed: 12, up: true });
    this.engine.flashLight(kart.position.clone().setY(1.5), getSkin(kart.skinId).glow, 200, 0.4);
    if (kart.isPlayer) {
      this.hud.hideDeath();
      this.hud.banner('RESPAWNED', '', 800);
      this.audio.respawn();
    }
  }

  updateHud(dt, karts) {
    const playerKart = this.playerEntry?.kart;
    if (playerKart) {
      this.hud.setHealth(playerKart.health, playerKart.maxHealth, playerKart.shield);
      const gear = playerKart.forwardSpeed < -1 ? 'R'
        : Math.abs(playerKart.forwardSpeed) < 0.6 ? 'N'
          : playerKart.boostTimer > 0 ? 'B'
            : String(Math.min(6, 1 + Math.floor(Math.abs(playerKart.forwardSpeed) / 6)));
      this.hud.setSpeed(playerKart.speedKmh, gear, playerKart.boostTimer > 0);
      this.hud.setBoost(playerKart.boostTimer > 0 ? playerKart.boostTimer / 3.4 : (playerKart.boostTimer > 0 ? 1 : null));

      const ability = playerKart.item;
      if (ability) {
        const ready = this.combat.time >= (playerKart.itemReadyAt || 0);
        this.hud.setAbility(ability, ready ? 1 : clamp((this.combat.time - (playerKart.itemReadyAt - ability.cooldown)) / ability.cooldown, 0, 0.95), ready);
      } else {
        this.hud.setAbility(null, 0);
      }
      if (!playerKart.alive) {
        this.hud.setRespawn(playerKart.respawnAt - this.combat.time);
      }
    }

    const alive = karts.filter((k) => k.alive).length;
    this.hud.setAlive(alive);

    // scoreboard rows
    const rows = this.entries.map((e) => {
      const skin = getSkin(e.kart.skinId);
      const remote = this.match.online ? this.match.scores.get(e.entityId) : null;
      return {
        isMe: e.kart.isPlayer,
        alive: e.kart.alive,
        color: skin.body,
        accent: skin.accent,
        name: e.kart.name,
        isBot: e.isBot,
        kills: remote?.kills ?? e.kart.kills,
        deaths: remote?.deaths ?? e.kart.deaths,
        streak: remote?.streak ?? e.kart.streak,
        ping: e.local ? (this.net.ping ?? (e.isBot ? 0 : '—')) : (this.net.ping ?? 20),
      };
    }).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

    const leader = rows[0];
    this.hud.setLeader(leader?.name, leader?.kills ?? 0);
    if (leader) this.hud.setScore(this.match.mode === 'koth' ? Math.floor(playerKart?.kothScore || 0) : (rows.find((r) => r.isMe)?.kills ?? 0));
    // Top-centre box (NEON DEATHMATCH): the match clock, counting down from
    // 3:00. HUD.setTimer() caches the string, so the DOM is only touched when
    // the second actually changes (3:00 → 2:59).
    this.hud.setTimer(this.state ? this.state.timeLeft : this.match.timeLeft);
    if (this.match.mode === 'koth') {
      this.hud.setHint(`CORE POINTS ${Math.floor(playerKart?.kothScore || 0)} / ${this.match.kothTarget || 60}`, (this.match.hillHolder === playerKart));
    }

    this.hud.setScoreboard(rows, this.input.isDown('scoreboard'));
    this.hud.update(dt);

    // local win condition
    if (this.match.state === MATCH_STATE.PLAYING && !this.match.online && this.match.mode === 'deathmatch' && typeof this.match.target === 'number') {
      const winner = this.entries.find((e) => e.kart.kills >= this.match.target);
      if (winner) this.endMatch('target-reached', winner.kart);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     EVENT HANDLERS
     ══════════════════════════════════════════════════════════════ */
  onPlayerHurt(amount, source) {
    this.hud.flashDamage();
    if (source && source.position) {
      const camDir = new THREE.Vector3();
      this.engine.camera.getWorldDirection(camDir);
      const dx = source.position.x - (this.playerEntry?.kart.position.x || 0);
      const dz = source.position.z - (this.playerEntry?.kart.position.z || 0);
      const dot = camDir.x * dx + camDir.z * dz;
      const cross = camDir.z * dx - camDir.x * dz;
      const angle = -Math.atan2(cross, dot);
      this.hud.damageDirection(angle);
    }
  }

  onDamage(target, amount, source, opts) {
    if (target.isPlayer && target.alive) {
      this.hud.setHint(`${Math.round(amount)} DAMAGE TAKEN`, true);
    }
    // network: report HP changes we applied to local entities? not needed (state carries hp)
  }

  onCratePickup(crate, kart, ability) {
    if (kart.isPlayer) {
      this.hud.banner(`${ability.icon} ${ability.name}`, 'gold', 1250);
      this.hud.setHint('SPACE to fire');
      this.hud.flashScreen('rgba(34,225,255,.25)', 120);
    } else if (kart.isRemote) {
      // handled by the owner
    }
    if (this.match?.online && this.entries.find((e) => e.kart === kart)?.local) {
      this.net.sendCrate(crate.id, ability.id, kart.id);
    }
  }

  onAbilityUsed(kart, ability) {
    if (kart.isPlayer) this.hud.setHint(`${ability.icon} ${ability.name} FIRED`, true);
    if (this.match?.online && this.entries.find((e) => e.kart === kart)?.local) {
      this.net.sendAbility(kart.id, ability.id);
    }
  }

  onStatus(kart, status) {
    if (kart.isPlayer) this.hud.setStatusChip(kart.id, status);
  }

  onKill(killer, victim, weapon, selfDestruct) {
    const icon = WEAPON_ICONS[weapon] || '💥';
    const victimEntry = this.entries.find((e) => e.kart === victim);
    const isLocalVictim = victimEntry?.local;

    // local victims are authoritative here — remote ones are confirmed by the server
    if (isLocalVictim && this.match?.online) {
      this.net.sendDeath(victimEntry.entityId, killer ? (this.entries.find((e) => e.kart === killer)?.entityId || null) : null, weapon);
    }

    this.registerScore({ killer, victim, weapon, icon, selfDestruct });

    if (victim.isPlayer) {
      this.hud.showDeath(killer && !selfDestruct ? killer.name : null);
      this.hud.setRespawn(3);
      this.hud.setAbility(null, 0);
      this.hud.flashScreen('rgba(255,30,60,.45)', 200);
      this.audio.defeat();
      this.hud.banner('YOU WERE DESTROYED', 'danger', 1400);
    }
    if (killer?.isPlayer && !selfDestruct) {
      const streak = killer.streak;
      if (streak >= 2) {
        const names = { 2: 'DOUBLE KILL', 3: 'RAMPAGE', 4: 'DOMINATING', 5: 'UNSTOPPABLE', 6: 'GODLIKE' };
        const label = names[Math.min(streak, 6)] || 'GODLIKE';
        if (streak <= 6) this.hud.banner(`${label}!`, 'gold', 1300);
        this.audio.killStreak(streak);
      }
    }
    if (selfDestruct && victim.isPlayer) this.hud.banner('SELF DESTRUCT', 'danger', 1100);
  }

  registerScore({ killer, victim, weapon, icon, selfDestruct }) {
    const mine = killer?.isPlayer ? 'kill' : victim?.isPlayer ? 'death' : 'none';
    this.hud.pushKill({
      killer: selfDestruct ? null : killer?.name,
      victim: victim.name + (selfDestruct ? ' (self)' : ''),
      icon,
      streak: killer?.streak,
      mine,
    });

    if (this.match?.online) {
      const kEntry = killer ? this.entries.find((e) => e.kart === killer) : null;
      const vEntry = this.entries.find((e) => e.kart === victim);
      if (kEntry) {
        const s = this.match.scores.get(kEntry.entityId) || { kills: 0, deaths: 0, streak: 0 };
        s.kills += 1; s.streak += 1;
        this.match.scores.set(kEntry.entityId, s);
      }
      if (vEntry) {
        const s = this.match.scores.get(vEntry.entityId) || { kills: 0, deaths: 0, streak: 0 };
        s.deaths += 1; s.streak = 0;
        this.match.scores.set(vEntry.entityId, s);
      }
    }

    if (this.match?.online && this.match.mode === 'deathmatch' && typeof this.match.target === 'number') {
      const top = this.entries
        .map((e) => ({ e, k: e.kart.kills }))
        .sort((a, b) => b.k - a.k)[0];
      if (top && top.k >= this.match.target && top.e.local) this.endMatch('target-reached', top.e.kart);
    }
  }

  /* ── network inbound ──────────────────────────────────────── */
  forwardDamage(target, amount, source, opts) {
    if (!this.match?.online || !target.isRemote) return false;
    this.net.sendHit(target.id, amount, opts.source || 'rocket');
    // mirror sparks for everyone else
    this.engine.sparks(target.position.clone().setY(1.1), { count: 8, color: 0xffc23d, speed: 8 });
    return true;
  }

  onNetworkHit({ from, target, dmg, kind }) {
    const entry = this.entries.find((e) => e.entityId === target && e.local);
    if (!entry) return;
    const source = from ? (this.entries.find((e) => e.entityId === from)?.kart || null) : null;
    this.combat.applyDamage(entry.kart, dmg, source, { source: kind, dir: { x: Math.random() - 0.5, z: Math.random() - 0.5 } });
  }

  onNetworkCrate({ crateId, abilityId, playerId }) {
    const kart = this.entries.find((e) => e.entityId === playerId)?.kart
      || this.net.remotes.get(playerId)?.kart;
    this.combat.markCrateTaken(crateId, kart, abilityId);
  }

  onNetworkKill(payload) {
    const victimEntry = this.entries.find((e) => e.entityId === payload.victim?.id);
    const isLocal = !!victimEntry?.local;

    if (payload.scores?.length) {
      payload.scores.forEach((s) => this.match?.scores.set(s.id, { kills: s.kills, deaths: s.deaths, streak: s.streak }));
    }

    if (victimEntry && !victimEntry.local) {
      // this entity is simulated by another client — mirror the explosion locally
      victimEntry.kart.alive = false;
      victimEntry.kart.health = 0;
      this.engine.kartExplosion(victimEntry.kart);
      this.audio.explosion();
    }

    if (!isLocal) {
      const killerEntry = payload.killer ? this.entries.find((e) => e.entityId === payload.killer.id) : null;
      this.hud.pushKill({
        killer: payload.killer?.name || null,
        victim: payload.victim?.name || 'Racer',
        icon: WEAPON_ICONS[payload.weapon] || '💥',
        mine: killerEntry?.kart?.isPlayer ? 'kill' : victimEntry?.kart?.isPlayer ? 'death' : 'none',
      });
      if (killerEntry?.kart?.isPlayer) {
        this.hud.banner(`${WEAPON_ICONS[payload.weapon] || '💥'} ELIMINATED`, 'gold', 1200);
        this.audio.killStreak(2);
      }
    }
  }

  onNetworkMatchEnd(payload) {
    if (!this.match || this.match.state === MATCH_STATE.OVER) return;
    const iWon = payload.winner?.id === this.myId || payload.winner?.id === this.playerEntry?.entityId;
    this.endMatch('server', null, { forcedStandings: payload.standings, iWon: !!iWon });
  }

  /* ══════════════════════════════════════════════════════════════
     MATCH END
     ══════════════════════════════════════════════════════════════ */
  endMatch(reason, winnerKart = null, { forcedStandings = null, iWon = false } = {}) {
    const match = this.match;
    if (!match || match.state === MATCH_STATE.OVER) return;
    match.state = MATCH_STATE.OVER;
    match.winnerKart = winnerKart || null;
    this.state?.finish(reason);
    this.hud.countdown(null);
    this.hud.setScoreboard([], false);

    const koth = match.mode === 'koth';
    const rows = forcedStandings
      ? forcedStandings.map((s) => {
        const entry = this.entries.find((e) => e.entityId === s.id);
        const skin = getSkin(entry?.kart.skinId || 'comet');
        return {
          id: s.id, name: s.name || entry?.kart.name || 'Racer',
          kills: s.kills, deaths: s.deaths,
          score: koth ? Math.floor((entry?.kart?.kothScore ?? s.kills ?? 0)) : s.kills,
          streak: s.streak, isBot: !!entry?.isBot, isMe: entry?.kart.isPlayer,
          color: skin.body, accent: skin.accent,
        };
      })
      : this.entries.map((e) => {
        const skin = getSkin(e.kart.skinId);
        return {
          id: e.entityId, name: e.kart.name, kills: e.kart.kills, deaths: e.kart.deaths,
          score: koth ? Math.floor(e.kart.kothScore || 0) : e.kart.kills,
          streak: e.kart.streak, isBot: e.isBot, isMe: e.kart.isPlayer,
          color: skin.body, accent: skin.accent,
        };
      }).sort((a, b) => b.score - a.score || a.deaths - b.deaths);

    const myRow = rows.find((r) => r.isMe) || rows[0] || { kills: 0, deaths: 0 };
    const placement = Math.max(1, rows.findIndex((r) => r.isMe) + 1);
    const won = iWon || winnerKart?.isPlayer === true || (rows.length > 1 && placement === 1);

    const { xp, levelUp } = this.profile.recordMatch({
      kills: myRow.kills, deaths: myRow.deaths, placement, players: rows.length, won,
    });

    this.audio.stopEngine();
    if (won) this.audio.victory();
    else this.audio.defeat();

    this.hud.fade(true, won ? 'VICTORY' : 'MATCH OVER');
    setTimeout(() => this.hud.fade(false), 700);
    this.hud.hideDeath();

    rows.forEach((r, i) => { r.xp = i === placement - 1 ? xp : 0; });

    setTimeout(() => {
      this.menu.showResults({
        standings: rows,
        xp,
        won,
        modeName: match.mode === 'koth' ? 'KING OF THE HILL' : 'NEON DEATHMATCH',
        reward: `+${xp} XP · ${myRow.kills} eliminations${levelUp ? ` · LEVEL ${levelUp}!` : ''}`,
      });
      if (levelUp) {
        this.audio.levelUp();
        this.menu.toast(`LEVEL UP — you reached level ${levelUp}!`, 'success', '⭐');
      }
      this.hud.hide();
      this.mode = 'results';
      this.audio.startMusic('menu');
    }, 900);
  }

  /* ══════════════════════════════════════════════════════════════
     PAUSE / NAVIGATION
     ══════════════════════════════════════════════════════════════ */
  bindExtraUI() {
    const resume = document.getElementById('btn-resume');
    const quit = document.getElementById('btn-quit');
    resume?.addEventListener('click', () => { this.audio.uiClick(); this.setPaused(false); });
    quit?.addEventListener('click', () => { this.audio.uiClick(); this.setPaused(false); this.quitToMenu(); });
    document.getElementById('btn-pause-settings')?.addEventListener('click', () => this.menu.openModal('modal-settings'));
    document.getElementById('btn-pause-controls')?.addEventListener('click', () => this.menu.openModal('modal-controls'));

  }

  togglePause() {
    if (this.mode !== 'match' && this.mode !== 'results') return;
    if (!this.match || this.match.state === MATCH_STATE.OVER) return;
    this.setPaused(!this.paused);
  }

  setPaused(paused) {
    this.paused = paused;
    const root = document.getElementById('pause-root');
    root?.classList.toggle('hidden', !paused);
    if (paused) {
      this.audio.stopEngine();
      const k = this.playerEntry?.kart;
      const el = document.getElementById('pause-score');
      if (el && k) el.textContent = `Kills ${k.kills} · Deaths ${k.deaths} · Streak ${k.streak}`;
    } else {
      this.audio.startEngine();
      this.clock.getDelta();
    }
  }

  rematch() {
    const conf = this.match?.config || { mode: 'deathmatch', bots: 5, target: 15, arena: 'neon' };
    this.menu.hide();
    if (this.match?.online && this.net.connected) {
      // rebuild the same room match locally-hosted if we're the host
      if (this.net.isHost) {
        this.startOnlineMatch(conf);
        return;
      }
      this.startLocalMatch(conf);
      this.menu.toast('Left the room — running a local rematch', 'warn', '🤖');
      return;
    }
    this.startLocalMatch(conf);
  }

  quitToMenu() {
    this.audio.stopEngine();
    this.audio.startMusic('menu');
    if (this.match?.online) this.net.leaveRoom();
    this.combat?.dispose();
    this.combat = null;
    this.entries = [];
    this.playerEntry = null;
    this.match = null;
    this.state = null;
    this.paused = false;
    document.getElementById('pause-root')?.classList.add('hidden');
    this.hud.hide();
    this.hud.fade(false);
    this.engine.returnToMenu();
    this.engine.updateMenuSkin(this.profile.skin);
    this.menu.showMenu();
    this.mode = 'menu';
  }

  onSettingChanged(key, value) {
    if (key === 'bloom') this.engine.setupComposer();
  }
}

function reportBootFailure(err) {
  console.error('Failed to boot Super Racers:', err);
  if (typeof window.__SR_BOOT_FAIL__ === 'function') {
    window.__SR_BOOT_FAIL__(err);
  }
}

try {
  const game = new Game();
  window.__SUPER_RACERS__ = game;
  window.__SR_BOOT_STARTED__ = true;
  // start() is async; without a catch, its rejection would be silently
  // swallowed (the watchdog ignores rejections once __SR_BOOT_STARTED__ is set).
  game.start().catch(reportBootFailure);
} catch (err) {
  reportBootFailure(err);
}
