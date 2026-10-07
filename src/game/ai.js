/**
 * Super Racers — Bot AI.
 *
 * A light-weight, steering-behaviour brain: seek, pursuit, item hunting,
 * whisker-based obstacle avoidance, unstick manoeuvres, drift discipline and
 * skill-scaled trigger discipline. Bots read the same KartBody + CollisionWorld
 * as the player, so they can never cheat physics.
 */

import * as THREE from 'three';
import { SKINS, BOT_NAMES } from '../ui/profile.js';

const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

const forwardOf = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

/**
 * Trigger discipline per ability: how close, how aligned and how eager a bot is.
 * `instant` abilities (shield / boost / repair) are used the moment they're
 * picked up so the bot frees its slot and hunts for the next crate.
 */
const FIRE_SPEC = {
  missile: { range: 62, cone: 0.8, chance: 0.8, cd: 0.5 },
  triple: { range: 50, cone: 0.5, chance: 0.72, cd: 0.6 },
  mine: { range: 11, cone: 3.2, chance: 0.85, cd: 0.8 },
  gun: { range: 46, cone: 0.3, chance: 0.92, cd: 0.25 },
  shockwave: { range: 14, cone: 3.2, chance: 0.95, cd: 1.0 },
  boost: { instant: true, chance: 0.9, cd: 0.4 },
  shield: { instant: true, chance: 1, cd: 0.3 },
  repair: { instant: true, chance: 1, cd: 0.3, needsDamage: 12 },
};

export class BotBrain {
  constructor(kart, { skill = 0.6, aggression = 0.6, id = 'bot' }) {
    this.kart = kart;
    this.skill = skill;
    this.aggression = aggression;
    this.id = id;

    this.input = { throttle: 1, steerSmooth: 0, drift: false, ability: false };
    this.state = 'hunt';
    this.target = null;
    this.targetAt = 0;
    this.unstickUntil = 0;
    this.unstickDir = 1;
    this.reactionTimer = 0;
    this.aimError = (Math.random() - 0.5) * (1 - skill) * 0.6;
    this.wander = { x: 0, z: 0, until: 0 };
    this.fireCooldown = 0;
    this.lastAbility = null;
  }

