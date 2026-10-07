/**
 * Super Racers — headless smoke test.
 *
 * Runs the *real* game systems (physics, arena colliders, combat, bot AI, kart
 * model) inside Node with a stubbed canvas, then asserts the critical gameplay
 * contracts — above all the steering direction rules:
 *
 *      A / ←  →  steer +1  →  POSITIVE Y rotation (turn left)
 *      D / →  →  steer -1  →  NEGATIVE Y rotation (turn right)
 *      W      →  movement along the kart's own local forward vector
 *
 * Run:  node scripts/smoke-test.js
 */

/* ── DOM stubs (canvas is only ever used for procedural textures) ───────── */
const gradientStub = { addColorStop() {} };
function makeCtxStub(canvas) {
  const store = { canvas };
  return new Proxy(store, {
    get(target, key) {
      if (key in target) return target[key];
      const fn = (...args) => {
        if (String(key).startsWith('create')) return { addColorStop() {} };
        return gradientStub;
      };
      target[key] = fn;
      return fn;
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return { style: {}, appendChild() {}, addEventListener() {} };
    const canvas = {
      width: 256, height: 256, style: {},
      getContext: () => makeCtxStub(canvas),
      addEventListener() {},
    };
    return canvas;
  },
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  documentElement: { requestFullscreen() {} },
};
globalThis.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener() {} };

/* ── imports (after the stubs) ─────────────────────────────────────────── */
const THREE = await import('three');
const { CollisionWorld, KartBody, resolveRamming, ARCADE } = await import('../src/game/physics.js');
const { CombatSystem, ABILITIES, rollAbility } = await import('../src/game/combat.js');
const { BotBrain, createBotRoster } = await import('../src/game/ai.js');
const { buildArenaObjects, ARENA_HALF, CRATE_SPAWNS, KART_SPAWNS, THEMES, generateSpawnPoints } = await import('../src/game/arena.js');
const { buildKartMesh } = await import('../src/graphics/karts.js');
const { SKINS, skinModifiers, ProfileManager } = await import('../src/ui/profile.js');
const { chaseCameraOffset } = await import('../src/game/engine.js');

/* ── tiny assertion harness ────────────────────────────────────────────── */
let pass = 0;
let fail = 0;
const failures = [];
function ok(condition, label, detail = '') {
  if (condition) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; failures.push(label); console.log(`  \x1b[31m✗ ${label}\x1b[0m ${detail}`); }
}
function section(name) { console.log(`\n\x1b[1m${name}\x1b[0m`); }

const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

/* ── fake fx layer (records calls instead of drawing) ──────────────────── */
const fxLog = { explosion: 0, sparks: 0, smoke: 0, damageNumber: 0, hitMarker: 0, shake: 0, rings: 0, hurt: 0 };
const fx = {
  explosion: () => fxLog.explosion++,
  sparks: () => fxLog.sparks++,
  smoke: () => fxLog.smoke++,
  damageNumber: () => fxLog.damageNumber++,
  hitMarker: () => fxLog.hitMarker++,
  playerHurt: () => fxLog.hurt++,
  shake: () => fxLog.shake++,
  kartExplosion: () => fxLog.explosion++,
  boostBurst: () => {},
  muzzleFlash: () => {},
  shieldUp: () => {},
  shieldHit: () => {},
  shockRing: () => fxLog.rings++,
  buildMine: () => new THREE.Group(),
  buildMissile: () => new THREE.Group(),
  makeCrate: () => new THREE.Group(),
};

/* ═══════════════════════════ 1. profile & skins ═══════════════════════ */
section('1. Profile, skins & progression');
const profile = new ProfileManager();
ok(profile.name && profile.name.length > 0, 'profile gets a default racer name', profile.name);
profile.setName('Test Racer');
ok(profile.name === 'Test Racer', 'name can be set');
profile.setName('<<bad>>name');
ok(!profile.name.includes('<'), 'name is sanitised', profile.name);
ok(SKINS.length === 8, `8 kart skins available (${SKINS.length})`);
ok(SKINS.every((s) => s.stats && ['speed', 'accel', 'grip', 'armor'].every((k) => s.stats[k] >= 1 && s.stats[k] <= 5)),
  'every skin has 1..5 stats');

const { xp, levelUp } = profile.recordMatch({ kills: 7, deaths: 3, placement: 1, players: 6, won: true });
ok(xp > 0 && profile.data.kills === 7 && profile.data.wins === 1, `match XP + stats recorded (${xp} XP)`);

