/**
 * Super Racers — Combat system.
 *
 * Owns: item crates, the ability roster, projectiles, mines, hitscan weapons,
 * splash damage, damage numbers, kill attribution and the SPACE-bar trigger.
 *
 * The system is deliberately renderer-agnostic: all visual work goes through the
 * `fx` interface that engine.js implements (explosions, sparks, tracers, rings).
 */

import * as THREE from 'three';
import { KART_RADIUS } from './physics.js';

/* ═══════════════════════════════════════════════════════════════════════════
   ABILITY ROSTER
   ═══════════════════════════════════════════════════════════════════════════ */
export const ABILITIES = {
  missile: {
    id: 'missile', name: 'HOMING MISSILE', icon: '🚀', color: 0xff7a1a,
    cooldown: 0.6, desc: 'Locks the nearest racer and chases them down.',
  },
  triple: {
    id: 'triple', name: 'TRIPLE ROCKET', icon: '🎇', color: 0xff2bd6,
    cooldown: 0.6, desc: 'Three straight rockets. Great in corridors.',
  },
  mine: {
    id: 'mine', name: 'PROXIMITY MINE', icon: '💣', color: 0xffc23d,
    cooldown: 0.5, desc: 'Drops a mine that detonates on contact.',
  },
  gun: {
    id: 'gun', name: 'MACHINE GUN', icon: '🔫', color: 0xb4ff39,
    cooldown: 0.4, desc: '2.6 seconds of rapid-fire suppression.',
  },
  shockwave: {
    id: 'shockwave', name: 'SHOCKWAVE', icon: '💥', color: 0x22e1ff,
    cooldown: 0.8, desc: 'Blasts everyone around you away.',
  },
  boost: {
    id: 'boost', name: 'NITRO BOOST', icon: '🔥', color: 0xff3b5c,
    cooldown: 0.2, desc: 'Instant thrust. Ramming damage while active.',
  },
  shield: {
    id: 'shield', name: 'ENERGY SHIELD', icon: '🛡️', color: 0x22e1ff,
    cooldown: 0.4, desc: 'Absorbs damage and shrugs off knockback.',
  },
  repair: {
    id: 'repair', name: 'NANITE REPAIR', icon: '🔧', color: 0x37ff9b,
    cooldown: 0.3, desc: 'Patches 45 HP of chassis damage.',
  },
};

const DROP_TABLE = [
  { id: 'missile', weight: 22 },
  { id: 'gun', weight: 18 },
  { id: 'mine', weight: 14 },
  { id: 'triple', weight: 10 },
  { id: 'shockwave', weight: 10 },
  { id: 'boost', weight: 11 },
  { id: 'shield', weight: 7 },
  { id: 'repair', weight: 6 },
];

const TOTAL_WEIGHT = DROP_TABLE.reduce((s, d) => s + d.weight, 0);

export function rollAbility() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const d of DROP_TABLE) {
    r -= d.weight;
    if (r <= 0) return ABILITIES[d.id];
  }
  return ABILITIES.missile;
}

function abilityList() { return Object.values(ABILITIES); }

/* ═══════════════════════════════════════════════════════════════════════════
   COMBAT SYSTEM
   ═══════════════════════════════════════════════════════════════════════════ */
export class CombatSystem {
  constructor({ scene, world, audio, fx, buildCrate, getKarts, getPlayer, events = {}, rng = Math.random }) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.fx = fx;
    this.buildCrate = buildCrate;
    this.getKarts = getKarts;
    this.getPlayer = getPlayer;
    this.events = events;
    this.rng = rng;

