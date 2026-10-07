/**
 * Super Racers — UI integration test.
 *
 * Loads the real index.html into jsdom and drives the real menu/HUD controllers
 * against it. This catches the failure mode a headless logic test cannot see:
 * element ids that don't exist, missing handlers, broken DOM updates.
 *
 * Run:  node scripts/ui-test.js
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

/* ── boot jsdom with the real markup ───────────────────────────────────── */
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:5173/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

// canvas has no 2d context in jsdom — stub one so the HUD speedo can draw
const fakeCtx = new Proxy({}, {
  get(target, key) {
    if (key in target) return target[key];
    const fn = (...a) => (String(key).startsWith('create') ? { addColorStop() {} } : undefined);
    target[key] = fn;
    return fn;
  },
  set(target, key, value) { target[key] = value; return true; },
});
window.HTMLCanvasElement.prototype.getContext = () => fakeCtx;
window.prompt = () => 'SR-4821';
window.confirm = () => true;
globalThis.prompt = window.prompt;
globalThis.confirm = window.confirm;
window.navigator.clipboard = { writeText: async () => {} };

globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.localStorage = window.localStorage;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
globalThis.HTMLElement = window.HTMLElement;

const { ProfileManager, SKINS } = await import('../src/ui/profile.js');
const { SoundSystem } = await import('../src/game/audio.js');
const { HUD } = await import('../src/ui/hud.js');
const { MenuUI } = await import('../src/ui/menu.js');

const $ = (id) => window.document.getElementById(id);

/* ═══════════════ 1. markup contract ═══════════════ */
section('1. index.html contract');

const REQUIRED_IDS = [
  // boot + menu
  'boot', 'boot-bar-fill', 'boot-status', 'boot-start', 'boot-hint', 'menu-root', 'menu-screen',
  'skin-list', 'skin-class-label', 'username-input', 'pc-level', 'pc-xp', 'pc-xp-fill', 'pc-kills',
  'pc-wins', 'pc-races', 'sound-icon', 'net-dot', 'net-label', 'btn-play', 'btn-create-room',
  'btn-join-room', 'seg-mode', 'seg-bots', 'seg-score', 'seg-arena', 'seg-quality', 'btn-settings',
  'btn-controls', 'btn-profile', 'btn-fullscreen', 'btn-sound', 'btn-reset-profile', 'modal-layer',
  'modal-settings', 'modal-controls', 'modal-profile', 'toast-stack', 'set-volume', 'lbl-volume',
  'set-music', 'lbl-music', 'set-shake', 'lbl-shake', 'set-sens', 'lbl-sens', 'set-inverty',
  'set-dmgnum', 'set-bloom', 'set-server', 'prof-level', 'prof-name', 'btn-save-profile',
  // lobby + results
  'lobby-screen', 'lobby-list', 'lobby-count', 'room-code', 'lobby-status', 'btn-lobby-start',
  'btn-lobby-leave', 'btn-lobby-close', 'btn-copy-code', 'lobby-seg-mode', 'lobby-seg-bots',
  'results-screen', 'results-list', 'results-title', 'results-sub', 'results-reward',
  'btn-rematch', 'btn-results-menu',
  // in-game HUD
  'hud-root', 'hud-score', 'hud-timer', 'hud-mode-name', 'hud-leader', 'hud-alive', 'kill-feed',
  'hit-marker', 'kill-marker', 'dmg-dirs', 'dmg-numbers', 'status-effects', 'health-fill',
  'health-ghost', 'health-text', 'shield-bar', 'shield-fill', 'speedo-canvas', 'speed-value',
  'speed-gear', 'ability-slot', 'ability-ring-fill', 'ability-icon', 'ability-name', 'ability-ready',
  'hud-hint', 'scoreboard', 'sb-body', 'sb-title', 'sb-sub', 'death-overlay', 'death-by',
  'respawn-count', 'countdown', 'cd-text', 'cd-sub', 'banner', 'boost-indicator', 'boost-fill',
  // fx + pause
  'viewport', 'fx-damage', 'fx-flash', 'fx-boost', 'fx-fade', 'fx-speedlines', 'fx-vignette',
  'fx-scanlines', 'pause-root', 'btn-resume', 'btn-quit', 'btn-pause-settings', 'btn-pause-controls',
  'pause-score', 'viewport',
];
const missing = REQUIRED_IDS.filter((id) => !$(id));
ok(missing.length === 0, `all ${REQUIRED_IDS.length} referenced element ids exist`, `missing: ${missing.join(', ')}`);
ok(window.document.querySelectorAll('script[type=module]').length === 1, 'entry module script tag present');
ok(window.document.querySelectorAll('.screen').length >= 3, 'menu/lobby/results screens present');
ok($('boot-start').hasAttribute('hidden'), 'arena entry button starts hidden behind the loader');
ok($('menu-root').classList.contains('hidden'), 'menu starts hidden');

