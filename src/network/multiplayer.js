/**
 * Super Racers — Multiplayer.
 *
 * Talks to the bundled Socket.IO relay (server/server.js). Responsibilities:
 *   • connection lifecycle, room create / join, lobby sync
 *   • 20 Hz position + state broadcasting for every entity the client owns
 *     (the player and, for the host, the bots it simulates)
 *   • hit / crate / death event routing
 *   • rendering & interpolating remote karts
 *
 * The game works completely offline: if no Socket.IO server answers, the menus
 * report "server offline" and everything keeps running with local bots.
 */

import { io } from 'socket.io-client';
import * as THREE from 'three';
import { getSkin, skinModifiers } from '../ui/profile.js';

const SEND_HZ = 20;
const INTERP = 12;

export class NetworkManager {
  constructor({ profile, callbacks = {} }) {
    this.profile = profile;
    this.cb = callbacks;              // { createVisual, removeVisual, onStatus, onRoom, onStart, onHit, onCrate, onKill, onMatchEnd, onPlayerLeft, onSnapshot }
    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.roomCode = null;
    this.isHost = false;
    this.players = [];
    this.config = null;
    this.entities = new Map();        // id → { id, ownerId, name, skin, isBot }
    this.remotes = new Map();         // id → { kart, visual, target, lastSeen }
    this.lastSend = 0;
    this.lastPingAt = 0;
    this.ping = null;
    this.serverUrl = '';
    this.forcedOffline = false;
  }

  /* ══════════════ CONNECTION ══════════════ */
  resolveUrl() {
    const configured = this.profile.settings.serverUrl;
    if (configured) return configured;
    return window.location.origin;
  }

  connect({ timeout = 4000 } = {}) {
    if (this.connected) return Promise.resolve({ ok: true, url: this.serverUrl });
    if (this.connecting) return this.connectPromise || Promise.resolve({ ok: false, url: '' });
    if (this.forcedOffline) {
      return Promise.resolve({ ok: false, url: '', reason: 'offline' });
    }

    const url = this.resolveUrl();
    this.serverUrl = url;
    this.connecting = true;

    this.connectPromise = new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        this.connecting = false;
        resolve(result);
      };

      try {
        this.socket = io(url, {
          transports: ['websocket', 'polling'],
          reconnectionAttempts: 4,
          reconnectionDelay: 800,
          timeout,
          forceNew: true,
        });
      } catch (err) {
        finish({ ok: false, url, reason: 'constructor-failed' });
        return;
      }

      const timer = setTimeout(() => {
        if (!this.connected) {
          this.forcedOffline = true;
          this.cb.onStatus?.('warn', 'OFFLINE · bot matches ready');
          try { this.socket?.close(); } catch { /* noop */ }
          finish({ ok: false, url, reason: 'timeout' });
        }
      }, timeout + 1200);

      this.socket.on('connect', () => {
        clearTimeout(timer);
        this.connected = true;
        this.cb.onStatus?.('ok', 'ONLINE · multiplayer ready');
        // keepalive / latency probe
        this.pingTimer = setInterval(() => {
          if (!this.socket?.connected) return;
          this.lastPingAt = performance.now();
          this.socket.emit('net:ping', this.lastPingAt);
        }, 3000);
        finish({ ok: true, url });
      });

      this.socket.on('net:pong', (t) => {
        if (typeof t === 'number') this.ping = Math.round(performance.now() - t);
      });

      this.socket.on('connect_error', () => {
        clearTimeout(timer);
        this.forcedOffline = true;
        this.cb.onStatus?.('err', 'NO SERVER · playing offline');
        finish({ ok: false, url, reason: 'connect_error' });
      });

      this.socket.on('disconnect', () => {
        this.connected = false;
        this.cb.onStatus?.('warn', 'DISCONNECTED · bot matches ready');
      });

      /* ── server → client events ── */
      this.socket.on('room:update', (payload) => {
        this.players = payload.players || [];
        this.roomCode = payload.code;
        this.isHost = payload.hostId === this.socket.id;
        this.config = payload.config;
        this.cb.onRoom?.({ ...payload, isHost: this.isHost });
      });

      this.socket.on('match:start', (payload) => {
        this.entities.clear();
        this.clearRemotes();
        (payload.entities || []).forEach((e) => this.entities.set(e.id, e));
        this.config = payload.config;
        this.cb.onStart?.(payload);
      });