    this.crates = [];
    this.projectiles = [];
    this.mines = [];
    this.beams = [];
    this.time = 0;
    this.enabled = true;
    this.paused = false;
    /** optional hook: (target, amount, source, opts) => true if handled remotely */
    this.externalDamageHandler = null;
  }

  /* ── crates ────────────────────────────────────────────────── */
  spawnCrates(positions) {
    this.clearCrates();
    positions.forEach((pos, i) => this.createCrate(i, pos));
  }

  createCrate(id, pos) {
    const mesh = this.buildCrate();
    mesh.position.set(pos.x, 0, pos.z);
    this.scene.add(mesh);
    this.crates.push({
      id, x: pos.x, z: pos.z,
      active: true, respawnAt: 0, mesh, spin: this.rng() * Math.PI * 2,
      scale: 0, targetScale: 1, phase: this.rng() * 6.28,
    });
  }

  clearCrates() {
    for (const c of this.crates) {
      this.scene.remove(c.mesh);
      c.mesh.traverse?.((o) => { o.geometry?.dispose?.(); });
    }
    this.crates.length = 0;
  }

  /** Called when a kart drives through a crate. `forced` = ability from network. */
  collectCrate(crate, kart, forced = null) {
    if (!crate.active) return null;
    crate.active = false;
    crate.respawnAt = this.time + 4.5;
    crate.targetScale = 0;

    const ability = forced ? ABILITIES[forced] : rollAbility();
    kart.item = ability;
    kart.itemReadyAt = this.time + (ability.cooldown || 0.4);

    this.fx.sparks(new THREE.Vector3(crate.x, 1.4, crate.z), { count: 26, color: ability.color, speed: 12 });
    this.fx.explosion(new THREE.Vector3(crate.x, 1.2, crate.z), { color: ability.color, scale: 0.55 });
    this.audio?.crateBreak();
    this.audio?.pickup();
    this.events.onCratePickup?.(crate, kart, ability);
    return ability;
  }

  /* ── ability trigger (SPACEBAR) ────────────────────────────── */
  useAbility(kart) {
    if (!this.enabled || this.paused || !kart.alive) return false;
    const ability = kart.item;
    if (!ability) return false;
    if (this.time < (kart.itemReadyAt || 0)) return false;

    const fired = this.executeAbility(kart, ability);
    if (fired) {
      kart.item = null;
      kart.itemReadyAt = 0;
      this.events.onAbilityUsed?.(kart, ability);
    }
    return fired;
  }

  executeAbility(kart, ability) {
    const fwd = kart.forwardVector.clone();
    switch (ability.id) {
      case 'missile': {
        this.spawnMissile(kart, fwd, { damage: 46, splash: 22, radius: 8.5, speed: 64, homing: true });
        this.audio?.missileLaunch();
        return true;
      }
      case 'triple': {
        for (let i = -1; i <= 1; i++) {
          const dir = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.085);
          this.spawnMissile(kart, dir, { damage: 24, splash: 12, radius: 5.5, speed: 80, homing: false });
        }
        this.audio?.missileLaunch();
        return true;
      }
      case 'mine': {
        const pos = kart.position.clone().addScaledVector(fwd, -3).setY(0.35);
        const mesh = this.fx.buildMine(ability.color);
        mesh.position.copy(pos);
        this.scene.add(mesh);
        this.mines.push({ mesh, pos, ownerId: kart.id, armAt: this.time + 0.7, life: this.time + 30, radius: 7, damage: 60 });
        this.audio?.mineDrop();
        return true;
      }
      case 'boost': {
        kart.addBoost(3.4, 1.45);
        this.fx.boostBurst(kart);
        this.audio?.boost();
        this.events.onStatus?.(kart, { kind: 'boost', label: 'NITRO', until: this.time + 3.4 });
        return true;
      }
      case 'shield': {
        kart.shield = 60;
        kart.shieldUntil = this.time + 10;
        this.fx.shieldUp(kart);
        this.audio?.shieldUp();
        this.events.onStatus?.(kart, { kind: 'shield', label: 'SHIELD', until: this.time + 10 });
        return true;
      }
      case 'gun': {
        kart.gunUntil = this.time + 2.4;
        kart.gunNextAt = 0;
        this.audio?.gunshot();
        this.events.onStatus?.(kart, { kind: 'weapon', label: 'MACHINE GUN', until: this.time + 2.4 });
        return true;
      }
      case 'shockwave': {
        this.detonate(kart.position.clone().setY(0.6), {
          radius: 13, damage: 46, owner: kart, color: ability.color, knockback: 34, pop: 15, source: 'shockwave',
        });
        this.fx.shockRing(kart.position.clone().setY(0.4), { color: ability.color, scale: 13, duration: 0.55 });
        this.audio?.shockwave();
        this.fx.shake(0.7, 0.4);
        return true;
      }
      case 'repair': {
        const healed = Math.min(30, kart.maxHealth - kart.health);
        kart.health = Math.min(kart.maxHealth, kart.health + 30);
        this.fx.sparks(kart.position.clone().setY(1), { count: 22, color: 0x37ff9b, speed: 9, up: true });
        this.fx.damageNumber(kart.position.clone().setY(2.4), `+${Math.round(healed || 45)}`, 'heal');
        this.audio?.repair();
        return true;
      }
      default:
        return false;
    }
  }

  /* ── projectiles ───────────────────────────────────────────── */
  spawnMissile(owner, dir, cfg) {
    const mesh = this.fx.buildMissile(cfg.homing ? 0xff7a1a : 0xff2bd6);
    const pos = owner.position.clone().addScaledVector(owner.forwardVector, 2.6).setY(1.15);
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone().normalize());
    this.scene.add(mesh);
    this.projectiles.push({
      mesh, pos, prev: pos.clone(), dir: dir.clone().normalize(),
      speed: cfg.speed, damage: cfg.damage, splash: cfg.splash, radius: cfg.radius,
      homing: !!cfg.homing, ownerId: owner.id, owner, life: this.time + (cfg.homing ? 5.5 : 3.4),
      trailAt: 0, color: cfg.homing ? 0xff7a1a : 0xff2bd6, kind: 'missile',
    });
    this.fx.muzzleFlash(pos, dir, cfg.homing ? 0xffb060 : 0xff7ae0);
  }

  buildBeam(from, to, color, life = 0.12, width = 0.07) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.beams.push({ line, geo, mat, until: this.time + life, width });
  }

  /** Mark a crate as looted by somebody else (network mirror). */
  markCrateTaken(crateId, kart, abilityId) {
    const crate = this.crates.find((c) => c.id === crateId);
    if (!crate || !crate.active) return;
    crate.active = false;
    crate.respawnAt = this.time + 4.5;
    crate.targetScale = 0;
    const pos = new THREE.Vector3(crate.x, 1.4, crate.z);
    this.fx.sparks(pos, { count: 18, color: 0x22e1ff, speed: 10 });
    this.fx.explosion(pos, { color: 0x22e1ff, scale: 0.4 });
    if (kart) this.audio?.pickup();
  }

  /* ── damage ────────────────────────────────────────────────── */
  applyDamage(target, amount, source, opts = {}) {
    if (!this.enabled || !target.alive || amount <= 0) return 0;
    if (target.invuln > 0) return 0;
    amount = Math.round(amount);

    // Remote karts are simulated by their owning client — forward the hit and
    // only play the local feedback so both players see consistent results.
    if (target.isRemote && this.externalDamageHandler) {
      if (this.externalDamageHandler(target, amount, source, opts)) {
        if (source?.isPlayer) {
          this.fx.hitMarker(false);
          this.audio?.hitmarker();
          this.fx.damageNumber(target.position.clone().setY(2.6), `${amount}`, opts.kind || '');
        }
        return 0;
      }
    }

    let dealt = amount;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, amount);
      target.shield -= absorbed;
      dealt = amount - absorbed;
      this.fx.shieldHit(target.position.clone().setY(1), 0x22e1ff);
      if (opts.dir) {
        const nx = opts.dir.x || 0, nz = opts.dir.z || 0;
        const len = Math.hypot(nx, nz) || 1;
        target.velocity.x += (nx / len) * 4;
        target.velocity.z += (nz / len) * 4;
      }
      if (target.shield <= 0) {
        this.events.onStatus?.(target, { kind: 'shield', label: 'SHIELD DOWN', until: 0 });
        this.audio?.shieldUp();
      }
    }

    if (dealt > 0) {
      target.health -= dealt;
      target.lastHitBy = source?.id || null;
      target.lastHitAt = this.time;
      if (opts.dir) {
        const nx = opts.dir.x || 0, nz = opts.dir.z || 0;
        const len = Math.hypot(nx, nz) || 1;
        const knock = (opts.knockback || 0) + Math.min(6, dealt * 0.12);
        target.velocity.x += (nx / len) * knock;
        target.velocity.z += (nz / len) * knock;
      }
      if (opts.pop) target.popVertical(opts.pop);
    }

    // feedback
    const isPlayerTarget = target.isPlayer;
    const isPlayerSource = source?.isPlayer;
    if (isPlayerSource && target !== source) {
      this.fx.hitMarker(!!opts.lethal || target.health <= 0);
      this.audio?.hitmarker();
      source.damageDealt += amount;
    }
    if (isPlayerTarget) {
      this.fx.playerHurt(amount, source);
      this.audio?.hurt();
    }
    if (target.isPlayer || source?.isPlayer) {
      this.fx.damageNumber(target.position.clone().setY(2.6), `${amount}`, dealt === amount ? (opts.kind || '') : 'shield');
    }
    this.events.onDamage?.(target, amount, source, opts);

    if (target.health <= 0) {
      target.health = 0;
      this.kill(target, source, opts.source || 'crash');
    }
    return amount;
  }

  kill(victim, killer, weapon) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.deaths += 1;
    victim.streak = 0;
    victim.item = null;
    victim.gunUntil = 0;
    victim.boostTimer = 0;
    victim.shield = 0;
    victim.deathAt = this.time;
    victim.respawnAt = this.time + 3.0;

    const selfDestruct = !killer || killer === victim || (this.time - (victim.lastHitAt ?? -99) > 8);
    const attributed = !selfDestruct;

    if (attributed) {
      killer.kills += 1;
      killer.streak += 1;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
    }

    this.fx.kartExplosion(victim);
    this.audio?.explosion();
    const dist = victim.position.distanceTo(this.getPlayer?.()?.position || victim.position);
    this.fx.shake(Math.max(0.25, 1.4 - dist / 60), 0.5);

    this.events.onKill?.(attributed ? killer : null, victim, weapon, selfDestruct);
  }

  /** Radius damage helper — used by explosions, mines and shockwaves. */
  detonate(center, cfg) {
    const { radius, damage, owner, color = 0xffa040, knockback = 12, source = 'explosion', pop = 0 } = cfg;
    const karts = this.getKarts().filter((k) => k.alive);
    let hitAny = false;

    for (const k of karts) {
      const dx = k.position.x - center.x;
      const dz = k.position.z - center.z;
      const dy = k.position.y - center.y;
      const dist = Math.sqrt(dx * dx + dz * dz + dy * dy * 0.5);
      if (dist > radius) continue;
      const falloff = 1 - Math.min(1, dist / radius) * 0.6;
      const isOwner = k === owner;
      let dmg = damage * falloff * (isOwner ? 0.35 : 1);
      const dir = { x: dx, z: dz };
      this.applyDamage(k, dmg, owner, {
        dir, kind: source === 'shockwave' ? 'crit' : '',
        knockback: knockback * falloff, pop: pop * falloff, source,
      });
      hitAny = true;
    }

    this.fx.explosion(center, { color, scale: radius / 8 });
    this.fx.smoke(center, { count: 8, scale: radius / 10 });
    this.audio?.explosion();
    // chain: mines inside the blast also go off
    for (const m of this.mines) {
      if (m.detonated) continue;
      if (m.pos.distanceTo(center) < radius) m.detonated = true;
    }
    return hitAny;
  }

  onImpactSound(kart, speed) {
    if (kart.isPlayer) this.audio?.bump(Math.min(1.4, speed / 22));
  }

  /* ── per-frame update ──────────────────────────────────────── */
  update(dt, kartList) {
    this.time += dt;
    if (!this.enabled) return;
    const karts = kartList || this.getKarts();

    /* crates -------------------------------------------------- */
    for (const crate of this.crates) {
      // scale in/out animation
      crate.scale += (crate.targetScale - crate.scale) * Math.min(1, 8 * dt);
      crate.spin += dt * 1.6;
      const bounce = Math.sin(this.time * 2 + crate.phase) * 0.22;
      crate.mesh.position.y = crate.scale * (0.85 + bounce) * 1.15;
      crate.mesh.rotation.y = crate.spin;
      crate.mesh.rotation.x = Math.sin(this.time * 0.9 + crate.phase) * 0.12;
      const s = Math.max(0.001, crate.scale);
      crate.mesh.scale.setScalar(s);

      if (!crate.active) {
        if (this.time >= crate.respawnAt) {
          crate.active = true;
          crate.targetScale = 1;
          this.fx.sparks(new THREE.Vector3(crate.x, 1, crate.z), { count: 10, color: 0x22e1ff, speed: 6, up: true });
        }
        continue;
      }
      if (!crate.mesh.visible) crate.mesh.visible = true;

      for (const k of karts) {
        if (!k.alive) continue;
        const dx = k.position.x - crate.x;
        const dz = k.position.z - crate.z;
        if (dx * dx + dz * dz < (KART_RADIUS + 1.5) ** 2) {
          // bots only grab what they need; players can swap items freely
          if (!k.isPlayer && k.item && k.item.id === 'boost' && this.rng() < 0.5) continue;
          this.collectCrate(crate, k);
          break;
        }
      }
    }

    /* machine guns -------------------------------------------- */
    for (const k of karts) {
      if (!k.alive || !k.gunUntil) continue;
      if (this.time > k.gunUntil) { k.gunUntil = 0; continue; }
      if (this.time < (k.gunNextAt || 0)) continue;
      k.gunNextAt = this.time + 0.075;
      this.fireHitscan(k);
    }

    /* projectiles -------------------------------------------- */
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.prev.copy(p.pos);

      if (p.homing) {
        const target = this.findLockTarget(p);
        if (target) {
          const desired = target.position.clone().setY(1.1).sub(p.pos).normalize();
          const turn = 7.0 * dt;
          p.dir.lerp(desired, Math.min(1, turn)).normalize();
        }
        // gentle gravity so rockets arc a touch
        p.dir.y -= 0.25 * dt;
        p.dir.normalize();
      }

      p.pos.addScaledVector(p.dir, p.speed * dt);
      p.mesh.position.copy(p.pos);
      p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), p.dir);
      if (this.time > p.trailAt) {
        p.trailAt = this.time + 0.02;
        this.fx.smoke(p.pos.clone(), { count: 1, scale: 0.28, color: p.color });
      }

      let hit = false;
      for (const k of karts) {
        if (!k.alive || k.id === p.ownerId || k.invuln > 0) continue;
        if (this.segmentHitsKart(p.prev, p.pos, k)) {
          this.detonate(p.pos.clone(), {
            radius: p.splash ? p.radius : 2.2, damage: p.damage, owner: p.owner,
            color: p.color, knockback: 14, source: 'rocket',
          });
          hit = true;
          break;
        }
      }
      if (!hit && this.worldPointBlocked(p.pos, p.prev)) {
        this.detonate(p.pos.clone(), {
          radius: p.splash ? p.radius : 2.4, damage: p.damage * 0.7, owner: p.owner,
          color: p.color, knockback: 8, source: 'rocket',
        });
        hit = true;
      }
      if (hit || this.time > p.life) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    /* mines --------------------------------------------------- */
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.mesh.rotation.y += dt * 1.4;
      const armed = this.time >= m.armAt;
      m.mesh.scale.setScalar(armed ? 1 : 0.6 + (this.time - (m.armAt - 0.7)) * 0.6);
      m.mesh.traverse?.((o) => { if (o.material && o.material.emissive) o.material.emissiveIntensity = armed ? (1.6 + Math.sin(this.time * 10) * 0.9) : 0.4; });

      if (m.detonated) {
        this.detonate(m.pos.clone().setY(0.4), {
          radius: m.radius, damage: m.damage, owner: this.findKart(m.ownerId),
          color: 0xffc23d, knockback: 26, pop: 10, source: 'mine',
        });
        this.scene.remove(m.mesh);
        this.mines.splice(i, 1);
        continue;
      }

      if (armed) {
        for (const k of karts) {
          if (!k.alive) continue;
          if (k.id === m.ownerId && this.time - m.armAt < 1.6) continue;
          const dx = k.position.x - m.pos.x;
          const dz = k.position.z - m.pos.z;
          if (dx * dx + dz * dz < 5.2 * 5.2) { m.detonated = true; break; }
        }
      }
      if (this.time > m.life) {
        this.scene.remove(m.mesh);
        this.mines.splice(i, 1);
      }
    }

    /* beams fade --------------------------------------------- */
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      if (this.time > b.until) {
        this.scene.remove(b.line);
        b.geo.dispose();
        b.mat.dispose();
        this.beams.splice(i, 1);
      }
    }
  }

  findKart(id) { return this.getKarts().find((k) => k.id === id); }

  findLockTarget(projectile) {
    const owner = projectile.owner;
    let best = null;
    let bestScore = Infinity;
    for (const k of this.getKarts()) {
      if (!k.alive || k.id === projectile.ownerId) continue;
      const toTarget = k.position.clone().setY(1.1).sub(projectile.pos);
      const dist = toTarget.length();
      if (dist > 70) continue;
      const dot = toTarget.normalize().dot(projectile.dir);
      if (dot < 0.05) continue;
      const score = dist * (1.4 - dot);
      if (score < bestScore) { bestScore = score; best = k; }
    }
    return best || projectile.lockedTarget || null;
  }

  segmentHitsKart(a, b, kart) {
    const center = kart.position.clone().setY(0.85);
    const ab = b.clone().sub(a);
    const lenSq = ab.lengthSq();
    if (lenSq < 1e-6) return a.distanceTo(center) < KART_RADIUS + 0.5;
    let t = center.clone().sub(a).dot(ab) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const closest = a.clone().addScaledVector(ab, t);
    const dist = closest.distanceTo(center);
    const vertical = Math.abs(closest.y - center.y);
    return dist < KART_RADIUS + 1.2 && vertical < 1.8;
  }

  worldPointBlocked(pos, prev) {
    if (pos.y < 0.05) return true;
    // sample short ray against the collision world
    const dir = pos.clone().sub(prev);
    const len = dir.length();
    if (len < 1e-4) return false;
    dir.divideScalar(len);
    const hit = this.world.raycast({ x: prev.x, z: prev.z }, { x: dir.x, z: dir.z }, len, prev.y);
    return hit < len;
  }

  /** §Machine gun — hitscan with light aim assist. */
  fireHitscan(kart) {
    const origin = kart.position.clone().addScaledVector(kart.forwardVector, 2.4).setY(1.05);
    const fwd = kart.forwardVector.clone();

    // aim assist: prefer the closest enemy inside a ~13° cone, with lead
    let best = null;
    let bestDot = Math.cos(0.22);
    for (const k of this.getKarts()) {
      if (!k.alive || k === kart) continue;
      const lead = k.velocity.clone().multiplyScalar(Math.min(0.35, k.position.distanceTo(origin) / 160));
      const to = k.position.clone().setY(1.05).add(lead).sub(origin);
      const dist = to.length();
      if (dist > 55) continue;
      to.normalize();
      const dot = to.dot(fwd);
      if (dot > bestDot) { bestDot = dot; best = { k, to, dist }; }
    }
    const spread = 0.014;
    const dir = (best ? best.to : fwd).clone();
    dir.x += (this.rng() - 0.5) * spread;
    dir.y += (this.rng() - 0.5) * spread;
    dir.z += (this.rng() - 0.5) * spread;
    dir.normalize();

    const maxDist = 70;
    const wall = this.world.raycast({ x: origin.x, z: origin.z }, { x: dir.x, z: dir.z }, maxDist, origin.y);
    let endPoint = origin.clone().addScaledVector(dir, Math.min(maxDist, wall));

    // nearest kart intersection closer than the wall
    let hitKart = null;
    let hitDist = maxDist;
    for (const k of this.getKarts()) {
      if (!k.alive || k === kart) continue;
      const to = k.position.clone().setY(1.05).sub(origin);
      const t = to.dot(dir);
      if (t < 0 || t > hitDist) continue;
      const closest = origin.clone().addScaledVector(dir, t);
      if (closest.distanceTo(k.position.clone().setY(1.05)) < KART_RADIUS + 0.85) {
        hitDist = t;
        hitKart = k;
      }
    }

    if (hitKart && hitDist <= wall) {
      endPoint = origin.clone().addScaledVector(dir, hitDist);
      this.applyDamage(hitKart, 7, kart, { dir, source: 'gun', kind: '' });
      this.fx.sparks(endPoint, { count: 5, color: 0xb4ff39, speed: 7 });
    } else {
      this.fx.sparks(endPoint, { count: 4, color: 0x8fa6c8, speed: 5 });
    }

    this.buildBeam(origin, endPoint, 0xb4ff39, 0.07);
    this.fx.muzzleFlash(origin, dir, 0xd8ff8a);
    kart.gunRecoil = 1;
    if (kart.isPlayer) this.audio?.gunshot();
  }

  /* ── lifecycle ─────────────────────────────────────────────── */
  reset() {
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const m of this.mines) this.scene.remove(m.mesh);
    for (const b of this.beams) { this.scene.remove(b.line); b.geo.dispose(); b.mat.dispose(); }
    this.projectiles.length = 0;
    this.mines.length = 0;
    this.beams.length = 0;
    this.time = 0;
    for (const c of this.crates) {
      c.active = true;
      c.scale = 0;
      c.targetScale = 1;
      c.respawnAt = 0;
    }
  }

  dispose() {
    this.clearCrates();
    this.reset();
  }
}

export { abilityList };