/* ═══════════════ 2. boots & menu wiring ═══════════════ */
section('2. Menu controller');

const profile = new ProfileManager();
const audio = new SoundSystem(profile);
const calls = [];
const menu = new MenuUI({
  profile,
  audio,
  callbacks: {
    onPlay: (c) => calls.push(['play', c]),
    onCreateRoom: (c) => calls.push(['create', c]),
    onJoinRoom: (code) => calls.push(['join', code]),
    onLobbyStart: () => calls.push(['start']),
    onLobbyLeave: () => calls.push(['leave']),
    onRematch: () => calls.push(['rematch']),
    onMainMenu: () => calls.push(['menu']),
    onSkinPreview: (s) => calls.push(['skin', s.id]),
    onLobbyConfig: () => calls.push(['lobbyConfig']),
    onSettingsChange: (k, v) => calls.push(['setting', k, v]),
  },
});
ok(!!menu, 'MenuUI constructs against the real DOM');

menu.buildGarage();
ok($('skin-list').children.length === SKINS.length, `garage rendered ${$('skin-list').children.length} skin cards`);
ok(window.document.querySelectorAll('.skin-card.active').length === 1, 'exactly one skin is active');
ok($('pc-level').textContent === String(profile.level), 'profile chip shows the level');
$('set-volume').dispatchEvent(new window.Event('input'));
ok(profile.settings.volume >= 0 && profile.settings.volume <= 1, 'volume slider persists a 0..1 value');

menu.syncProfile();
menu.showMenu();
ok(!$('menu-root').classList.contains('hidden'), 'showMenu reveals the menu root');

menu.openModal('modal-settings');
ok($('modal-settings').classList.contains('active'), 'settings modal opens');
menu.closeModals();
ok(!$('modal-settings').classList.contains('active'), 'settings modal closes');

menu.toast('hello racers', 'success', '🏁');
ok($('toast-stack').children.length === 1, 'toasts render');

menu.setNetStatus('ok', 'ONLINE · ready');
ok($('net-label').textContent.includes('ONLINE'), 'net status label updates');

/* segments */
$('seg-bots').querySelector('button[data-value="7"]').click();
ok(menu.config.bots === 7, 'segment control updates the bot count config');
$('seg-arena').querySelector('button[data-value="reactor"]').click();
ok(menu.config.arena === 'reactor', 'segment control updates the arena config');

/* PLAY / CREATE / JOIN flow */
$('btn-play').click();
ok(calls.some((c) => c[0] === 'play' && c[1].bots === 7), 'PLAY passes the configured match setup');
$('btn-create-room').click();
const created = calls.find((c) => c[0] === 'create');
ok(!!!created === false && /^SR-\d{4}$/.test(created[1].code), `CREATE ROOM generates a code (${created?.[1]?.code})`);
$('btn-join-room').click();
ok($('modal-join').classList.contains('active'), 'JOIN ROOM opens the in-page code dialog (no native prompt)');
$('join-code-input').value = '4821';
$('join-code-input').dispatchEvent(new window.Event('input'));
ok($('join-code-input').value === 'SR-4821', 'code input auto-formats to SR-####');
$('btn-join-confirm').click();
ok(calls.some((c) => c[0] === 'join' && c[1] === 'SR-4821'), 'JOIN ROOM forwards the validated code');
ok(!$('modal-join').classList.contains('active'), 'join modal closes after submitting');

menu.openModal('modal-join');
$('join-code-input').value = 'SR-12';
$('btn-join-confirm').click();
ok(!calls.some((c) => c[0] === 'join' && c[1] === 'SR-12'), 'short codes are rejected');
ok(!$('join-code-error').hidden, 'invalid code shows an inline error');
menu.closeModals();

$('btn-reset-profile').click();
ok($('btn-reset-profile').textContent.includes('AGAIN'), 'reset asks for confirmation inline');
$('btn-reset-profile').click();
ok($('btn-reset-profile').textContent === 'RESET ALL PROGRESS', 'reset completes on the second click');

/* skin selection */
const lockedCard = [...window.document.querySelectorAll('.skin-card')].find((el) => el.classList.contains('locked') || el.innerHTML.includes('skin-lock'));
ok(!!lockedCard, 'at least one skin is displayed as locked', lockedCard?.dataset.skin);
const firstUnlocked = [...window.document.querySelectorAll('.skin-card')].find((el) => !el.classList.contains('locked'));
firstUnlocked.click();
ok(calls.some((c) => c[0] === 'skin'), 'clicking a skin requests a 3D preview update');

