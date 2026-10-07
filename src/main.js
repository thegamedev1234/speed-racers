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

const WEAPON_ICONS = {
  missile: '🚀', triple: '🎇', mine: '💣', gun: '🔫', shockwave: '💥',
  boost: '🔥', shield: '🛡️', repair: '🔧', rocket: '🚀', ram: '💢', crash: '💀', self: '💀',
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class Game {
  constructor() {
    this.profile = new ProfileManager();
    this.audio = new SoundSystem(this.profile);
    this.input = new InputManager();
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
    this.mode = 'menu';
    this.paused = false;
    this.clock = new THREE.Clock();
    this.accum = 0;
    this.frame = 0;
    this.startedAt = 0;

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
      if (document.hidden && this.match && this.match.state === 'playing') this.setPaused(true);
    });

    this.clock.getDelta();
    this.loop();
  }

  loop = () => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.frame++;

    try {
      if (this.paused) {
        if (this.mode === 'menu') {
          this.engine.update(dt, this.showroomCamTarget());
        } else {
          this.engine.update(dt, this.idleCamTarget());
        }
        this.engine.render();
      } else if (this.mode === 'menu') {
        this.engine.update(dt, this.showroomCamTarget());
        this.engine.render();
      } else {
        this.updateMatch(dt);
      }
    } catch (err) {
      console.error('[Super Racers] frame error', err);
    }

    this.input.endFrame();
  };

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

    // 4) match state
    this.match = {
      config, mode, target, online, state: 'countdown',
      countdown: 3.4,
      elapsed: 0,
      timeLeft: target === 'time' ? 300 : Infinity,
      scores: new Map(entities.map((e) => [e.id, { kills: 0, deaths: 0, streak: 0 }])),
      lastCountText: null,
      padCooldown: new Map(),
      remotePing: 0,
    };

    this.audio.init();
    this.audio.startMusic('match');
    this.audio.startEngine();
    this.hud.show();
    this.hud.setMode(
      mode === 'koth' ? 'KING OF THE HILL' : 'NEON DEATHMATCH',
      mode === 'koth' ? 'HOLD THE CORE TO SCORE' : (target === 'time' ? 'MOST KILLS IN 5:00' : `FIRST TO ${target} KILLS`),
    );
    this.hud.setScore(0);
    this.hud.setTimer(target === 'time' ? 300 : 0);
    this.hud.clearStatusChips();
    this.hud.setAbility(null, 0);
    this.hud.countdown('3', 'GET READY');
  }

  addKart({ id, name, skin, spawn, mods, isPlayer, local, isBot = false, skill = 0.6, aggression = 0.5 }) {
    const kart = new KartBody({ id, name, mods, spawn, isPlayer, skinId: skin.id });
    const visual = buildKartMesh(skin);
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

    /* countdown ------------------------------------------------- */
    if (match.state === 'countdown') {
      match.countdown -= dt;
      const n = Math.ceil(match.countdown - 0.4);
      const text = n > 0 ? String(n) : 'GO!';
      if (text !== match.lastCountText) {
        match.lastCountText = text;
        this.hud.countdown(text, n > 0 ? 'GET READY' : 'DEATHMATCH');
        if (n > 0) this.audio.countdownBeep(false);
        else {
          this.audio.countdownBeep(true);
          this.hud.banner('FIGHT!', 'gold', 900);
        }
      }
      if (match.countdown <= 0.35) {
        match.state = 'playing';
        this.hud.countdown(null);
      }
    }
    const racing = match.state === 'playing';
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
    const ctx = { karts, world: this.world, combat: this.combat, crates: this.combat.crates, time: performance.now() / 1000 };
    for (const entry of this.entries) {
      if (!entry.local || !entry.brain) continue;
      if (frozen) {
        entry.kart.update(dt, { throttle: 0, steerSmooth: 0, drift: false }, this.world, karts);
      } else {
        entry.brain.update(dt, ctx);
        entry.kart.update(dt, entry.brain.input, this.world, karts);
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

    /* match clock ---------------------------------------------- */
    if (racing) {
      match.elapsed += dt;
      if (match.timeLeft !== Infinity) {
        match.timeLeft -= dt;
        if (match.timeLeft <= 0) this.endMatch('time-up');
      }
    }

    /* HUD ------------------------------------------------------ */
    this.updateHud(dt, karts);

    /* camera + render ------------------------------------------ */
    const look = this.input.consumeLook();
    const zoom = this.input.consumeZoom();
    this.engine.update(dt, playerKart && playerKart.alive ? {
      kart: playerKart,
      speedRatio: clamp(playerKart.speed / (ARCADE.BASE_MAX_SPEED * 1.15), 0, 1),
      boosting: playerKart.boostTimer > 0,
      lookBehind: this.input.isDown('lookBehind'),
      lookDelta: look,
      zoom,
      dragging: this.input.dragging,
    } : {
      kart: playerKart || { position: new THREE.Vector3(), yaw: 0, steer: 0 },
      speedRatio: 0, boosting: false, lookBehind: false,
      lookDelta: look, zoom, dragging: this.input.dragging,
    });
    if (this.arena) this.arena.update(dt, this.engine.time);
    this.engine.render();

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

  updateKoth(dt, karts) {
    const match = this.match;
    if (match.mode !== 'koth') return;
    const radius = 9;
    let holder = null;
    let holderDist = Infinity;
    for (const kart of karts) {
      if (!kart.alive) continue;
      const d = Math.hypot(kart.position.x, kart.position.z);
      if (d < radius && d < holderDist) { holderDist = d; holder = kart; }
    }
    match.hillHolder = holder;
    if (holder) {
      holder.kothScore = (holder.kothScore || 0) + dt;
      if (holder.isPlayer && this.frame % 30 === 0) {
        this.hud.setHint('HOLDING THE CORE — keep it!', true);
      }
    }
    const target = match.target === 'time' ? 60 : (Number(match.target) || 45);
    match.kothTarget = target;
    if (!holder) return;
    const holderEntry = this.entries.find((e) => e.kart === holder);
    if (this.match.online && holderEntry && !holderEntry.local) return; // their client announces
    if ((holder.kothScore || 0) >= target) this.endMatch('koth-target', holder);
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
    if (this.match.mode === 'koth') {
      this.hud.setTimer(this.match.elapsed);
      this.hud.setHint(`CORE POINTS ${Math.floor(playerKart?.kothScore || 0)} / ${this.match.kothTarget || 45}`, (this.match.kothHolder === playerKart));
    } else {
      this.hud.setTimer(this.match.timeLeft === Infinity ? this.match.elapsed : this.match.timeLeft);
    }

    this.hud.setScoreboard(rows, this.input.isDown('scoreboard'));
    this.hud.update(dt);

    // local win condition
    if (this.match.state === 'playing' && !this.match.online && this.match.mode === 'deathmatch' && typeof this.match.target === 'number') {
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
    if (!this.match || this.match.state === 'over') return;
    const iWon = payload.winner?.id === this.myId || payload.winner?.id === this.playerEntry?.entityId;
    this.endMatch('server', null, { forcedStandings: payload.standings, iWon: !!iWon });
  }

  /* ══════════════════════════════════════════════════════════════
     MATCH END
     ══════════════════════════════════════════════════════════════ */
  endMatch(reason, winnerKart = null, { forcedStandings = null, iWon = false } = {}) {
    const match = this.match;
    if (!match || match.state === 'over') return;
    match.state = 'over';
    this.hud.countdown(null);
    this.hud.setScoreboard([], false);

    const rows = forcedStandings
      ? forcedStandings.map((s) => {
        const entry = this.entries.find((e) => e.entityId === s.id);
        const skin = getSkin(entry?.kart.skinId || 'comet');
        return {
          id: s.id, name: s.name || entry?.kart.name || 'Racer',
          kills: s.kills, deaths: s.deaths,
          isBot: !!entry?.isBot, isMe: entry?.kart.isPlayer,
          color: skin.body, accent: skin.accent,
        };
      })
      : this.entries.map((e) => {
        const skin = getSkin(e.kart.skinId);
        return {
          id: e.entityId, name: e.kart.name, kills: e.kart.kills, deaths: e.kart.deaths,
          streak: e.kart.streak, isBot: e.isBot, isMe: e.kart.isPlayer,
          color: skin.body, accent: skin.accent,
        };
      }).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

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
    if (!this.match || this.match.state === 'over') return;
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

const game = new Game();
window.__SUPER_RACERS__ = game;
game.start();