  update(dt, ctx) {
    const kart = this.kart;
    if (!kart.alive) {
      this.input.throttle = 0;
      this.input.steerSmooth = 0;
      this.input.drift = false;
      return;
    }

    const { karts, world, combat, crates, time } = ctx;
    this.reactionTimer -= dt;
    this.fireCooldown -= dt;

    /* ── unstick ───────────────────────────────────────────── */
    if (time < this.unstickUntil) {
      this.input.throttle = -1;
      this.input.steerSmooth = this.unstickDir;
      this.input.drift = false;
      return;
    }
    if (kart.stuckTimer > 1.1) {
      this.unstickUntil = time + 0.9;
      this.unstickDir = Math.random() < 0.5 ? -1 : 1;
      return;
    }

    /* ── choose a goal ─────────────────────────────────────── */
    let goalX = 0;
    let goalZ = 0;
    let pursuing = false;
    let goalSpeed = 1;

    const hurt = kart.health < kart.maxHealth * 0.5;
    const wantCrate = !kart.item || hurt || kart.item.id === 'repair';
    let bestCrate = null;
    let bestCrateDist = Infinity;
    if (wantCrate && crates) {
      for (const c of crates) {
        if (!c.active) continue;
        const d = Math.hypot(c.x - kart.position.x, c.z - kart.position.z);
        if (d < bestCrateDist) { bestCrateDist = d; bestCrate = c; }
      }
    }

    // re-acquire target every ~1.2s (or when it dies)
    if (time > this.targetAt || !this.target || !this.target.alive) {
      this.target = this.pickTarget(karts);
      this.targetAt = time + 1.2;
    }

    const target = this.target;
    let targetDist = Infinity;
    if (target) {
      targetDist = Math.hypot(target.position.x - kart.position.x, target.position.z - kart.position.z);
    }

    const lootRange = kart.item ? 46 : 70;
    if (bestCrate && bestCrateDist < Math.min(lootRange, Math.max(22, targetDist * 1.35))) {
      goalX = bestCrate.x;
      goalZ = bestCrate.z;
      this.state = 'loot';
    } else if (target && targetDist < 90) {
      pursuing = true;
      this.state = 'hunt';
      // lead the target a little when they're moving fast (skill scaled)
      const lead = Math.min(1.1, targetDist / 45) * this.skill;
      const px = target.position.x + target.velocity.x * lead * 0.45;
      const pz = target.position.z + target.velocity.z * lead * 0.45;
      // circle-strafe: approach from an offset angle
      const ang = Math.atan2(pz - kart.position.z, px - kart.position.x) + this.aimError * 0.5;
      const standoff = kart.item ? 14 : 8;
      goalX = px - Math.cos(ang) * standoff * (1 - this.aggression * 0.5);
      goalZ = pz - Math.sin(ang) * standoff * (1 - this.aggression * 0.5);
      this.state = 'hunt';
    } else {
      // wander to a random open point
      if (time > this.wander.until) {
        this.wander = {
          x: (Math.random() - 0.5) * 100,
          z: (Math.random() - 0.5) * 100,
          until: time + 4 + Math.random() * 4,
        };
      }
      goalX = this.wander.x;
      goalZ = this.wander.z;
      this.state = 'roam';
    }

    /* ── steering toward the goal ──────────────────────────── */
    let dx = goalX - kart.position.x;
    let dz = goalZ - kart.position.z;
    let desiredYaw = Math.atan2(-dx, -dz);

    /* ── whisker obstacle avoidance ────────────────────────── */
    const origin = { x: kart.position.x, z: kart.position.z };
    const speed = Math.abs(kart.forwardSpeed);
    const lookAhead = 9 + Math.min(16, speed * 0.5);
    const feelers = [0, 0.42, -0.42, 0.9, -0.9];
    let clearanceLeft = Infinity;
    let clearanceRight = Infinity;
    let blocked = false;

    for (const off of feelers) {
      const dir = forwardOf(kart.yaw + off);
      const dist = world.raycast(origin, dir, lookAhead, 1);
      if (dist < lookAhead) {
        blocked = true;
        const weight = Math.max(0.25, 1 - dist / lookAhead);
        if (off > 0.05) clearanceLeft = Math.min(clearanceLeft, dist + 0);
        else if (off < -0.05) clearanceRight = Math.min(clearanceRight, dist);
        else {
          clearanceLeft = Math.min(clearanceLeft, dist);
          clearanceRight = Math.min(clearanceRight, dist);
        }
        // deflect the goal away from the hit direction
        const deflect = off === 0 ? (clearanceLeft > clearanceRight ? 0.6 : -0.6) : -Math.sign(off) * 0.7;
        desiredYaw += deflect * weight;
      }
    }
    if (blocked && speed > 24) goalSpeed = 0.62;
    else if (pursuing && targetDist < 26) goalSpeed = 1;

    const angleDiff = wrapAngle(desiredYaw - kart.yaw);
    const steerTarget = THREE.MathUtils.clamp(angleDiff * 1.9, -1, 1);
    this.input.steerSmooth = steerTarget;
    this.input.throttle = goalSpeed * (this.skill > 0.5 ? 1 : 0.86);
    this.input.drift = Math.abs(angleDiff) > 0.85 && speed > 19 && this.skill > 0.35;

    // low skill bots lift off the throttle into tight corners
    if (Math.abs(angleDiff) > 1.5 && this.skill < 0.6 && speed > 18) this.input.throttle = 0.25;

    /* ── weapon usage ──────────────────────────────────────── */
    this.input.ability = false;
    const ability = kart.item;
    if (ability && this.reactionTimer <= 0 && this.fireCooldown <= 0) {
      const spec = FIRE_SPEC[ability.id] || FIRE_SPEC.missile;
      let doFire = false;

      if (spec.instant) {
        // utility items are used straight away so the bot can loot again
        doFire = ability.id === 'repair'
          ? kart.health < kart.maxHealth - (spec.needsDamage || 10)
          : true;
      } else if (target && target.alive) {
        const toTarget = Math.atan2(-(target.position.x - kart.position.x), -(target.position.z - kart.position.z));
        const facing = Math.abs(wrapAngle(toTarget - kart.yaw));
        const cone = spec.cone + (1 - this.skill) * 0.22;
        if (targetDist < spec.range && facing < cone) doFire = Math.random() < spec.chance;
        // a homing missile in flight-away situations is still worth a shot
        if (!doFire && ability.id === 'missile' && targetDist < 30 && Math.random() < 0.3) doFire = true;
      }

      if (doFire) {
        combat.useAbility(kart);
        this.fireCooldown = spec.cd + (1 - this.skill) * 0.7;
        this.reactionTimer = 0.08 + (1 - this.skill) * 0.3;
      }
    }

    this.lastAbility = ability;
    kart.botInput = this.input;
  }

  pickTarget(karts) {
    const kart = this.kart;
    let best = null;
    let bestScore = -Infinity;
    for (const k of karts) {
      if (k === kart || !k.alive) continue;
      const dist = Math.hypot(k.position.x - kart.position.x, k.position.z - kart.position.z);
      let score = 120 - dist;
      if (k.health < 65) score += 55;           // finish the weak
      if (k.isPlayer) score += 18 * this.aggression; // a little grudge against the player
      if (k.streak > 2) score += 20;            // kingmaker behaviour
      if (score > bestScore) { bestScore = score; best = k; }
    }
    return best;
  }
}

/* ── roster helpers ──────────────────────────────────────────────────────── */
export function createBotRoster(count, { playerLevel = 1 } = {}) {
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const skins = SKINS.filter((s) => (s.unlockLevel || 1) <= Math.max(1, playerLevel)).concat(SKINS);
  const roster = [];
  for (let i = 0; i < count; i++) {
    const skill = THREE.MathUtils.clamp(0.28 + Math.random() * 0.62 + Math.min(0.12, playerLevel * 0.01), 0.2, 0.98);
    roster.push({
      id: `bot-${i}-${Math.random().toString(36).slice(2, 7)}`,
      name: `${names[i % names.length]}`,
      skin: skins[Math.floor(Math.random() * skins.length)],
      skill,
      aggression: 0.25 + Math.random() * 0.7,
      isBot: true,
      // bots scale their kart a touch with skill so better bots feel better
      modBias: 0.96 + skill * 0.1,
    });
  }
  return roster;
}