/* lobby */
menu.showLobby({ code: 'SR-1234', isHost: true });
ok($('room-code').textContent === 'SR-1234', 'lobby shows the room code');
menu.updateLobby({
  code: 'SR-1234',
  isHost: true,
  config: menu.config,
  players: [
    { self: true, name: 'Me', color: 0xff2d4b, accent: 0xffd166, host: true, isBot: false },
    { name: 'Blitz', color: 0x1ec8ff, accent: 0xffffff, isBot: true },
  ],
});
ok($('lobby-list').children.length === 2, 'lobby lists both racers');
ok($('lobby-count').textContent === '2/8', 'lobby shows the player count');
$('btn-lobby-start').click();
ok(calls.some((c) => c[0] === 'start'), 'lobby START fires the host callback');
$('btn-lobby-leave').click();
ok(calls.some((c) => c[0] === 'leave'), 'lobby LEAVE fires the leave callback');

/* results */
menu.showResults({
  standings: [
    { isMe: true, name: 'Me', kills: 9, deaths: 2, isBot: false, color: 0xff2d4b, accent: 0xffd166, xp: 300 },
    { name: 'Blitz', kills: 4, deaths: 7, isBot: true, color: 0x1ec8ff, accent: 0xffffff, xp: 0 },
  ],
  xp: 300, won: true, modeName: 'NEON DEATHMATCH', reward: '+300 XP',
});
ok($('results-list').children.length === 2, 'results list renders every racer');
ok($('results-title').textContent === 'VICTORY!', 'victory title shown when the player wins');
$('btn-rematch').click();
ok(calls.some((c) => c[0] === 'rematch'), 'rematch button fires');
$('btn-results-menu').click();
ok(calls.some((c) => c[0] === 'menu'), 'main-menu button fires');

/* ═══════════════ 3. HUD ═══════════════ */
section('3. HUD');
const hud = new HUD();
hud.show();
ok(!$('hud-root').classList.contains('hidden'), 'hud.show reveals the HUD');
hud.setMode('NEON DEATHMATCH', 'FIRST TO 15 KILLS');
hud.setScore(7);
hud.setAlive(4);
hud.setLeader('Blitz', 9);
hud.setTimer(65);
ok($('hud-score').textContent === '7' && $('hud-alive').textContent === '4', 'score + alive counters update');
ok($('hud-timer').textContent === '1:05', `timer formats mm:ss (${$('hud-timer').textContent})`);
ok($('hud-leader').textContent.includes('Blitz'), 'leader line updates');

hud.setHealth(42, 100, 0);
ok($('health-fill').style.width === '42%', 'health bar width tracks HP');
ok($('health-text').textContent === '42', 'health number shown');
ok($('health-fill').classList.contains('hurt'), 'health bar switches to the hurt colour at 42%');
hud.setHealth(12, 100, 0);
ok($('health-fill').classList.contains('critical'), 'critical state at low HP');
hud.setHealth(100, 100, 45);
ok($('shield-bar').hidden === false && $('shield-fill').style.width === '100%', 'shield bar appears when shielded');

hud.setSpeed(128, '4', true);
ok($('speed-value').textContent === '128', 'speedometer readout updates');
ok($('fx-boost').classList.contains('on'), 'boost FX layer turns on while boosting');
hud.setSpeed(30, '1', false);
ok(!$('fx-boost').classList.contains('on'), 'boost FX turns off again');

hud.setAbility({ id: 'missile', name: 'HOMING MISSILE', icon: '🚀', color: 0xff7a1a }, 0.5, false);
ok($('ability-icon').textContent === '🚀', 'ability icon renders');
ok($('ability-name').textContent === 'HOMING MISSILE', 'ability name renders');
ok($('ability-ring-fill').style.strokeDashoffset !== '', 'cooldown ring animates');
ok($('ability-ready').hidden === true, 'READY badge hidden while cooling down');
hud.setAbility({ id: 'missile', name: 'HOMING MISSILE', icon: '🚀', color: 0xff7a1a }, 1, true);
ok($('ability-ready').hidden === false && $('ability-slot').classList.contains('armed'), 'READY badge + armed pulse at full charge');
hud.setAbility(null, 0);
ok($('ability-slot').classList.contains('empty'), 'empty slot state restores when the item is used');