      this.socket.on('net:snapshot', (payload) => {
        this.cb.onSnapshot?.(payload);
        this.applySnapshot(payload.entities || []);
      });

      this.socket.on('net:hit', (payload) => this.cb.onHit?.(payload));
      this.socket.on('net:crate', (payload) => this.cb.onCrate?.(payload));
      this.socket.on('net:kill', (payload) => this.cb.onKill?.(payload));
      this.socket.on('net:death', (payload) => this.cb.onDeathLocal?.(payload));
      this.socket.on('match:end', (payload) => this.cb.onMatchEnd?.(payload));
      this.socket.on('player:left', (payload) => {
        this.removeRemote(payload.entityIds || [payload.id]);
        this.cb.onPlayerLeft?.(payload);
      });
      this.socket.on('server:error', (payload) => {
        this.cb.onError?.(payload?.message || 'Server error');
      });
    });

    return this.connectPromise;
  }

  disconnect() {
    clearInterval(this.pingTimer);
    try { this.socket?.emit('room:leave'); this.socket?.disconnect(); } catch { /* noop */ }
    this.socket = null;
    this.connected = false;
    this.roomCode = null;
    this.isHost = false;
    this.players = [];
    this.clearRemotes();
  }

  /* ══════════════ ROOMS ══════════════ */
  playerPayload() {
    const skin = this.profile.skin;
    return { name: this.profile.name, skin: skin.id };
  }

  createRoom(config) {
    return this.connect().then((res) => {
      if (!res.ok || !this.socket) return res;
      this.socket.emit('room:create', { player: this.playerPayload(), config });
      return res;
    });
  }

  joinRoom(code) {
    return this.connect().then((res) => {
      if (!res.ok || !this.socket) return res;
      this.socket.emit('room:join', { code, player: this.playerPayload() });
      return res;
    });
  }

  updateLobbyConfig(config) {
    this.socket?.emit('room:config', config);
  }

  /** Host: announce which entities this client will simulate. */
  startMatch(config, entities) {
    if (!this.socket?.connected) return;
    this.socket.emit('match:start', { config, entities });
  }

  leaveRoom() {
    try { this.socket?.emit('room:leave'); } catch { /* noop */ }
    this.roomCode = null;
    this.clearRemotes();
  }

  /* ══════════════ STATE BROADCAST ══════════════ */
  /**
   * @param {Array} entities [{ kart, id }] entities owned by this client
   */
  maybeSendState(entities, force = false) {
    if (!this.socket?.connected) return;
    const now = performance.now();
    if (!force && now - this.lastSend < 1000 / SEND_HZ) return;
    this.lastSend = now;

    const payload = {
      t: Math.round(now),
      entities: entities.map(({ kart, id }) => ({
        id,
        x: +kart.position.x.toFixed(2),
        y: +kart.position.y.toFixed(2),
        z: +kart.position.z.toFixed(2),
        ry: +kart.yaw.toFixed(3),
        sp: +kart.forwardSpeed.toFixed(1),
        hp: Math.round(kart.health),
        k: kart.kills,
        d: kart.deaths,
        st: kart.streak,
        al: kart.alive ? 1 : 0,
      })),
    };
    this.socket.emit('net:state', payload);
  }

  sendHit(targetId, dmg, kind = 'rocket') {
    if (!this.socket?.connected) return;
    this.socket.emit('net:hit', { target: targetId, dmg: Math.round(dmg), kind });
  }

  sendCrate(crateId, abilityId, playerId) {
    if (!this.socket?.connected) return;
    this.socket.emit('net:crate', { crateId, abilityId, playerId });
  }

  sendDeath(victimId, killerId, weapon) {
    if (!this.socket?.connected) return;
    this.socket.emit('net:death', { victim: victimId, killer: killerId, weapon });
  }

  sendAbility(entityId, abilityId) {
    this.socket?.emit('net:ability', { id: entityId, ability: abilityId });
  }

  /* ══════════════ REMOTE RENDERING ══════════════ */
  ensureRemote(entity) {
    if (this.remotes.has(entity.id)) return this.remotes.get(entity.id);
    const skin = getSkin(entity.skin);
    const visual = this.cb.createVisual?.(skin, entity);
    if (!visual) return null;
    const kart = {
      id: entity.id,
      name: entity.name,
      skinId: skin.id,
      isPlayer: false,
      isRemote: true,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      yaw: 0, steer: 0, forwardSpeed: 0, speed: 0,
      health: skinModifiers(skin).maxHealth, maxHealth: skinModifiers(skin).maxHealth,
      shield: 0, alive: true, kills: 0, deaths: 0, streak: 0,
      boostTimer: 0, gunUntil: 0, invuln: 0,
      item: null,
      forwardVector: null,
    };
    kart.forwardVector = () => new THREE.Vector3(-Math.sin(kart.yaw), 0, -Math.cos(kart.yaw));
    kart.addBoost = () => {};
    kart.popVertical = () => {};

    const remote = {
      kart, visual,
      target: new THREE.Vector3(),
      targetYaw: 0,
      lastSeen: performance.now(),
      extrapolate: new THREE.Vector3(),
      hasSnapshot: false,
    };
    this.remotes.set(entity.id, remote);
    return remote;
  }

  removeRemote(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    list.forEach((id) => {
      const r = this.remotes.get(id);
      if (!r) return;
      this.cb.removeVisual?.(r.visual);
      this.remotes.delete(id);
    });
  }

  clearRemotes() {
    this.remotes.forEach((r) => this.cb.removeVisual?.(r.visual));
    this.remotes.clear();
  }

  applySnapshot(entities) {
    const now = performance.now();
    for (const e of entities) {
      let remote = this.remotes.get(e.id);
      if (!remote) {
        const entity = this.entities.get(e.id) || { id: e.id, name: 'Racer', skin: 'comet' };
        this.entities.set(e.id, entity);
        remote = this.ensureRemote(entity);
        if (!remote) continue;
      }
      const r = remote;
      if (!r.hasSnapshot) {
        r.kart.position.set(e.x, e.y || 0, e.z);
        r.hasSnapshot = true;
      }
      r.prevPos = r.prevPos || r.kart.position.clone();
      r.prevPos.copy(r.kart.position);
      r.target.set(e.x, e.y || 0, e.z);
      r.targetYaw = e.ry;
      r.lastSeen = now;
      r.kart.health = e.hp ?? r.kart.health;
      r.kart.kills = e.k ?? 0;
      r.kart.deaths = e.d ?? 0;
      r.kart.streak = e.st ?? 0;
      r.kart.alive = e.al !== 0;
      r.kart.forwardSpeed = e.sp ?? 0;
      r.kart.speed = Math.abs(e.sp ?? 0);
      r.kart.maxHealth = r.kart.maxHealth || 100;
    }
  }

  /** Interpolate remote karts; call every frame. */
  update(dt) {
    if (!this.remotes.size) return;
    const now = performance.now();
    const k = 1 - Math.exp(-INTERP * dt);

    this.remotes.forEach((r) => {
      const kart = r.kart;
      const stale = now - r.lastSeen > 400;

      if (stale) {
        // extrapolate along the last known heading
        const fwd = kart.forwardVector();
        kart.position.addScaledVector(fwd, kart.forwardSpeed * dt * 0.7);
      } else {
        const prev = kart.position.clone();
        kart.position.lerp(r.target, k);
        const speed = prev.distanceTo(kart.position) / Math.max(dt, 0.0001);
        kart.speed = speed;
        kart.forwardSpeed = speed;
      }

      let dy = r.targetYaw - kart.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      kart.yaw += dy * Math.min(1, 10 * dt);

      // visual sync
      const v = r.visual;
      if (v) {
        v.group.position.copy(kart.position);
        v.group.rotation.y = kart.yaw;
        v.group.visible = kart.alive;
        const spinning = Math.min(1, kart.speed / 12);
        v.wheels.forEach((w, i) => { w.rotation.x += dt * (6 + kart.speed * 1.4) * (i < 2 ? 1 : 1); });
        v.frontWheels.forEach((w) => { w.rotation.y = kart.steer * 0.4; });
        const boosting = stale ? false : false;
        v.flames.forEach((f) => { f.visible = boosting; });
        if (v.glow) v.glow.material.opacity = 0.25 + spinning * 0.3;
      }
    });
  }

  get remoteCount() { return this.remotes.size; }
}

export { SEND_HZ };
