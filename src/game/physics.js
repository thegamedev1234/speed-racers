/**
 * Super Racers — Custom arcade physics.
 *
 * No Rapier / Ammo / Cannon: a hand-rolled, dependency-free model built around
 * AABB + circle collision tests and raycast-style whisker probes. Tuned for
 * arcade "kart" feel: snappy acceleration, drift-friendly lateral grip,
 * forgiving wall bounces, small jump rails.
 *
 * ── COORDINATE CONVENTION ──────────────────────────────────────────────────
 *   Karts are modelled facing −Z with the model's yaw applied on the Y axis.
 *   forward = (−sin(yaw), 0, −cos(yaw))
 *
 *   Positive Y rotation turns the nose to the LEFT of the driver.
 *   Therefore:  A / ←  =>  steer +1  =>  yaw INCREASES (positive Y rotation)
 *               D / →  =>  steer −1  =>  yaw DECREASES (negative Y rotation)
 *   W accelerates along the kart's own local forward vector.
 * ───────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';

export const KART_RADIUS = 1.55;
export const KART_HEIGHT = 1.5;

const GRAVITY = 40;
const BASE_MAX_SPEED = 33;
const BASE_ACCEL = 30;
const BASE_REVERSE = 13;
const BASE_TURN_RATE = 2.55;
const BASE_GRIP = 6.2;
const DRIFT_GRIP = 1.55;
const COAST_DRAG = 1.35;
const AIR_DRAG = 0.12;

export const ARCADE = {
  BASE_MAX_SPEED, BASE_ACCEL, BASE_TURN_RATE, BASE_GRIP,
  GRAVITY,
  SPEED_DISPLAY: 4.35, // world units/s → "km/h" HUD number
};

const tempV = new THREE.Vector3();
const tempV2 = new THREE.Vector3();

/* ═══════════════════════════════════════════════════════════════════════════
   COLLISION WORLD — axis-aligned boxes + cylinders, queried by a moving circle
   ═══════════════════════════════════════════════════════════════════════════ */
export class CollisionWorld {
  constructor() {
    this.boxes = [];
    this.cylinders = [];
    /** optional callback(impact) when a kart smacks something hard */
    this.onImpact = null;
  }

  clear() {
    this.boxes.length = 0;
    this.cylinders.length = 0;
  }

  /** @param {{x:number,z:number,w:number,d:number,h?:number,tag?:string}} o */
  addBox(o) {
    const b = {
      minX: o.x - o.w / 2, maxX: o.x + o.w / 2,
      minZ: o.z - o.d / 2, maxZ: o.z + o.d / 2,
      h: o.h ?? 4, tag: o.tag || 'wall',
    };
    this.boxes.push(b);
    return b;
  }

  /** add a box defined by min/max corners (used for the arena bounds) */
  addBoxMinMax(minX, minZ, maxX, maxZ, h = 4, tag = 'wall') {
    const b = { minX, maxX, minZ, maxZ, h, tag };
    this.boxes.push(b);
    return b;
  }

  addCylinder(o) {
    const c = { x: o.x, z: o.z, r: o.r, h: o.h ?? 4, tag: o.tag || 'pylon' };
    this.cylinders.push(c);
    return c;
  }

  /** Perimeter walls: everything outside [-half, half] is solid. */
  addBounds(half, height = 5, thickness = 4) {
    const t = thickness;
    this.addBoxMinMax(-half - t, -half - t, half + t, -half, height, 'wall');
    this.addBoxMinMax(-half - t, half, half + t, half + t, height, 'wall');
    this.addBoxMinMax(-half - t, -half, -half, half, height, 'wall');
    this.addBoxMinMax(half, -half, half + t, half, height, 'wall');
  }

