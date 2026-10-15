/**
 * Super Racers — Game-loop integration test (the "no more frozen match" suite).
 *
 * This is the test that would have caught the arena freeze: it boots the *real*
 * entry point (`src/main.js`) against the real `index.html` inside jsdom with a
 * stubbed WebGL context, then drives the real render loop frame by frame and
 * presses real keys on `window`.
 *
 * It asserts the full hotfix contract:
 *   1. the loop never throws — one bad frame cannot freeze the match
 *   2. delta time is capped (a 3-second spike produces no NaN, no teleport)
 *   3. 6 karts (player + 5 bots) spawn with finite positions and 100 HP
 *   4. the match state machine runs 3…2…1…GO! → PLAYING
 *   5. the HUD clock starts at 3:00 and ticks down 3:00 → 2:59 → …
 *   6. W / S / A / D / SPACE drive and fire from global window key listeners
 *   7. the engine FX API (sparks / smoke / explosions) is callable — the exact
 *      regression that used to abort the frame right before the HUD + render
 *
 * Run:  node scripts/loop-test.js
 */

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let pass = 0;
let fail = 0;
const failures = [];
function ok(condition, label, detail = '') {
  if (condition) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; failures.push(label); console.log(`  \x1b[31m✗ ${label}\x1b[0m ${detail}`); }
}
const section = (n) => console.log(`\n\x1b[1m${n}\x1b[0m`);

/* ═══════════════════════════════════════════════════════════════════════════
   1. FAKE WEBGL CONTEXT — three.js runs, nothing is actually drawn
   ═══════════════════════════════════════════════════════════════════════════ */
function makeFakeGL() {
  let id = 0;
  const consts = new Map();
  const enumFor = (k) => {
    if (!consts.has(k)) consts.set(k, 0x1000 + (consts.size + 1));
    return consts.get(k);
  };
  const real = {
    canvas: null,
    drawingBufferWidth: 1280, drawingBufferHeight: 720,
    getContextAttributes: () => ({
      alpha: true, depth: true, stencil: false, antialias: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default',
    }),
    getExtension: () => null,
    getSupportedExtensions: () => [],
    getParameter: (p) => {
      if (p === consts.get('VERSION')) return 'WebGL 2.0 (stub)';
      if (p === consts.get('SHADING_LANGUAGE_VERSION')) return 'WebGL GLSL ES 3.00 (stub)';
      if (p === consts.get('VENDOR') || p === consts.get('RENDERER')) return 'stub';
      return 8;
    },
    getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
    createShader: () => ({ __shader: ++id }),
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => ({ __program: ++id }),
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    createBuffer: () => ({ __buffer: ++id }),
    createTexture: () => ({ __texture: ++id }),
    createFramebuffer: () => ({ __framebuffer: ++id }),
    createRenderbuffer: () => ({ __renderbuffer: ++id }),
    createVertexArray: () => ({ __vao: ++id }),
    getUniformLocation: () => ({ __location: ++id }),
    getAttribLocation: () => 0,
    getActiveUniform: () => ({ name: 'uStub', type: enumFor('FLOAT'), size: 1 }),
    getActiveAttrib: () => ({ name: 'aStub', type: enumFor('FLOAT'), size: 1 }),
    checkFramebufferStatus: () => enumFor('FRAMEBUFFER_COMPLETE'),
  };
  return new Proxy(real, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === 'string' && /^[A-Z][A-Z0-9_]*$/.test(key)) return enumFor(key);
      const fn = () => undefined;
      target[key] = fn;
      return fn;
    },
    set(t, k, v) { t[k] = v; return true; },
    has: () => true,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. BOOT THE REAL GAME IN JSDOM
   ═══════════════════════════════════════════════════════════════════════════ */
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:5173/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

const gl = makeFakeGL();
const fake2d = new Proxy({}, {
  get(target, key) {
    if (key in target) return target[key];
    const fn = () => (String(key).startsWith('create') ? { addColorStop() {} } : undefined);
    target[key] = fn;
    return fn;
  },
  set(t, k, v) { t[k] = v; return true; },
});
window.HTMLCanvasElement.prototype.getContext = function getContext(type) {
  if (type === 'webgl2' || type === 'webgl') return gl;
  return fake2d;
};
window.AudioContext = undefined;          // no Web Audio in jsdom — must be optional
window.webkitAudioContext = undefined;