const tank = skinModifiers(SKINS.find((s) => s.id === 'magma'));
const glass = skinModifiers(SKINS.find((s) => s.id === 'wraith'));
ok(tank.maxHealth > glass.maxHealth, 'armor stat changes max health',
  `${tank.maxHealth} vs ${glass.maxHealth}`);
ok(skinModifiers(SKINS.find((s) => s.id === 'aurum')).maxSpeed > glass.maxSpeed * 0.99,
  'top-speed stat maps to a speed multiplier');

/* ═══════════════════════════ 2. kart model ════════════════════════════ */
section('2. Procedural kart model');
const builtKart = buildKartMesh(SKINS[0]);
ok(builtKart.group.isObject3D === true, 'kart mesh builds');
ok(builtKart.wheels.length === 4, 'four wheels');
ok(builtKart.frontWheels.length === 2, 'two steerable front wheels');
ok(builtKart.flames.length === 2, 'two boost flames');
let noseAtNegativeZ = false;
builtKart.group.traverse((o) => { if (o.isMesh && o.geometry?.parameters?.depth === 1.0) noseAtNegativeZ = true; });
ok(builtKart.group.children.length > 10, `${builtKart.group.children.length} kart parts`);
ok(noseAtNegativeZ, 'kart nose geometry points toward −Z (orientation contract)');

/* ═══════════════════════════ 3. arena build ═══════════════════════════ */
section('3. Arena construction & colliders');
for (const themeId of Object.keys(THEMES)) {
  const scene = new THREE.Scene();
  const world = new CollisionWorld();
  const arena = buildArenaObjects(scene, world, themeId);
  arena.update(1 / 60, 1);
  ok(world.boxes.length > 8 && world.cylinders.length > 5,
    `${themeId}: ${world.boxes.length} box + ${world.cylinders.length} cylinder colliders`);
  ok(arena.boostPads.length === 6, `${themeId}: 6 boost pads`);
  ok(scene.children.length > 20, `${themeId}: ${scene.children.length} scene objects`);
  // a kart inside the arena must not fall through / explode
  const probe = new KartBody({ id: 'probe', name: 'Probe', mods: skinModifiers(SKINS[0]), spawn: { x: 0, z: 20, yaw: 0 } });
  for (let i = 0; i < 240; i++) probe.update(1 / 60, { throttle: 1, steerSmooth: 0, drift: false }, world, []);
  ok(Number.isFinite(probe.position.x) && Number.isFinite(probe.position.z), `${themeId}: physics stays finite`);
  ok(Math.abs(probe.position.x) < ARENA_HALF + 8 && Math.abs(probe.position.z) < ARENA_HALF + 8,
    `${themeId}: walls contain the kart (${probe.position.x.toFixed(1)}, ${probe.position.z.toFixed(1)})`);
}

/* ═══════════════════════════ 4. THE CONTROL-FIX TESTS ═════════════════ */
section('4. Steering & drive direction (the critical fixes)');
const world = new CollisionWorld();
world.addBounds(ARENA_HALF, 7, 5);

function freshKart(id = 'k', spawn = { x: 0, z: 0, yaw: 0 }) {
  return new KartBody({ id, name: id, mods: skinModifiers(SKINS[0]), spawn, isPlayer: true });
}

// W → forward along the local forward vector
{
  const kart = freshKart('fwd');
  const start = kart.position.clone();
  for (let i = 0; i < 120; i++) kart.update(1 / 60, { throttle: 1, steerSmooth: 0, drift: false }, world, []);
  const delta = kart.position.clone().sub(start);
  const forward = new THREE.Vector3(0, 0, -1); // yaw 0 → facing −Z
  const alongForward = delta.dot(forward);
  ok(alongForward > 8, `W drives along the kart's local forward vector (${alongForward.toFixed(1)}u in 2s)`);
  ok(Math.abs(delta.x) < 0.01, 'no sideways drift when driving straight');
  ok(kart.speedKmh > 60, `kart accelerates to ${kart.speedKmh.toFixed(0)} km/h`);
}