  /**
   * Resolve a circle (kart) against the static world.
   * Mutates `body` (position + velocity) and returns impact info.
   */
  resolveCircle(body, radius = KART_RADIUS) {
    const impacts = [];
    const p = body.position;
    const v = body.velocity;

    const test = (nx, nz, penetration, h, tag) => {
      if (p.y > h) return;
      if (penetration <= 0) return;
      p.x += nx * penetration;
      p.z += nz * penetration;
      const vn = v.x * nx + v.z * nz;
      if (vn < 0) {
        // reflect with arcade-y restitution + tangential friction
        const restitution = 0.36;
        v.x -= (1 + restitution) * vn * nx;
        v.z -= (1 + restitution) * vn * nz;
        v.x *= 0.94;
        v.z *= 0.94;
        impacts.push({ normal: { x: nx, z: nz }, speed: -vn, tag, x: p.x, z: p.z, y: p.y });
      }
    };

    for (const b of this.boxes) {
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      let dx = p.x - cx;
      let dz = p.z - cz;
      let distSq = dx * dx + dz * dz;

      if (distSq > radius * radius) continue;

      if (distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        const pen = radius - dist;
        test(dx / dist, dz / dist, pen, b.h, b.tag);
      } else {
        // centre is inside the box: push out through the closest face
        const toLeft = p.x - b.minX, toRight = b.maxX - p.x;
        const toBack = p.z - b.minZ, toFront = b.maxZ - p.z;
        const m = Math.min(toLeft, toRight, toBack, toFront);
        if (m === toLeft) test(-1, 0, toLeft + radius, b.h, b.tag);
        else if (m === toRight) test(1, 0, toRight + radius, b.h, b.tag);
        else if (m === toBack) test(0, -1, toBack + radius, b.h, b.tag);
        else test(0, 1, toFront + radius, b.h, b.tag);
      }
    }

    for (const c of this.cylinders) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const sum = radius + c.r;
      const distSq = dx * dx + dz * dz;
      if (distSq > sum * sum) continue;
      const dist = Math.sqrt(Math.max(distSq, 1e-8));
      test(dx / dist, dz / dist, sum - dist, c.h, c.tag);
    }