/* manual requestAnimationFrame pump: the test owns the frame clock */
const raf = { pending: null, scheduled: 0 };
window.requestAnimationFrame = (fn) => { raf.pending = fn; raf.scheduled++; return raf.scheduled; };
window.cancelAnimationFrame = () => {};

globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.localStorage = window.localStorage;
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
globalThis.HTMLElement = window.HTMLElement;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
globalThis.self = window;

/* record everything the page logs as an error — a frame error must show up here */
const consoleErrors = [];
const realConsoleError = console.error;
console.error = (...args) => { consoleErrors.push(args.map(String).join(' ')); };

dom.window.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
await import('../src/main.js');

const game = window.__SUPER_RACERS__;
const $ = (id) => window.document.getElementById(id);

ok(!!game, 'src/main.js boots and exposes window.__SUPER_RACERS__');
ok(!!game.engine?.renderer, 'Engine built a (stubbed) WebGL renderer');

const STEP = 1 / 60;
game.clock.getDelta = () => STEP;                    // deterministic 60 fps
const step = (n = 1) => {
  for (let i = 0; i < n; i++) {
    const fn = raf.pending;
    raf.pending = null;
    if (!fn) throw new Error('the render loop stopped scheduling frames');
    fn();
  }
};
const keyDown = (code) => window.dispatchEvent(new window.KeyboardEvent('keydown', { code, bubbles: true }));
const setBotsIdle = (idle) => {
  game.entries.forEach((e) => { if (e.brain) e.brainBroken = idle; });
};
const keyUp = (code) => window.dispatchEvent(new window.KeyboardEvent('keyup', { code, bubbles: true }));
const tapKey = (code, frames = 2) => { keyDown(code); step(frames); keyUp(code); };

/* `precision` guard: the loop must own the frame, so prime it like start() does */
game.clock.getDelta = () => STEP;
game.menu.hide();
game.loop();
step(3);
ok(raf.scheduled > 3, `the render loop reschedules itself (${raf.scheduled} frames queued)`);

/* ═══════════════ 3. STARTING: 6 karts, 100 HP, 3…2…1…GO! ═══════════════ */
section('1. Match start — kart & bot initialisation');

const errorsBeforeMatch = consoleErrors.length;
game.startLocalMatch({ mode: 'deathmatch', bots: 5, target: 15, arena: 'neon' });

ok(game.entries.length === 6, `6 karts spawn (player + 5 bots) — got ${game.entries.length}`);
ok(game.mode === 'match', 'the game left the menu and entered the match');
ok(game.match.state === 'starting', 'the match opens in STATE.STARTING (countdown phase)');

const allKarts = game.entries.map((e) => e.kart);
const finiteStart = allKarts.every((k) => (
  Number.isFinite(k.position.x) && Number.isFinite(k.position.y) && Number.isFinite(k.position.z)
  && Number.isFinite(k.yaw) && Number.isFinite(k.velocity.x) && Number.isFinite(k.velocity.z)
));
ok(finiteStart, 'every kart has a finite (x, y, z) spawn before the first physics step');
ok(allKarts.every((k) => k.alive === true), 'every kart starts alive');
const { KartBody, DEFAULT_HEALTH } = await import('../src/game/physics.js');
ok(DEFAULT_HEALTH === 100, `the baseline hp is 100 (${DEFAULT_HEALTH})`);
ok(new KartBody({ id: 'probe', name: 'Probe' }).health === 100, 'a default kart spawns with hp = 100');
ok(allKarts.every((k) => Number.isFinite(k.health) && k.health > 0 && k.health === k.maxHealth && k.health >= 80),
  `every kart starts on valid, full health (${allKarts.map((k) => Math.round(k.health)).join('/')})`);
ok(allKarts.filter((k) => k.isPlayer).length === 1, 'exactly one kart is the player');
ok(game.entries.filter((e) => e.isBot && e.brain).length === 5, 'all 5 bots have a BotBrain attached');
ok(game.playerEntry && game.playerEntry.kart === allKarts.find((k) => k.isPlayer), 'playerEntry points at the player kart');