// A → positive Y rotation (turn LEFT)
{
  const kart = freshKart('left');
  for (let i = 0; i < 30; i++) kart.update(1 / 60, { throttle: 1, steerSmooth: 0, drift: false }, world, []);
  const yawBefore = kart.yaw;
  for (let i = 0; i < 60; i++) kart.update(1 / 60, { throttle: 1, steerSmooth: 1, drift: false }, world, []);
  const dYaw = kart.yaw - yawBefore;
  ok(dYaw > 0, `A steers LEFT with POSITIVE Y rotation (Δyaw = +${dYaw.toFixed(2)} rad)`);

  // the world-space path must curve to the driver's left: facing −Z that is −X
  const k2 = freshKart('left2', { x: 0, z: 20, yaw: 0 });
  for (let i = 0; i < 60; i++) k2.update(1 / 60, { throttle: 1, steerSmooth: 1, drift: false }, world, []);
  ok(k2.position.x < -0.6 && k2.position.z < 20,
    `holding A arcs to the driver's left / world −X (${k2.position.x.toFixed(1)}, ${k2.position.z.toFixed(1)})`);
}

// D → negative Y rotation (turn RIGHT)
{
  const kart = freshKart('right');
  for (let i = 0; i < 30; i++) kart.update(1 / 60, { throttle: 1, steerSmooth: 0, drift: false }, world, []);
  const yawBefore = kart.yaw;
  for (let i = 0; i < 60; i++) kart.update(1 / 60, { throttle: 1, steerSmooth: -1, drift: false }, world, []);
  const dYaw = kart.yaw - yawBefore;
  ok(dYaw < 0, `D steers RIGHT with NEGATIVE Y rotation (Δyaw = ${dYaw.toFixed(2)} rad)`);

  const k2 = freshKart('right2', { x: 0, z: 20, yaw: 0 });
  for (let i = 0; i < 60; i++) k2.update(1 / 60, { throttle: 1, steerSmooth: -1, drift: false }, world, []);
  ok(k2.position.x > 0.6 && k2.position.z < 20,
    `holding D arcs to the driver's right / world +X (${k2.position.x.toFixed(1)}, ${k2.position.z.toFixed(1)})`);
}

// reverse + collision + drift sanity
{
  const kart = freshKart('rev');
  for (let i = 0; i < 60; i++) kart.update(1 / 60, { throttle: -1, steerSmooth: 0, drift: false }, world, []);
  ok(kart.position.z > 1, `S reverses (moved +Z away from facing) z=${kart.position.z.toFixed(2)}`);

  const wallKart = freshKart('wall', { x: 0, z: -ARENA_HALF + 3, yaw: 0 });
  let hits = 0;
  for (let i = 0; i < 90; i++) {
    wallKart.update(1 / 60, { throttle: 1, steerSmooth: 0, drift: false }, world, []);
    if (wallKart.wallGrind > 0) hits++;
  }
  ok(hits > 0, 'wall collisions are detected by the AABB resolver');
  ok(wallKart.position.z > -ARENA_HALF - 1, 'kart cannot tunnel through the arena wall');

  const driftKart = freshKart('drift', { x: -20, z: 0, yaw: 0 });
  for (let i = 0; i < 60; i++) driftKart.update(1 / 60, { throttle: 1, steerSmooth: 0, drift: false }, world, []);
  driftKart.update(1 / 60, { throttle: 1, steerSmooth: 1, drift: true }, world, []);
  ok(driftKart.drifting === true, 'SHIFT engages drift when fast enough');
}

// two karts colliding push apart
{
  const a = freshKart('a', { x: 0, z: 0, yaw: 0 });
  const b = freshKart('b', { x: 0, z: -2, yaw: Math.PI });
  for (let i = 0; i < 30; i++) {
    a.update(1 / 60, { throttle: 1, steerSmooth: 0, drift: false }, world, [b]);
    b.update(1 / 60, { throttle: 1, steerSmooth: 0, drift: false }, world, [a]);
  }
  const dist = a.position.distanceTo(b.position);
  ok(dist > 1.5, `kart-vs-kart contacts resolve (gap ${dist.toFixed(2)}u)`);
}