    return impacts;
  }

  /**
   * Raycast whisker against boxes/cylinders — used by bot sensors and
   * by the "unstick" helper. Returns distance to first hit (or maxDist).
   */
  raycast(origin, dir, maxDist = 20, height = 1) {
    let best = maxDist;
    const ox = origin.x, oz = origin.z;
    const dx = dir.x, dz = dir.z;

    for (const b of this.boxes) {
      if (height > b.h) continue;
      let tmin = 0, tmax = best;
      // X slab
      if (Math.abs(dx) < 1e-6) {
        if (ox < b.minX || ox > b.maxX) continue;
      } else {
        let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx;
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      // Z slab
      if (Math.abs(dz) < 1e-6) {
        if (oz < b.minZ || oz > b.maxZ) continue;
      } else {
        let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz;
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      if (tmin >= 0 && tmin < best) best = tmin;
    }

    for (const c of this.cylinders) {
      if (height > c.h) continue;
      const fx = ox - c.x, fz = oz - c.z;
      const a = dx * dx + dz * dz;
      if (a < 1e-6) continue;
      const bq = 2 * (fx * dx + fz * dz);
      const cq = fx * fx + fz * fz - c.r * c.r;
      const disc = bq * bq - 4 * a * cq;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      const t1 = (-bq - sq) / (2 * a);
      const t2 = (-bq + sq) / (2 * a);
      const t = t1 >= 0 ? t1 : t2;
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }

  /** Cheap "is there open space in this direction" test for bot navigation. */
  isClear(origin, dir, dist = 12, height = 1) {
    return this.raycast(origin, dir, dist, height) >= dist;
  }

  /** Does a circle at (x,z) intersect any collider? Used to validate spawns. */
  overlapsCircle(x, z, r, height = 1) {
    for (const b of this.boxes) {
      if (height > b.h) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    for (const c of this.cylinders) {
      if (height > c.h) continue;
      const dx = x - c.x;
      const dz = z - c.z;
      const sum = r + c.r;
      if (dx * dx + dz * dz < sum * sum) return true;
    }
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   KART BODY — the arcade vehicle simulation
   ═══════════════════════════════════════════════════════════════════════════ */
export class KartBody {
  constructor({
    id, name, mods = { maxSpeed: 1, accel: 1, grip: 1, maxHealth: 100 },
    spawn = { x: 0, z: 0, yaw: 0 }, isPlayer = false, skinId = 'comet',
  }) {
    this.id = id;
    this.name = name;
    this.skinId = skinId;
    this.isPlayer = isPlayer;
    this.mods = mods;

    this.position = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.velocity = new THREE.Vector3();
    this.yaw = spawn.yaw || 0;
    this.steer = 0;

    // derived per-frame values used by visuals & HUD
    this.speed = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.drifting = false;
    this.airborne = false;
    this.wallGrind = 0;

    this.maxHealth = mods.maxHealth ?? 100;
    this.health = this.maxHealth;
    this.shield = 0;
    this.alive = true;
    this.respawnAt = 0;

    this.boostTimer = 0;
    this.boostPower = 1;
    this.invuln = 0;
    this.lastHitBy = null;
    this.lastHitAt = 0;

    this.kills = 0;
    this.deaths = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.damageDealt = 0;

    // movement tuning multipliers that abilities can modify
    this.speedMul = 1;
    this.gripMul = 1;
    this.slowTimer = 0;
    this.slowAmount = 0;

    this.stuckTimer = 0;
    this.lastImpactAt = 0;
    this.input = { throttle: 0, steer: 0, steerSmooth: 0, drift: false };
  }

  get forwardVector() {
    // Facing −Z at yaw 0 (matches the kart mesh orientation).
    return tempV.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  get rightVector() {
    return tempV2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  get speedKmh() {
    return Math.abs(this.forwardSpeed) * ARCADE.SPEED_DISPLAY;
  }

  respawn(spawn) {
    this.position.set(spawn.x, 0, spawn.z);
    this.velocity.set(0, 0, 0);
    this.yaw = spawn.yaw || 0;
    this.health = this.maxHealth;
    this.shield = 0;
    this.alive = true;
    this.airborne = false;
    this.boostTimer = 0;
    this.speedMul = 1;
    this.slowTimer = 0;
    this.steer = 0;
  }

  addBoost(seconds, power = 1.32) {
    this.boostTimer = Math.max(this.boostTimer, seconds);
    this.boostPower = power;
  }

  slow(seconds, amount = 0.55) {
    this.slowTimer = Math.max(this.slowTimer, seconds);
    this.slowAmount = Math.min(this.slowAmount || 1, amount);
  }

  /**
   * Advance one physics step.
   * @param {number} dt seconds (already clamped, ≤ 0.05)
   * @param {object} input { throttle, steerSmooth, drift }
   * @param {CollisionWorld} world
   * @param {Array} others other KartBody instances for kart-vs-kart contacts
   */
  update(dt, input, world, others = []) {
    this.input = input;
    const throttle = input.throttle || 0;
    const steerInput = input.steerSmooth ?? input.steer ?? 0;
    const drift = !!input.drift;

    const boosting = this.boostTimer > 0;
    if (boosting) this.boostTimer -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.slowAmount = 0;
    }

    const maxSpeed = BASE_MAX_SPEED * (this.mods.maxSpeed || 1) * this.speedMul * (boosting ? this.boostPower : 1) * (this.slowAmount ? this.slowAmount : 1);
    const accel = BASE_ACCEL * (this.mods.accel || 1) * (boosting ? 2.1 : 1) * (this.slowAmount ? this.slowAmount : 1);

    const fwd = this.forwardVector.clone();
    const right = this.rightVector.clone();

    // ── longitudinal & lateral split ──
    let vForward = this.velocity.x * fwd.x + this.velocity.z * fwd.z;
    let vLateral = this.velocity.x * right.x + this.velocity.z * right.z;

    if (throttle > 0) {
      if (vForward < maxSpeed) vForward += accel * dt * (1 - Math.max(0, vForward / maxSpeed) * 0.72);
    } else if (throttle < 0) {
      if (vForward > 0) {
        vForward -= accel * 1.5 * dt;                 // braking
      } else if (vForward > -BASE_REVERSE * (this.mods.maxSpeed || 1)) {
        vForward -= accel * 0.7 * dt;                 // reverse
      }
    } else {
      // rolling resistance / engine braking
      const drop = COAST_DRAG * dt * (1 + Math.abs(vForward) * 0.03);
      if (vForward > 0) vForward = Math.max(0, vForward - drop * 6);
      else if (vForward < 0) vForward = Math.min(0, vForward + drop * 6);
    }

    // clamp top speed (only when not boosting downhill... all flat here)
    if (vForward > maxSpeed) vForward = Math.max(maxSpeed, vForward - 30 * dt);

    // ── steering ──
    // steer > 0 → positive Y rotation (turn LEFT, as required)
    const grounded = !this.airborne;
    const speedFactor = Math.min(1, Math.abs(vForward) / 9) * (1 - Math.min(0.34, Math.abs(vForward) / (BASE_MAX_SPEED * 3.4)));
    const driftBonus = drift && Math.abs(vForward) > 6 ? 1.42 : 1;
    const airFactor = grounded ? 1 : 0.42;
    const turnRate = BASE_TURN_RATE * (this.mods.grip || 1) * this.gripMul * driftBonus * airFactor;
    const reverseSign = vForward < -0.6 ? -1 : 1;

    this.steer += (steerInput - this.steer) * Math.min(1, 14 * dt);
    this.yaw += this.steer * turnRate * speedFactor * reverseSign * dt;

    // ── lateral grip ──
    const grip = (drift && Math.abs(vForward) > 6 ? DRIFT_GRIP : BASE_GRIP) * (this.mods.grip || 1) * this.gripMul * (grounded ? 1 : 0.06);
    vLateral *= Math.exp(-grip * dt);

    // drifting bleeds some forward speed but scrubs the tyres (visual/sfx)
    this.drifting = grounded && drift && Math.abs(vForward) > 7;
    if (this.drifting) vForward -= vForward * 0.22 * dt;

    // ── recompose world velocity ──
    this.velocity.x = fwd.x * vForward + right.x * vLateral;
    this.velocity.z = fwd.z * vForward + right.z * vLateral;

    // ── vertical ──
    if (this.position.y > 0.001 || this.velocity.y !== 0) {
      this.velocity.y -= GRAVITY * dt;
      this.position.y += this.velocity.y * dt;
      this.airborne = this.position.y > 0.02;
      if (this.position.y <= 0) {
        this.position.y = 0;
        if (this.velocity.y < -6) this.landedHard = Math.min(1, -this.velocity.y / 26);
        this.velocity.y = 0;
        this.airborne = false;
      }
    } else {
      this.airborne = false;
    }

    // ── integrate horizontal position ──
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // ── static world collision (AABB + cylinders) ──
    const impacts = world.resolveCircle(this, KART_RADIUS);
    let peakImpact = 0;
    for (const imp of impacts) {
      if (imp.speed > peakImpact) peakImpact = imp.speed;
    }
    if (peakImpact > 2) {
      this.wallGrind = 1;
      this.lastImpactAt = performance.now();
      if (world.onImpact) world.onImpact(this, peakImpact, impacts[0]);
    } else {
      this.wallGrind = Math.max(0, this.wallGrind - dt * 4);
    }

    // ── kart vs kart contacts ──
    for (const other of others) {
      if (other === this || !other.alive) continue;
      const dx = other.position.x - this.position.x;
      const dz = other.position.z - this.position.z;
      const distSq = dx * dx + dz * dz;
      const minDist = KART_RADIUS * 2;
      if (distSq > minDist * minDist || distSq < 1e-6) continue;
      if (Math.abs(other.position.y - this.position.y) > KART_HEIGHT) continue;

      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = (minDist - dist) * 0.5;

      this.position.x -= nx * overlap;
      this.position.z -= nz * overlap;
      other.position.x += nx * overlap;
      other.position.z += nz * overlap;

      const relVx = other.velocity.x - this.velocity.x;
      const relVz = other.velocity.z - this.velocity.z;
      const relN = relVx * nx + relVz * nz;

      if (relN < 0) {
        const push = relN * 0.5;
        this.velocity.x += nx * push * 1.1;
        this.velocity.z += nz * push * 1.1;
        other.velocity.x -= nx * push * 1.1;
        other.velocity.z -= nz * push * 1.1;
        // impart a little of our own momentum (ramming feels good)
        this.velocity.x -= nx * Math.abs(relN) * 0.06;
        this.velocity.z -= nz * Math.abs(relN) * 0.06;
        other.velocity.x += nx * Math.abs(relN) * 0.06;
        other.velocity.z += nz * Math.abs(relN) * 0.06;

        this.ramContacts = this.ramContacts || [];
        this.ramContacts.push({ other, speed: -relN });
      }
    }

    // ── derived bookkeeping for HUD / visuals ──
    const fwd2 = this.forwardVector;
    this.forwardSpeed = this.velocity.x * fwd2.x + this.velocity.z * fwd2.z;
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);

    // stuck detector
    if (Math.abs(throttle) > 0 && this.speed < 1.2) this.stuckTimer += dt;
    else this.stuckTimer = 0;
    this.ramContacts = null;
    this.landedHard = this.landedHard ? this.landedHard : 0;
  }

  popVertical(force) {
    this.velocity.y = force;
    this.position.y = Math.max(this.position.y, 0.01);
    this.airborne = true;
  }
}

/**
 * Kart-vs-kart "ram" damage resolution — called by the combat system once per
 * frame so both sides of a collision agree on who hit whom.
 */
export function resolveRamming(karts, combat) {
  const now = performance.now();
  for (const a of karts) {
    if (!a.alive || !a.ramContacts) continue;
    for (const contact of a.ramContacts) {
      const b = contact.other;
      if (!b.alive) continue;
      const speed = contact.speed;
      const boosting = a.boostTimer > 0 ? 1.9 : 1;
      if (speed > 13) {
        const dmg = Math.min(30, (speed - 13) * 1.8 * boosting);
        if (dmg > 1) {
          combat.applyDamage(b, dmg, a, { type: 'ram', dir: { x: b.position.x - a.position.x, z: b.position.z - a.position.z } });
        }
      }
      if (speed > 6 && now - (a.lastBumpAt || 0) > 220) {
        a.lastBumpAt = now;
        combat.onImpactSound(a, speed);
      }
    }
    a.ramContacts = null;
  }
}

export const PHYSICS_DEBUG = { tempV };
