/**
 * Super Racers - User Profile & Customization System
 * Handles persistent profile data (username, currency, skins, preferences) via localStorage.
 */

const STORAGE_KEY = 'super_racers_profile_v1';

export const SKINS = [
  {
    id: 'red-comet',
    name: 'Red Comet',
    description: 'Blazing crimson with aerodynamic gold accents.',
    primaryColor: 0xef4444,
    secondaryColor: 0x1f2937,
    accentColor: 0xfbbf24,
    emissiveColor: 0x991b1b,
    swatch: '#ef4444',
    badge: 'Standard'
  },
  {
    id: 'neon-blue',
    name: 'Neon Blue',
    description: 'Electric cyan chassis built for ultra-fast drifts.',
    primaryColor: 0x06b6d4,
    secondaryColor: 0x0f172a,
    accentColor: 0x38bdf8,
    emissiveColor: 0x0891b2,
    swatch: '#06b6d4',
    badge: 'Popular'
  },
  {
    id: 'emerald-flash',
    name: 'Emerald Flash',
    description: 'Hyper-tuned venom green with carbon fiber details.',
    primaryColor: 0x10b981,
    secondaryColor: 0x064e3b,
    accentColor: 0xfacc15,
    emissiveColor: 0x047857,
    swatch: '#10b981',
    badge: 'Speed'
  },
  {
    id: 'golden-jet',
    name: 'Golden Jet',
    description: 'Championship gold alloy with matte obsidian plating.',
    primaryColor: 0xf59e0b,
    secondaryColor: 0x18181b,
    accentColor: 0xfef08a,
    emissiveColor: 0xb45309,
    swatch: '#f59e0b',
    badge: 'Elite'
  },
  {
    id: 'cyber-purple',
    name: 'Cyber Purple',
    description: 'Deep synthwave violet with neon pink highlights.',
    primaryColor: 0x8b5cf6,
    secondaryColor: 0x2e1065,
    accentColor: 0xf472b6,
    emissiveColor: 0x6d28d9,
    swatch: '#8b5cf6',
    badge: 'Special'
  }
];

export const REGIONS = [
  { id: 'US-East', name: 'US-East (N. Virginia)', ping: 24 },
  { id: 'US-West', name: 'US-West (Oregon)', ping: 48 },
  { id: 'EU-Central', name: 'EU-Central (Frankfurt)', ping: 76 },
  { id: 'ASIA-East', name: 'ASIA-East (Tokyo)', ping: 125 }
];

function generateDefaultUsername() {
  const randomDigits = Math.floor(1000 + Math.random() * 9000);
  return `Racer_${randomDigits}`;
}

export class ProfileManager {
  constructor() {
    this.profile = this.loadProfile();
  }

  loadProfile() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Ensure defaults if schema updated
        return {
          username: parsed.username || generateDefaultUsername(),
          level: parsed.level || 1,
          xp: parsed.xp || 150,
          maxXp: parsed.maxXp || 500,
          coins: parsed.coins ?? 1450,
          gems: parsed.gems ?? 60,
          skinId: parsed.skinId || 'red-comet',
          region: parsed.region || 'US-East',
          audioEnabled: parsed.audioEnabled ?? true,
          volume: parsed.volume ?? 0.8,
          graphics: parsed.graphics || 'high'
        };
      }
    } catch (e) {
      console.warn('Failed to load profile from localStorage:', e);
    }

    const defaultProfile = {
      username: generateDefaultUsername(),
      level: 1,
      xp: 150,
      maxXp: 500,
      coins: 1450,
      gems: 60,
      skinId: 'red-comet',
      region: 'US-East',
      audioEnabled: true,
      volume: 0.8,
      graphics: 'high'
    };

    this.saveProfile(defaultProfile);
    return defaultProfile;
  }

  saveProfile(profile = this.profile) {
    try {
      this.profile = { ...profile };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profile));
    } catch (e) {
      console.warn('Failed to save profile to localStorage:', e);
    }
  }

  getUsername() {
    return this.profile.username;
  }

  setUsername(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return false;
    this.profile.username = trimmed.slice(0, 16);
    this.saveProfile();
    return true;
  }

  getActiveSkin() {
    return SKINS.find(s => s.id === this.profile.skinId) || SKINS[0];
  }

  setSkin(skinId) {
    const skin = SKINS.find(s => s.id === skinId);
    if (!skin) return null;
    this.profile.skinId = skin.id;
    this.saveProfile();
    return skin;
  }

  getRegion() {
    return this.profile.region;
  }

  setRegion(regionId) {
    this.profile.region = regionId;
    this.saveProfile();
  }

  getAudioEnabled() {
    return this.profile.audioEnabled;
  }

  setAudioEnabled(enabled) {
    this.profile.audioEnabled = !!enabled;
    this.saveProfile();
  }

  getVolume() {
    return this.profile.volume;
  }

  setVolume(vol) {
    this.profile.volume = Math.max(0, Math.min(1, vol));
    this.saveProfile();
  }

  getGraphics() {
    return this.profile.graphics;
  }

  setGraphics(quality) {
    this.profile.graphics = quality;
    this.saveProfile();
  }

  getAllSkins() {
    return SKINS;
  }
}
