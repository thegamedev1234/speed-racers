/**
 * Super Racers — procedural texture factory.
 * Every texture in the game is generated on a <canvas> at runtime, so the game
 * ships with zero binary assets and loads instantly.
 */

import * as THREE from 'three';

const cache = new Map();

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function finish(c, { repeat = 1, srgb = true, aniso = 8 } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function memo(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}

/* ── neon floor grid ─────────────────────────────────────────────────────── */
export function makeGridTexture({ bg = '#0b0620', line = '#22e1ff', accent = '#ff2bd6', cell = 128, size = 512 } = {}) {
  return memo(`grid:${bg}${line}${accent}${cell}`, () => {
    const c = canvas(size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    // subtle noise plating
    for (let i = 0; i < 2400; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.02})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
    }

    // panel seams
    ctx.strokeStyle = 'rgba(255,255,255,.045)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= size; x += cell / 2) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(size, x); ctx.stroke();
    }

    // bright neon grid
    ctx.shadowColor = line;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = line;
    ctx.lineWidth = 2.5;
    for (let x = 0; x <= size; x += cell) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(size, x); ctx.stroke();
    }
    ctx.shadowColor = accent;
    ctx.shadowBlur = 16;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(size, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, size); ctx.stroke();
    ctx.shadowBlur = 0;
    return finish(c, { repeat: 1 });
  });
}

/* ── soft radial glow sprite (explosions, sparks, trails) ────────────────── */
export function makeGlowTexture(softness = 0.35) {
  return memo(`glow:${softness}`, () => {
    const size = 128;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(softness, 'rgba(255,255,255,.55)');
    g.addColorStop(0.7, 'rgba(255,255,255,.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return finish(c, { srgb: false });
  });
}

export function makeSmokeTexture() {
  return memo('smoke', () => {
    const size = 128;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,.85)');
    g.addColorStop(0.45, 'rgba(255,255,255,.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    // mottled puff
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 26; i++) {
      const r = 6 + Math.random() * 16;
      ctx.beginPath();
      ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.35})`;
      ctx.fill();
    }
    return finish(c, { srgb: false });
  });
}

/* ── star field ──────────────────────────────────────────────────────────── */
export function makeStarTexture() {
  return memo('star', () => {
    const size = 64;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, 'rgba(200,240,255,.7)');
    g.addColorStop(1, 'rgba(120,180,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return finish(c, { srgb: false });
  });
}

/* ── boost pad chevrons ──────────────────────────────────────────────────── */
export function makeChevronTexture(color = '#22e1ff') {
  return memo(`chev:${color}`, () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#05010f';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = color;
    ctx.lineWidth = 16;
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    for (let i = 0; i < 3; i++) {
      const y = 60 + i * 62;
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(size / 2, y - 34);
      ctx.lineTo(size - 40, y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    return finish(c, { repeat: 1 });
  });
}

/* ── item crate panels ───────────────────────────────────────────────────── */
export function makeCrateTexture(accent = '#ff2bd6') {
  return memo(`crate:${accent}`, () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, '#141033');
    g.addColorStop(1, '#0a0618');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 8;
    ctx.strokeRect(14, 14, size - 28, size - 28);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(60, 60); ctx.lineTo(size - 60, size - 60);
    ctx.moveTo(size - 60, 60); ctx.lineTo(60, size - 60);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 26, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.shadowBlur = 0;
    return finish(c, { repeat: 1 });
  });
}

/* ── arena wall / pylon glow panel ───────────────────────────────────────── */
export function makePanelTexture(line = '#22e1ff') {
  return memo(`panel:${line}`, () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0a0620';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(255,255,255,.03)';
    for (let y = 0; y < size; y += 16) ctx.fillRect(0, y, size, 8);
    ctx.fillStyle = line;
    ctx.shadowColor = line;
    ctx.shadowBlur = 18;
    ctx.fillRect(0, size / 2 - 5, size, 10);
    ctx.fillRect(0, 8, size, 3);
    ctx.shadowBlur = 0;
    return finish(c, { repeat: 1 });
  });
}

/* ── sky gradient dome ───────────────────────────────────────────────────── */
export function makeSkyTexture(top = '#1b0a44', bottom = '#05010f') {
  return memo(`sky:${top}${bottom}`, () => {
    const w = 16, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, top);
    g.addColorStop(0.55, bottom);
    g.addColorStop(1, '#02000a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

/* ── circular HUD-independent ring sprite ────────────────────────────────── */
export function makeRingTexture(color = '#22e1ff') {
  return memo(`ring:${color}`, () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 44, 0, Math.PI * 2);
    ctx.stroke();
    return finish(c, { srgb: false });
  });
}

export function disposeTextureCache() {
  cache.forEach((t) => t.dispose?.());
  cache.clear();
}