const spawnDistinct = new Set(allKarts.map((k) => `${k.position.x.toFixed(1)}:${k.position.z.toFixed(1)}`));
ok(spawnDistinct.size === 6, `all 6 karts spawn at distinct positions (${spawnDistinct.size})`);

/* countdown text + frozen karts */
const countdownSeen = new Set();
const goSeen = { value: false };
const watchCountdown = () => {
  const el = $('cd-text');
  if (!$('countdown').classList.contains('hidden')) {
    countdownSeen.add(el.textContent);
    if (el.textContent === 'GO!') goSeen.value = true;
  }
};
const frozenStart = allKarts.map((k) => k.position.clone());
for (let i = 0; i < 30; i++) { step(1); watchCountdown(); }
ok(countdownSeen.has('3'), `countdown shows "3" on screen (saw ${[...countdownSeen].join(', ')})`);
ok(allKarts.every((k, i) => k.position.distanceTo(frozenStart[i]) < 0.001),
  'karts are frozen during the countdown (no physics before GO!)');

/* ═══════════════ 4. PLAYING + the 3:00 match clock ═══════════════ */
section('2. Match clock — 3:00 ticking down in the HUD');

ok($('hud-timer').textContent === '3:00', `timer box reads 3:00 at match start (${$('hud-timer').textContent})`);
ok($('hud-mode-name').textContent === 'NEON DEATHMATCH', 'top-centre box still labels the mode');

while (game.match.state === 'starting' && game.state.playingFor === 0) {
  step(1);
  watchCountdown();
  if (game.frame > 4000) break;
}
ok(goSeen.value, 'countdown reaches "GO!"');
ok(game.match.state === 'playing', 'STATE.STARTING hands over to STATE.PLAYING');
ok(game.state.timeLeft > 179 && game.state.timeLeft <= 180,
  `the 3-minute clock starts at 180 s (${game.state.timeLeft.toFixed(2)} s)`);

const timerAfterStart = $('hud-timer').textContent;
ok(timerAfterStart === '3:00', `clock still reads 3:00 in the first second of play (${timerAfterStart})`);

step(60);                                     // one full second of play
ok($('hud-timer').textContent === '2:59', `clock ticks 3:00 → 2:59 (${$('hud-timer').textContent})`);
step(60);
ok($('hud-timer').textContent === '2:58', `and keeps counting down (${$('hud-timer').textContent})`);
step(120);
ok($('hud-timer').textContent === '2:56', `clock advances one second per second (${$('hud-timer').textContent})`);

/* ═══════════════ 5. CONTROLS — global window listeners ═══════════════ */
section('3. Controls — W A S D SPACE from window key listeners');

const player = game.playerEntry.kart;
setBotsIdle(true);            // measure the player on an empty track
const resetKart = (spawn = { x: 0, z: 0, yaw: 0 }) => {
  player.position.set(spawn.x, 0, spawn.z);
  player.velocity.set(0, 0, 0);
  player.yaw = spawn.yaw;
  player.steer = 0;
  game.input.steerSmoothed = 0;
  game.input.clearAll();
};
// open floor in the middle of the arena, away from obstacles
const OPEN = { x: 0, z: 22, yaw: 0 };

resetKart(OPEN);
const startPos = player.position.clone();
const forwardAtStart = player.getWorldDirection().clone();
ok(typeof player.getWorldDirection === 'function', 'kart exposes getWorldDirection()');
keyDown('KeyW');
let peakSpeed = 0;
for (let i = 0; i < 45; i++) { step(1); peakSpeed = Math.max(peakSpeed, player.speedKmh); }
keyUp('KeyW');
const displacement = player.position.clone().sub(startPos);
ok(peakSpeed > 40, `W accelerates the kart (peak ${peakSpeed.toFixed(0)} km/h in 0.75 s)`);
ok(displacement.length() > 3, `W moves the kart along its own heading (${displacement.length().toFixed(1)} u)`);
ok(displacement.clone().normalize().dot(forwardAtStart) > 0.9,
  'the drive vector follows kart.getWorldDirection()');