hud.pushKill({ killer: 'Me', victim: 'Blitz', icon: '🚀', streak: 3, mine: 'kill' });
ok($('kill-feed').children.length === 1, 'kill feed entry added');
ok($('kill-feed').firstElementChild.classList.contains('me-kill'), 'your own kills are highlighted');
hud.pushKill({ killer: null, victim: 'Me (self)', icon: '💀', mine: 'death' });
ok($('kill-feed').children.length === 2, 'death entry added');
for (let i = 0; i < 8; i++) hud.pushKill({ killer: 'A', victim: 'B', icon: '💥' });
ok($('kill-feed').children.length <= 6, `kill feed is capped (${$('kill-feed').children.length} entries)`);

hud.hitMarker(false);
ok($('hit-marker').classList.contains('on'), 'hit marker animates');
hud.hitMarker(true);
ok($('kill-marker').classList.contains('on'), 'kill marker animates on lethal hits');
hud.damageDirection(-1.2);
ok($('dmg-dirs').children.length === 1, 'damage direction arrow added');
hud.damageNumber({ x: 100, y: 200 }, '46', 'crit');
ok($('dmg-numbers').children.length === 1, 'floating damage number added');
hud.flashDamage();
ok($('fx-damage').classList.contains('hit'), 'damage vignette flashes');
hud.setStatusChip('player', { kind: 'shield', label: 'SHIELD', until: 5 });
ok($('status-effects').children.length === 1, 'status chip shows for active abilities');
ok($('status-effects').firstElementChild.dataset.kind === 'shield', 'status chip is typed');
hud.setStatusChip('player', { kind: 'shield', label: 'SHIELD DOWN', until: 0 });
ok($('status-effects').children.length === 0, 'status chip clears when the effect ends');

hud.setScoreboard([
  { isMe: true, name: 'Me', isBot: false, kills: 9, deaths: 2, streak: 3, color: 0xff2d4b, accent: 0xffd166, ping: 24 },
  { name: 'Blitz', isBot: true, kills: 4, deaths: 7, streak: 0, color: 0x1ec8ff, accent: 0xffffff, ping: 0 },
], true);
ok(!$('scoreboard').classList.contains('hidden'), 'TAB scoreboard opens');
ok($('sb-body').children.length === 2, 'scoreboard lists every racer');
ok($('sb-body').firstElementChild.classList.contains('me'), 'own row is highlighted');
hud.setScoreboard([], false);
ok($('scoreboard').classList.contains('hidden'), 'scoreboard hides again');

hud.showDeath('Blitz');
ok(!$('death-overlay').classList.contains('hidden'), 'death overlay appears');
hud.setRespawn(2.4);
ok($('respawn-count').textContent === '3', 'respawn countdown rounds up');
hud.hideDeath();
ok($('death-overlay').classList.contains('hidden'), 'death overlay hides on respawn');

hud.countdown('3', 'GET READY');
ok(!$('countdown').classList.contains('hidden') && $('cd-text').textContent === '3', 'countdown overlay shows numbers');
hud.countdown(null);
ok($('countdown').classList.contains('hidden'), 'countdown hides when the race starts');
hud.banner('RAMPAGE!', 'gold');
ok($('banner').children.length === 1, 'center banner renders');
hud.setBoost(0.5);
ok(!$('boost-indicator').classList.contains('hidden'), 'boost meter shows');
hud.setBoost(null);
ok($('boost-indicator').classList.contains('hidden'), 'boost meter hides');
hud.fade(true, 'ENTERING ARENA');
ok($('fx-fade').classList.contains('on') && $('fx-fade').dataset.text === 'ENTERING ARENA', 'screen fade carries its caption');
hud.fade(false);
hud.hide();
ok($('hud-root').classList.contains('hidden'), 'hud.hide cleans up');

/* ═══════════════ 4. boot sequence ═══════════════ */
section('4. Boot sequence + scene transition trigger');
const bootPromise = menu.runBoot();
await new Promise((r) => setTimeout(r, 1400));
ok($('boot-status').textContent.length > 3, `boot reports progress ("${$('boot-status').textContent}")`);
ok(!$('boot-start').hasAttribute('hidden'), 'ENTER THE ARENA button appears when loading finishes');
menu.cb = { ...menu.cb };
$('boot-start').click();
await bootPromise;
ok($('boot').classList.contains('hidden'), 'boot overlay is removed after entering (menu reveals)');
ok(menu.config && typeof menu.config.mode === 'string', 'match config survives the boot flow');

/* ═══════════════ summary ═══════════════ */
console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
if (fail) {
  console.log('\x1b[31mFailures:\x1b[0m');
  failures.forEach((f) => console.log(` - ${f}`));
  process.exit(1);
}
console.log('\x1b[32mMenu + HUD are fully wired to index.html.\x1b[0m\n');