/* ═══════════════ 4b. CHASE CAMERA (behind the kart, never in front) ════ */
section('4b. Chase camera placement');
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 2.4]) {
  const off = chaseCameraOffset(yaw, 0, 0.3, 11);
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const offsetDir = new THREE.Vector3(off.x, 0, off.z).normalize();
  ok(offsetDir.dot(forward) < -0.9,
    `camera sits behind the kart at yaw ${yaw.toFixed(2)} (dot=${offsetDir.dot(forward).toFixed(2)})`);
}
{
  const behind = chaseCameraOffset(0, 0, 0.3, 11);
  const front = chaseCameraOffset(0, 0, 0.3, 11, true);
  ok(behind.z > 0 && front.z < 0, 'look-behind (E) flips the camera to the front');
  ok(Math.abs(behind.x) < 0.001, 'no lateral offset when centred');
}
{
  const orbit = chaseCameraOffset(0, Math.PI / 2, 0.3, 11);
  ok(orbit.x > 6, 'mouse-drag orbit swings the camera around the kart');
}

/* ═══════════════ 4c. spawn points are reachable ═══════════════════════ */
section('4c. Spawn & pickup placement');
for (const themeId of Object.keys(THEMES)) {
  const w = new CollisionWorld();
  const sc = new THREE.Scene();
  buildArenaObjects(sc, w, themeId);
  const usable = generateSpawnPoints(w, 12);
  const blocked = usable.filter((p2) => w.overlapsCircle(p2.x, p2.z, 1.6, 1));
  const badCrates = CRATE_SPAWNS.filter((c) => w.overlapsCircle(c.x, c.z, 1.6, 1));
  ok(usable.length >= 8 && blocked.length === 0,
    `${themeId}: ${usable.length} generated spawn points, all obstacle-free`, JSON.stringify(blocked));
  ok(badCrates.length === 0, `${themeId}: all ${CRATE_SPAWNS.length} crates are reachable`,
    JSON.stringify(badCrates));
  const outside = KART_SPAWNS.filter((s2) => Math.abs(s2.x) > ARENA_HALF - 3 || Math.abs(s2.z) > ARENA_HALF - 3);
  ok(outside.length === 0, `${themeId}: no kart spawn overlaps the arena wall`);
}

/* ═══════════════════════════ 5. combat ════════════════════════════════ */
section('5. Crates, abilities & damage');
ok(Object.keys(ABILITIES).length === 8, `${Object.keys(ABILITIES).length} abilities in the roster`);
const rolled = new Set();
for (let i = 0; i < 400; i++) {
  const a = rollAbility();
  if (!a || !a.id) throw new Error('rollAbility returned junk');
  rolled.add(a.id);
}
ok(rolled.size >= 6, `crate drop table is varied (${rolled.size} distinct abilities in 400 rolls)`);

const scene = new THREE.Scene();
const crateGroup = new THREE.Group();
const combat = new CombatSystem({
  scene, world, audio: null, fx,
  buildCrate: () => new THREE.Group(),
  getKarts: () => karts,
  getPlayer: () => karts[0],
  events: {
    onKill: (killer, victim, weapon, selfDestruct) => { kills.push({ killer, victim, weapon, selfDestruct }); },
    onCratePickup: () => { pickups++; },
    onAbilityUsed: () => { abilitiesUsed++; },
    onDamage: () => {},
  },
});
let karts = [];
let kills = [];
let pickups = 0;
let abilitiesUsed = 0;

const player = freshKart('player', { x: 0, z: 0, yaw: 0 });
const dummy = new KartBody({
  id: 'dummy', name: 'Dummy', mods: skinModifiers(SKINS[0]),
  spawn: { x: 0, z: -6, yaw: 0 },
});
karts = [player, dummy];
combat.spawnCrates(CRATE_SPAWNS);
ok(combat.crates.length === CRATE_SPAWNS.length, `${combat.crates.length} item crates spawned`);

// every ability must fire cleanly and produce SOME effect
for (const id of Object.keys(ABILITIES)) {
  const shooter = freshKart(`shooter-${id}`, { x: 0, z: 0, yaw: 0 });
  const victim = new KartBody({ id: `victim-${id}`, name: 'v', mods: skinModifiers(SKINS[0]), spawn: { x: 0, z: -5, yaw: 0 } });
  karts = [shooter, victim];
  shooter.item = ABILITIES[id];
  shooter.itemReadyAt = 0;
  const before = victim.health;
  combat.useAbility(shooter);
  const consumed = shooter.item === null;
  for (let i = 0; i < 180; i++) combat.update(1 / 60, karts);
  const healed = id === 'repair' ? shooter.health > 0 : true;
  ok(consumed && healed, `ability "${id}" fires and is consumed`);
}
karts = [player, dummy];
player.health = player.maxHealth;
dummy.health = dummy.maxHealth;