/* A / D steering */
resetKart(OPEN);
keyDown('KeyW');
step(30);
const yawBeforeA = player.yaw;
keyDown('KeyA');
step(45);
const yawAfterA = player.yaw;
keyUp('KeyA');
ok(yawAfterA > yawBeforeA + 0.15, `A turns left: yaw INCREASES (Δ${(yawAfterA - yawBeforeA).toFixed(2)} rad)`);
keyDown('KeyD');
const yawBeforeD = player.yaw;
step(45);
const yawAfterD = player.yaw;
keyUp('KeyD');
keyUp('KeyW');
ok(yawAfterD < yawBeforeD - 0.15, `D turns right: yaw DECREASES (Δ${(yawAfterD - yawBeforeD).toFixed(2)} rad)`);

/* S reverses */
resetKart(OPEN);
keyDown('KeyS');
step(60);
keyUp('KeyS');
ok(player.position.z > OPEN.z + 2, `S reverses away from the kart's nose (z ${OPEN.z} → ${player.position.z.toFixed(1)})`);

/* Arrow keys mirror WASD */
resetKart(OPEN);
keyDown('ArrowUp');
step(45);
const arrowSpeed = player.speedKmh;
keyUp('ArrowUp');
ok(arrowSpeed > 20, `arrow keys are mapped too (↑ → ${arrowSpeed.toFixed(0)} km/h)`);

/* SPACE fires the held ability */
resetKart(OPEN);
const { ABILITIES } = await import('../src/game/combat.js');
player.item = ABILITIES.boost;
player.itemReadyAt = 0;
keyDown('Space');
step(1);
keyUp('Space');
ok(player.item === null, 'SPACE (window keydown) fires and consumes the held ability');
ok(player.boostTimer > 0, `the fired ability actually applied (boost ${player.boostTimer.toFixed(1)} s)`);

/* ═══════════════ 6. THE FREEZE REGRESSION ═══════════════ */
section('4. FX interface — the exact crash that froze the match');

const fxErrors = [];
const fxProbe = (name, fn) => {
  try { fn(); } catch (err) { fxErrors.push(`${name}: ${err.message}`); }
};
fxProbe('engine.sparks', () => game.engine.sparks(player.position.clone().setY(1), { count: 8 }));
fxProbe('engine.smoke', () => game.engine.smoke(player.position.clone().setY(1), { count: 4 }));
fxProbe('engine.explosion', () => game.engine.explosion(player.position.clone().setY(1), { color: 0xffa040, scale: 1 }));
fxProbe('engine.boostBurst', () => game.engine.boostBurst(player));
fxProbe('engine.shieldUp', () => game.engine.shieldUp(player));
fxProbe('engine.shieldHit', () => game.engine.shieldHit(player.position.clone().setY(1)));
fxProbe('engine.muzzleFlash', () => game.engine.muzzleFlash(player.position.clone(), player.getWorldDirection().clone(), 0xffffff));
fxProbe('engine.shockRing', () => game.engine.shockRing(player.position.clone()));
fxProbe('engine.kartExplosion', () => game.engine.kartExplosion(player));
fxProbe('engine.buildMine', () => game.engine.buildMine(0xffc23d));
fxProbe('engine.buildMissile', () => game.engine.buildMissile(0xff7a1a));
ok(fxErrors.length === 0, 'every engine FX method is callable (sparks/smoke/explosions/projectiles)', fxErrors.join(' | '));
ok(typeof game.engine.sparks === 'function' && typeof game.engine.smoke === 'function',
  'engine.sparks / engine.smoke stay functions (particle pools must not shadow them)');

/* crate pickup + wall scrape go through the same FX path as the arena */
const crateBefore = game.combat.crates.filter((c) => c.active).length;
fxProbe('crate pickup', () => {
  const crate = game.combat.crates.find((c) => c.active);
  crate.x = player.position.x;
  crate.z = player.position.z;
  game.combat.collectCrate(crate, player);
});
fxProbe('wall scrape', () => { player.wallGrind = 1; game.syncVisual(game.playerEntry, STEP); });
ok(fxErrors.length === 0, 'crate pickups and wall sparks run without throwing', fxErrors.join(' | '));
ok(game.combat.crates.filter((c) => c.active).length < crateBefore || !!player.item,
  'the crate pickup actually resolved');

/* ═══════════════ 7. LIVE DRIVING — no frame errors, no NaN ═══════════════ */
section('5. 20 seconds of live driving — the loop never freezes');

