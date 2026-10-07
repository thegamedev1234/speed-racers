/**
 * Super Racers — Player profile, kart skin catalog & persisted settings.
 * Everything is stored in localStorage; no backend required for progression.
 */

/* ── KART SKINS ─────────────────────────────────────────────────────────────
   stats are on a 1..5 scale and are converted to physics multipliers below.
   ─────────────────────────────────────────────────────────────────────────── */
export const SKINS = [
  {
    id: 'comet', name: 'Red Comet', tag: 'BALANCED',
    body: 0xff2d4b, accent: 0xffd166, glow: 0xff2d4b, rim: 0x9b1026,
    stats: { speed: 4, accel: 3, grip: 3, armor: 3 }, unlockLevel: 1,
  },
  {
    id: 'voltage', name: 'Neon Blue', tag: 'AGILE',
    body: 0x1ec8ff, accent: 0xffffff, glow: 0x22e1ff, rim: 0x0b5c9c,
    stats: { speed: 3, accel: 5, grip: 4, armor: 2 }, unlockLevel: 1,
  },
  {
    id: 'venom', name: 'Emerald Flash', tag: 'BRAWLER',
    body: 0x4dff88, accent: 0x0d3a1c, glow: 0xb4ff39, rim: 0x0f7a3a,
    stats: { speed: 4, accel: 4, grip: 2, armor: 3 }, unlockLevel: 1,
  },
  {
    id: 'aurum', name: 'Golden Jet', tag: 'SPEEDSTER',
    body: 0xffc23d, accent: 0x2b1a00, glow: 0xffd166, rim: 0x9c6b00,
    stats: { speed: 5, accel: 2, grip: 2, armor: 4 }, unlockLevel: 1,
  },
  {
    id: 'synthwave', name: 'Cyber Purple', tag: 'DRIFTER',
    body: 0xa855f7, accent: 0xff2bd6, glow: 0xff2bd6, rim: 0x4c1d95,
    stats: { speed: 3, accel: 3, grip: 5, armor: 3 }, unlockLevel: 1,
  },
  {
    id: 'chrome', name: 'Chrome Ghost', tag: 'STEALTH',
    body: 0xd8e6ff, accent: 0x6b7fa8, glow: 0x9fd8ff, rim: 0x6b7fa8,
    stats: { speed: 4, accel: 4, grip: 4, armor: 2 }, unlockLevel: 3,
  },
  {
    id: 'magma', name: 'Magma Titan', tag: 'TANK',
    body: 0xff5a1f, accent: 0x2a0a00, glow: 0xff8c1a, rim: 0x7a2400,
    stats: { speed: 2, accel: 4, grip: 3, armor: 5 }, unlockLevel: 5,
  },
  {
    id: 'wraith', name: 'Toxic Wraith', tag: 'GLASS CANNON',
    body: 0x0fff9e, accent: 0x04221a, glow: 0x0fff9e, rim: 0x065c46,
    stats: { speed: 5, accel: 5, grip: 3, armor: 1 }, unlockLevel: 7,
  },
];

export const BOT_NAMES = [
  'Blitz', 'Viper', 'Nitro', 'Rogue', 'Havoc', 'Turbo', 'Static', 'Bandit',
  'Ghost', 'Rampage', 'Frost', 'Jinx', 'Rumble', 'Onyx', 'Zephyr', 'Kobra',
];

export const ARENAS = {
  neon: { name: 'NEON DISTRICT', floor: 0x0b0620, line: 0x22e1ff, accent: 0xff2bd6, fog: 0x0a0322, sky: [0x1b0a44, 0x05010f] },
  reactor: { name: 'REACTOR CORE', floor: 0x120a06, line: 0xffc23d, accent: 0xff3b5c, fog: 0x140803, sky: [0x3a1405, 0x0a0300] },
  skyway: { name: 'SKY WAY', floor: 0x061a26, line: 0xb4ff39, accent: 0x22e1ff, fog: 0x04121c, sky: [0x0a3350, 0x030a14] },
};