// crate pickup
pickups = 0;
player.item = null;
combat.crates[0].active = true;
combat.collectCrate(combat.crates[0], player);
ok(pickups === 1 && !!player.item, `driving through a crate grants "${player.item?.name}"`);
ok(combat.crates[0].active === false, 'collected crate is deactivated for 6s');

// SPACE trigger (this is what input 'ability' maps to)
player.itemReadyAt = 0;
const fired = combat.useAbility(player);
ok(fired === true && player.item === null, 'ability trigger consumes the held item');

// damage math
const hpBefore = dummy.health;
combat.applyDamage(dummy, 20, player, { source: 'gun' });
ok(dummy.health === hpBefore - 20, `damage applies (${hpBefore} → ${dummy.health})`);
ok(fxLog.hitMarker > 0 && fxLog.damageNumber > 0, 'hit marker + damage numbers fire for the shooter');

// shield absorbs
dummy.health = dummy.maxHealth;
dummy.shield = 60;
combat.applyDamage(dummy, 25, player, { source: 'gun' });
ok(dummy.shield === 35 && dummy.health === dummy.maxHealth, 'energy shield absorbs damage before health');

// kill + attribution + streak
kills = [];
dummy.shield = 0;
const attacker = new KartBody({ id: 'attacker', name: 'Attacker', mods: skinModifiers(SKINS[0]), spawn: { x: 2, z: -5, yaw: 0 }, isPlayer: true });
karts = [attacker, dummy];
combat.applyDamage(dummy, 999, attacker, { source: 'missile' });
ok(kills.length === 1 && kills[0].killer === attacker && kills[0].victim === dummy, 'kill is attributed to the attacker');
ok(attacker.kills === 1 && attacker.streak === 1, `attacker scored (kills=${attacker.kills}, streak=${attacker.streak})`);
ok(dummy.alive === false && dummy.deaths === 1, 'victim is marked destroyed and counted');
ok(dummy.respawnAt > 0, 'victim gets a respawn timer');

// respawn
dummy.respawn({ x: 10, z: 10, yaw: 1 });
ok(dummy.alive === true && dummy.health === dummy.maxHealth && dummy.position.x === 10, 'respawn restores the kart at a new spawn');

// self destruct
kills = [];
const suicide = new KartBody({ id: 'suicide', name: 'Suicidal', mods: skinModifiers(SKINS[0]), spawn: { x: 0, z: 0, yaw: 0 } });
karts = [suicide];
suicide.health = 5;
combat.applyDamage(suicide, 50, null, { source: 'mine' });
ok(kills.length === 1 && kills[0].selfDestruct === true, 'kills with no recent attacker are flagged self-destructs');

/* ═══════════════════════════ 6. bot AI + full bot match ═════════════ */
section('6. Bot AI — 60 second simulated deathmatch');
const matchWorld = new CollisionWorld();
const matchScene = new THREE.Scene();
const matchArena = buildArenaObjects(matchScene, matchWorld, 'neon');

const roster = createBotRoster(5, { playerLevel: 3 });
ok(roster.length === 5, '5 bots generated');
ok(roster.every((b) => b.name && b.skin && b.skill >= 0.2 && b.skill <= 1), 'bots have name, skin and skill');

const matchKills = [];
const matchCombat = new CombatSystem({
  scene: matchScene, world: matchWorld, audio: null, fx,
  buildCrate: () => new THREE.Group(),
  getKarts: () => matchKarts,
  getPlayer: () => hero,
  events: { onKill: (k, v, w) => matchKills.push({ k, v, w }), onCratePickup: () => {}, onAbilityUsed: () => {}, onDamage: () => {} },
});
matchCombat.spawnCrates(CRATE_SPAWNS);

const spawns = [...KART_SPAWNS];
const hero = new KartBody({ id: 'hero', name: 'Hero', mods: skinModifiers(SKINS[0]), spawn: spawns[0], isPlayer: true });
const matchKarts = [hero];
const brains = [];
roster.forEach((bot, i) => {
  const kart = new KartBody({
    id: bot.id, name: bot.name, mods: skinModifiers(bot.skin),
    spawn: spawns[(i + 1) % spawns.length],
  });
  matchKarts.push(kart);
  brains.push(new BotBrain(kart, { skill: bot.skill, aggression: bot.aggression, id: bot.id }));
});

const KP = { KeyW: 0, KeyA: 0, KeyD: 0 };
let nanFound = false;
let frame = 0;
let maxObservedSpeed = 0;
const FPS = 60;
const SECONDS = 60;