const framesAtStart = game.frame;
setBotsIdle(false);           // let the full 6-kart deathmatch run again
resetKart(OPEN);
keyDown('KeyW');
keyDown('Space');
let sawDrift = false;
for (let i = 0; i < 60 * 20; i++) {
  if (i % 90 === 0) { keyDown('KeyA'); }
  if (i % 90 === 45) { keyUp('KeyA'); keyDown('KeyD'); }
  if (i % 90 === 89) { keyUp('KeyD'); }
  step(1);
  if (player.drifting) sawDrift = true;
  const bad = game.entries.some((e) => (
    !Number.isFinite(e.kart.position.x) || !Number.isFinite(e.kart.position.z)
    || !Number.isFinite(e.kart.yaw) || !Number.isFinite(e.kart.health)
  ));
  if (bad) break;
}
keyUp('KeyW');
keyUp('Space');
keyUp('KeyA');
keyUp('KeyD');

const drivenFrames = game.frame - framesAtStart;
ok(drivenFrames >= 60 * 20, `the loop kept running all ${drivenFrames} frames (no freeze)`);
ok(consoleErrors.length === errorsBeforeMatch, 'no frame errors were logged while driving',
  consoleErrors.slice(errorsBeforeMatch).join(' | '));
ok(game.frameErrors === 0, `game.frameErrors stayed 0 (${game.frameErrors})`);
ok(game.entries.every((e) => Number.isFinite(e.kart.position.x) && Number.isFinite(e.kart.position.z)),
  'no kart hit NaN during 20 s of racing');
ok(game.entries.every((e) => Math.abs(e.kart.position.x) <= 56 && Math.abs(e.kart.position.z) <= 56),
  'every kart stayed inside the arena walls');
ok(game.entries.filter((e) => e.local && e.isBot).every((e) => e.kart.botInput || e.brainBroken === true),
  'every local bot produced driving input without crashing');
ok(game.entries.every((e) => !e.brainBroken), 'no bot brain had to be halted');
ok(sawDrift || player.speedKmh > 0, `the kart actually drove around (${player.speedKmh.toFixed(0)} km/h, drift seen: ${sawDrift})`);
ok(game.combat.time > 15, `the combat system advanced with the clock (${game.combat.time.toFixed(1)} s)`);
ok(game.state.timeLeft < 180 - 18, `the match clock kept ticking during play (${game.state.timeLeft.toFixed(1)} s left)`);

/* ═══════════════ 8. DELTA SPIKE SAFETY ═══════════════ */
section('6. Delta-time spikes — capped at 0.1 s');

const posBeforeSpike = player.position.clone();
const realGetDelta = game.clock.getDelta;
game.clock.getDelta = () => 5.0;              // a 5-second GC pause / tab switch
step(1);
game.clock.getDelta = realGetDelta;
const spikeTravel = player.position.distanceTo(posBeforeSpike);
ok(game.frameErrors === 0, 'a 5-second frame gap does not throw');
ok(Number.isFinite(player.position.x) && Number.isFinite(player.speed),
  `no NaN after the spike (speed ${player.speed.toFixed(1)})`);
ok(spikeTravel < 12, `the kart cannot teleport on a huge delta (moved ${spikeTravel.toFixed(2)} u)`);
ok(game.match.state === 'playing' || game.match.state === 'over', 'the match state survived the spike');

/* ═══════════════ 9. MATCH END + REMATCH ═══════════════ */
section('7. Time-up → results → rematch');

game.state.timeLeft = 1.5;
step(120);
ok(game.match.state === 'over', 'the clock running out ends the match');
ok($('hud-timer').textContent === '0:00' || game.state.timeLeft === 0, 'the clock bottoms out cleanly');
game.state.timeLeft = 0;
step(5);
ok(game.frameErrors === 0, 'the match-end path runs without frame errors');

await new Promise((r) => setTimeout(r, 1100));   // results screen has a 900 ms delay
step(3);
ok(game.mode === 'results', `the results screen takes over (mode: ${game.mode})`);
ok(!$('results-screen').classList.contains('hidden'), 'the results panel is visible');

game.rematch();
step(5);
ok(game.entries.length === 6, `rematch rebuilds all 6 karts (${game.entries.length})`);
ok(game.match.state === 'starting', 'the rematch starts with a fresh countdown');
ok(game.state.timeLeft === 180, `the rematch resets the clock to 3:00 (${game.state.timeLeft} s)`);
ok($('hud-timer').textContent === '3:00', `HUD clock shows 3:00 again (${$('hud-timer').textContent})`);
step(60 * 8);
ok(game.match.state === 'playing' && game.frameErrors === 0,
  `the second match reaches PLAYING with no frame errors (${game.match.state})`);