/** Convert 1..5 stats into gameplay multipliers. */
export function skinModifiers(skin) {
  const s = skin.stats;
  return {
    maxSpeed: 1 + (s.speed - 3) * 0.028,
    accel: 1 + (s.accel - 3) * 0.045,
    grip: 1 + (s.grip - 3) * 0.06,
    maxHealth: 100 + (s.armor - 3) * 9,
  };
}

export function getSkin(id) {
  return SKINS.find((s) => s.id === id) || SKINS[0];
}

const STORE_KEY = 'super-racers-v2-profile';

const DEFAULT_SETTINGS = {
  volume: 0.8,
  music: 0.4,
  quality: 'medium',
  shake: 1,
  sensitivity: 1,
  invertY: false,
  dmgNumbers: true,
  bloom: true,
  serverUrl: '',
};

function randomName() {
  const n = ['Racer', 'Blaze', 'Neon', 'Drift', 'Ace', 'Fang', 'Volt', 'Echo'][Math.floor(Math.random() * 8)];
  return `${n}${Math.floor(100 + Math.random() * 900)}`;
}

export class ProfileManager {
  constructor() {
    this.data = this.load();
    this.listeners = new Set();
  }

  load() {
    const base = {
      name: randomName(),
      skin: 'comet',
      xp: 0,
      level: 1,
      kills: 0,
      deaths: 0,
      wins: 0,
      matches: 0,
      settings: { ...DEFAULT_SETTINGS },
    };
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      return {
        ...base,
        ...parsed,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      };
    } catch {
      return base;
    }
  }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); } catch { /* private mode */ }
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((fn) => fn(this.data)); }

  /* ── identity ─────────────────────────────────────────────── */
  get name() { return this.data.name; }
  setName(name) {
    const clean = String(name || '').replace(/[<>&"']/g, '').trim().slice(0, 14);
    if (clean) this.data.name = clean;
    this.save(); this.emit();
  }

  get skinId() { return this.data.skin; }
  get skin() { return getSkin(this.data.skin); }
  setSkin(id) {
    const skin = getSkin(id);
    if (!this.isUnlocked(skin)) return false;
    this.data.skin = skin.id;
    this.save(); this.emit();
    return true;
  }

  isUnlocked(skin) { return (skin.unlockLevel || 1) <= this.data.level; }

  /* ── progression ──────────────────────────────────────────── */
  get level() { return this.data.level; }
  xpForLevel(level) { return 100 + (level - 1) * 120; }
  get xp() { return this.data.xp; }

  addXp(amount) {
    this.data.xp += Math.max(0, Math.round(amount));
    let leveled = false;
    while (this.data.xp >= this.xpForLevel(this.data.level)) {
      this.data.xp -= this.xpForLevel(this.data.level);
      this.data.level += 1;
      leveled = true;
    }
    this.save(); this.emit();
    return leveled ? this.data.level : 0;
  }

  /** Record the outcome of a match and return the XP earned. */
  recordMatch({ kills = 0, deaths = 0, placement = 1, players = 1, won = false }) {
    const xp = Math.round(
      kills * 22 + Math.max(0, players - placement) * 12 + (won ? 120 : 25) + deaths * 2,
    );
    this.data.kills += kills;
    this.data.deaths += deaths;
    this.data.matches += 1;
    if (won) this.data.wins += 1;
    const levelUp = this.addXp(xp);
    this.save(); this.emit();
    return { xp, levelUp };
  }

  /* ── settings ─────────────────────────────────────────────── */
  get settings() { return this.data.settings; }
  setSetting(key, value) {
    this.data.settings[key] = value;
    this.save(); this.emit();
  }
  reset() {
    try { localStorage.removeItem(STORE_KEY); } catch { /* noop */ }
    this.data = this.load();
    this.emit();
  }
}