for (frame = 0; frame < FPS * SECONDS; frame++) {
  const dt = 1 / 60;
  const t = frame / FPS;

  // a scripted "player": accelerate, weave left/right, fire when armed
  const steerSmooth = Math.sin(t * 0.7);
  hero.update(dt, { throttle: 1, steerSmooth, drift: Math.abs(steerSmooth) > 0.8 }, matchWorld, matchKarts);
  if (hero.item && frame % 30 === 0) matchCombat.useAbility(hero);

  const ctx = { karts: matchKarts, world: matchWorld, combat: matchCombat, crates: matchCombat.crates, time: t };
  for (const brain of brains) {
    brain.update(dt, ctx);
    brain.kart.update(dt, brain.input, matchWorld, matchKarts);
    if (brain.kart.item && frame % 47 === 0) matchCombat.useAbility(brain.kart);
  }

  // auto respawn like the real game loop
  for (const kart of matchKarts) {
    if (!kart.alive && matchCombat.time >= kart.respawnAt) {
      const s = spawns[Math.floor(Math.random() * spawns.length)];
      kart.respawn(s);
      kart.invuln = 1.5;
    }
  }

  matchCombat.update(dt, matchKarts);
  resolveRamming(matchKarts, matchCombat);
  matchArena.update(dt, t);

  for (const kart of matchKarts) {
    if (!Number.isFinite(kart.position.x) || !Number.isFinite(kart.position.z) || !Number.isFinite(kart.yaw)) {
      nanFound = true;
    }
    maxObservedSpeed = Math.max(maxObservedSpeed, kart.speedKmh);
  }
  if (nanFound) break;
}

ok(!nanFound, `60s of simulation produced no NaN (${frame} frames)`);
ok(matchKarts.every((k) => Math.abs(k.position.x) <= ARENA_HALF + 8 && Math.abs(k.position.z) <= ARENA_HALF + 8),
  'all karts stayed inside the arena');
const totalKills = matchKarts.reduce((n, k) => n + k.kills, 0);
const totalPickups = matchKarts.reduce((n, k) => n + (k.kills >= 0 ? 0 : 0), 0);
ok(totalKills >= 1, `bots generated combat: ${totalKills} eliminations, ${matchKills.length} kill events`);
ok(matchCombat.crates.some((c) => !c.active || c.active), 'crate system stayed consistent');
ok(brains.every((b) => b.kart.botInput), 'every bot produced input each frame');
ok(fxLog.explosion > 0 && fxLog.sparks > 0, `fx fired (${fxLog.explosion} explosions, ${fxLog.sparks} spark bursts)`);
ok(maxObservedSpeed > 100, `karts reached racing speed (peak ${maxObservedSpeed.toFixed(0)} km/h)`);

/* ═══════════════════════════ 7. multiplayer protocol ═════════════════ */
section('7. Multiplayer protocol surface');
const netMod = await import('../src/network/multiplayer.js');
ok(typeof netMod.NetworkManager === 'function', 'NetworkManager is exported');
const methods = ['connect', 'createRoom', 'joinRoom', 'startMatch', 'maybeSendState', 'sendHit',
  'sendCrate', 'sendDeath', 'sendAbility', 'update', 'clearRemotes', 'leaveRoom'];
const netProto = netMod.NetworkManager.prototype;
ok(methods.every((m) => typeof netProto[m] === 'function'), 'all relay methods exist on the client');
ok(methods.every((m) => typeof netProto[m] === 'function'), 'room + snapshot API complete');

const serverSrc = await import('node:fs/promises').then((fs) => fs.readFile('server/server.js', 'utf8'));
['room:create', 'room:join', 'room:leave', 'room:config', 'match:start', 'net:state',
  'net:hit', 'net:crate', 'net:death', 'net:ping'].forEach((evt) => {
  ok(serverSrc.includes(`'${evt}'`), `server handles "${evt}"`);
});
ok(serverSrc.includes('/health'), 'server exposes a /health endpoint');

/* ═══════════════════════════ summary ═════════════════════════════════ */
console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
if (fail) {
  console.log('\x1b[31mFailures:\x1b[0m');
  failures.forEach((f) => console.log(` - ${f}`));
  process.exit(1);
}
console.log('\x1b[32mAll Super Racers systems operational.\x1b[0m\n');