/* ═══════════════ 10. MatchStateManager unit contract ═══════════════ */
section('8. MatchStateManager');

const { MatchStateManager, MATCH_STATE, formatClock, matchDurationFor, COUNTDOWN_SECONDS, MATCH_SECONDS } =
  await import('../src/game/match-state.js');

ok(MATCH_SECONDS === 180, `the deathmatch clock is 3 minutes (${MATCH_SECONDS} s)`);
ok(formatClock(180) === '3:00' && formatClock(179.9) === '3:00' && formatClock(179) === '2:59'
  && formatClock(5) === '0:05' && formatClock(0.4) === '0:01' && formatClock(0) === '0:00'
  && formatClock(NaN) === '0:00',
  `formatClock renders a countdown mm:ss (${formatClock(180)} / ${formatClock(179.9)} / ${formatClock(179)} / ${formatClock(0)})`);
ok(matchDurationFor({ mode: 'deathmatch', target: 15 }) === 180
  && matchDurationFor({ mode: 'koth' }) === 180
  && matchDurationFor({ target: 'time' }) === 300, 'matchDurationFor picks the right clock per mode');

const ticks = [];
const seconds = [];
const mgr = new MatchStateManager({
  duration: 180, countdown: COUNTDOWN_SECONDS,
  onCountdown: (t) => ticks.push(t),
  onSecond: (s, text) => seconds.push(text),
  onStart: () => { /* noop */ },
});
ok(mgr.state === MATCH_STATE.STARTING, 'a fresh match state is STARTING');
for (let i = 0; i < 60 * 7; i++) mgr.update(1 / 60);
ok(ticks.slice(0, 4).join(',') === '3,2,1,GO!', `countdown fires 3,2,1,GO! (${ticks.slice(0, 4).join(',')})`);
ok(mgr.state === MATCH_STATE.PLAYING, 'STARTING → PLAYING after the countdown');
ok(seconds.length >= 3 && seconds.slice(0, 3).join(',') === '2:59,2:58,2:57',
  `onSecond ticks once per second (${seconds.slice(0, 4).join(', ')})`);
ok(mgr.timeLeft > 175.5 && mgr.timeLeft < 177.5, `180 s clock is ~4 s down after 4 s of play (${mgr.timeLeft.toFixed(2)} s)`);

const before = mgr.timeLeft;
mgr.update(NaN);
mgr.update(undefined);
mgr.update(60);                        // a huge delta is clamped to 0.1 s
ok(mgr.timeLeft < before && before - mgr.timeLeft <= 0.11,
  `absurd deltas are clamped, not integrated (${(before - mgr.timeLeft).toFixed(3)} s)`);
ok(Number.isFinite(mgr.timeLeft), 'the clock never becomes NaN');

let timeUps = 0;
const fin = new MatchStateManager({ duration: 1, countdown: 0, onTimeUp: () => { timeUps++; } });
fin.skipToPlaying();
for (let i = 0; i < 12; i++) fin.update(0.1);   // 1.2 s requested → 12 steps clamped to 0.1 s each
ok(fin.state === MATCH_STATE.OVER && fin.timeLeft === 0, 'the clock reaches OVER exactly at 0:00');
ok(timeUps === 1, `time-up fires exactly once (${timeUps})`);
fin.update(1);
ok(timeUps === 1 && fin.timeLeft === 0, 'an ended match never ticks again');

/* ═══════════════ summary ═══════════════ */
console.error = realConsoleError;
if (consoleErrors.length) {
  console.log(`\n\x1b[33m${consoleErrors.length} console.error message(s) were captured during the run:\x1b[0m`);
  consoleErrors.slice(0, 8).forEach((m) => console.log(` - ${m.split('\n')[0]}`));
}
console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
if (fail) {
  console.log('\x1b[31mFailures:\x1b[0m');
  failures.forEach((f) => console.log(` - ${f}`));
  process.exit(1);
}
console.log('\x1b[32mThe match loop runs, the clock counts down and the karts drive.\x1b[0m\n');
process.exit(0);
