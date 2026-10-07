/**
 * Super Racers — Arena construction & layouts.
 *
 * Three hand-authored neon battlefields, each with its own palette, obstacle
 * layout, boost pads and animated set-dressing. Every solid object registers an
 * AABB or cylinder collider with the custom CollisionWorld.
 */

import * as THREE from 'three';
import { makeGridTexture, makeChevronTexture, makePanelTexture, makeSkyTexture, makeGlowTexture, makeRingTexture } from '../graphics/textures.js';

/**
 * Half-extent of the playfield. Kept compact on purpose: a dense 96×96 arena
 * means racers constantly meet in combat instead of wandering an empty map.
 * All hand-authored layouts below are written against a 64-unit half-extent and
 * scaled to this value at build time, so they stay easy to tweak.
 */
export const ARENA_HALF = 48;
const LAYOUT_SCALE = ARENA_HALF / 64;

export const THEMES = {
  neon: {
    id: 'neon', name: 'NEON DISTRICT',
    floor: '#0a0420', line: '#22e1ff', accent: '#ff2bd6',
    fog: 0x0a0322, fogDensity: 0.0075,
    sky: ['#1d0a4a', '#05010f'],
    ambient: 0x2a1c5e, ambientIntensity: 0.55,
    sun: 0x9fd8ff, sunIntensity: 1.15,
    pylonColor: 0x22e1ff, trimColor: 0xff2bd6,
    crateAccent: '#ff2bd6',
    pads: ['#22e1ff', '#ff2bd6'],
  },
  reactor: {
    id: 'reactor', name: 'REACTOR CORE',
    floor: '#160a06', line: '#ffc23d', accent: '#ff3b5c',
    fog: 0x1a0703, fogDensity: 0.011,
    sky: ['#43170a', '#0a0300'],
    ambient: 0x5e2a1c, ambientIntensity: 0.5,
    sun: 0xffbb77, sunIntensity: 1.25,
    pylonColor: 0xffc23d, trimColor: 0xff3b5c,
    crateAccent: '#ffc23d',
    pads: ['#ffc23d', '#ff3b5c'],
  },
  skyway: {
    id: 'skyway', name: 'SKY WAY',
    floor: '#06192a', line: '#b4ff39', accent: '#22e1ff',
    fog: 0x04121c, fogDensity: 0.006,
    sky: ['#0d3f63', '#03080f'],
    ambient: 0x1c4a5e, ambientIntensity: 0.6,
    sun: 0xd8ffd0, sunIntensity: 1.2,
    pylonColor: 0xb4ff39, trimColor: 0x22e1ff,
    crateAccent: '#b4ff39',
    pads: ['#b4ff39', '#22e1ff'],
  },
};

/* ── spawn / pickup layouts (authored @64, scaled below) ─────────────────── */
const RAW_KART_SPAWNS = [
  { x: 0, z: 46, yaw: 0 },
  { x: 24, z: 40, yaw: -0.5 },
  { x: -24, z: 40, yaw: 0.5 },
  { x: 44, z: 16, yaw: -1.2 },
  { x: -44, z: 16, yaw: 1.2 },
  { x: 46, z: -22, yaw: -2.1 },
  { x: -46, z: -22, yaw: 2.1 },
  { x: 20, z: -44, yaw: Math.PI * 0.85 },
  { x: -20, z: -44, yaw: -Math.PI * 0.85 },
  { x: 0, z: -30, yaw: Math.PI },
];

const RAW_CRATE_SPAWNS = [
  { x: 0, z: 10 }, { x: 0, z: -10 },
  { x: 22, z: 22 }, { x: -22, z: 22 }, { x: 22, z: -22 }, { x: -22, z: -22 },
  { x: 0, z: 30 }, { x: 0, z: -30 },
  { x: 30, z: 6 }, { x: -30, z: -6 },
  { x: 40, z: 0 }, { x: -40, z: 0 },
  { x: 12, z: 46 }, { x: -12, z: -46 },
  { x: 46, z: 34 }, { x: -46, z: -34 },
  { x: 26, z: 0 }, { x: -26, z: 0 },
  { x: 0, z: 22 }, { x: 0, z: -22 },
];

const RAW_BOOST_PADS = [
  { x: 0, z: 34, rot: 0 },
  { x: 0, z: -34, rot: Math.PI },
  { x: 36, z: 0, rot: Math.PI / 2 },
  { x: -36, z: 0, rot: -Math.PI / 2 },
  { x: 30, z: -34, rot: Math.PI * 0.75 },
  { x: -30, z: 34, rot: -Math.PI * 0.25 },
];

export const KART_SPAWNS = RAW_KART_SPAWNS.map((p) => ({
  x: p.x * LAYOUT_SCALE, z: p.z * LAYOUT_SCALE, yaw: p.yaw,
}));

export const CRATE_SPAWNS = RAW_CRATE_SPAWNS.map((p) => ({
  x: p.x * LAYOUT_SCALE, z: p.z * LAYOUT_SCALE,
}));

export const BOOST_PADS = RAW_BOOST_PADS.map((p) => ({
  x: p.x * LAYOUT_SCALE, z: p.z * LAYOUT_SCALE, rot: p.rot,
}));

/* ── obstacle layout per theme ───────────────────────────────────────────── */
function layoutBoxes(themeId) {
  const common = [
    // central cross walls (leave diagonal lanes open)
    { x: 14, z: 14, w: 12, d: 2.2, h: 5 },
    { x: -14, z: 14, w: 12, d: 2.2, h: 5 },
    { x: 14, z: -14, w: 12, d: 2.2, h: 5 },
    { x: -14, z: -14, w: 12, d: 2.2, h: 5 },
    // mid-field cover
    { x: 34, z: 34, w: 10, d: 10, h: 6 },
    { x: -34, z: 34, w: 10, d: 10, h: 6 },
    { x: 34, z: -34, w: 10, d: 10, h: 6 },
    { x: -34, z: -34, w: 10, d: 10, h: 6 },
    // long side walls
    { x: 52, z: 10, w: 2.4, d: 26, h: 5 },
    { x: -52, z: -10, w: 2.4, d: 26, h: 5 },
    // small kickers
    { x: 22, z: 44, w: 8, d: 2.2, h: 3.5 },
    { x: -32, z: -44, w: 8, d: 2.2, h: 3.5 },
    // centre-side pillars for cover in the middle of the map
    { x: 8, z: 0, w: 2.4, d: 8, h: 4 },
    { x: -8, z: 0, w: 2.4, d: 8, h: 4 },
  ];

  if (themeId === 'reactor') {
    return [
      ...common,
      { x: 12, z: 40, w: 12, d: 2.4, h: 5 },
      { x: -12, z: 40, w: 12, d: 2.4, h: 5 },
      { x: 12, z: -40, w: 12, d: 2.4, h: 5 },
      { x: -12, z: -40, w: 12, d: 2.4, h: 5 },
      { x: 44, z: -6, w: 2.4, d: 16, h: 5 },
      { x: -44, z: 6, w: 2.4, d: 16, h: 5 },
    ];
  }
  if (themeId === 'skyway') {
    return [
      ...common,
      { x: 44, z: 6, w: 2.2, d: 14, h: 4.5 },
      { x: -44, z: -6, w: 2.2, d: 14, h: 4.5 },
      { x: 6, z: -44, w: 14, d: 2.2, h: 4.5 },
      { x: -6, z: 44, w: 14, d: 2.2, h: 4.5 },
    ];
  }
  return [
    ...common,
    { x: 11, z: 18, w: 8, d: 2.2, h: 5 },
    { x: -11, z: 18, w: 8, d: 2.2, h: 5 },
    { x: 11, z: -18, w: 8, d: 2.2, h: 5 },
    { x: -11, z: -18, w: 8, d: 2.2, h: 5 },
    { x: 40, z: -40, w: 12, d: 2.2, h: 5 },
    { x: -40, z: 40, w: 12, d: 2.2, h: 5 },
  ];
}

function layoutPylons(themeId) {
  const base = [
    { x: 18, z: 0, r: 1.5, h: 7 },
    { x: -18, z: 0, r: 1.5, h: 7 },
    { x: 17, z: 42, r: 1.5, h: 7 },
    { x: -17, z: -42, r: 1.5, h: 7 },
    { x: 48, z: 48, r: 2.2, h: 10 },
    { x: -48, z: 48, r: 2.2, h: 10 },
    { x: 48, z: -48, r: 2.2, h: 10 },
    { x: -48, z: -48, r: 2.2, h: 10 },
    { x: 40, z: 20, r: 1.3, h: 6 },
    { x: -40, z: -20, r: 1.3, h: 6 },
  ];
  if (themeId === 'reactor') {
    base.push({ x: 20, z: 30, r: 1.8, h: 8 }, { x: -20, z: -30, r: 1.8, h: 8 });
  }
  if (themeId === 'skyway') {
    base.push({ x: -34, z: 26, r: 1.4, h: 6 }, { x: 34, z: -26, r: 1.4, h: 6 });
  }
  return base;
}

/* ═══════════════════════════════════════════════════════════════════════════
   BUILDER
   ═══════════════════════════════════════════════════════════════════════════ */
export function buildArenaObjects(scene, world, themeId = 'neon') {
  const theme = THEMES[themeId] || THEMES.neon;
  const animated = [];
  const boostPads = [];
  const half = ARENA_HALF;

  /* fog + sky ------------------------------------------------------------- */
  scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(700, 24, 16),
    new THREE.MeshBasicMaterial({
      map: makeSkyTexture(theme.sky[0], theme.sky[1]),
      side: THREE.BackSide, fog: false, depthWrite: false,
    }),
  );
  skyDome.position.y = -20;
  scene.add(skyDome);

  /* starfield ------------------------------------------------------------- */
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    const r = 320 + Math.random() * 260;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * 0.85;
    starPos[i * 3] = Math.cos(theta) * Math.cos(phi) * r;
    starPos[i * 3 + 1] = Math.sin(phi) * r * 0.9 + 10;
    starPos[i * 3 + 2] = Math.sin(theta) * Math.cos(phi) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    map: makeGlowTexture(0.2), color: 0xbfe8ff, size: 7, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
  }));
  scene.add(stars);

  /* distant holographic skyline ------------------------------------------ */
  const skylineMat = new THREE.MeshBasicMaterial({ color: theme.pylonColor, transparent: true, opacity: 0.11, fog: false });
  const skyline = new THREE.Group();
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + Math.random() * 0.05;
    const dist = 210 + Math.random() * 130;
    const h = 30 + Math.random() * 130;
    const w = 12 + Math.random() * 26;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skylineMat);
    box.position.set(Math.cos(a) * dist, h / 2 - 12, Math.sin(a) * dist);
    skyline.add(box);
  }
  scene.add(skyline);

  /* floor ----------------------------------------------------------------- */
  const gridTex = makeGridTexture({ bg: theme.floor, line: theme.line, accent: theme.accent, cell: 128 });
  gridTex.repeat.set(14, 14);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 6, half * 6),
    new THREE.MeshStandardMaterial({
      map: gridTex, roughness: 0.62, metalness: 0.42,
      emissive: new THREE.Color(theme.line), emissiveMap: gridTex, emissiveIntensity: 0.55,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  /* boundary glow ring ---------------------------------------------------- */
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(half - 0.6, half + 1.4, 96),
    new THREE.MeshBasicMaterial({ color: theme.pylonColor, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  /* perimeter walls ------------------------------------------------------- */
  const panelTex = makePanelTexture(theme.line);
  panelTex.repeat.set(half / 3, 1);
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x0a0620, metalness: 0.6, roughness: 0.5,
    map: panelTex, emissive: new THREE.Color(theme.line), emissiveMap: panelTex, emissiveIntensity: 0.9,
  });
  const wallH = 7;
  world.addBounds(half, wallH, 5);
  const wallDefs = [
    { x: 0, z: -half - 2.5, w: half * 2 + 10, d: 5 },
    { x: 0, z: half + 2.5, w: half * 2 + 10, d: 5 },
    { x: -half - 2.5, z: 0, w: 5, d: half * 2 + 10 },
    { x: half + 2.5, z: 0, w: 5, d: half * 2 + 10 },
  ];
  wallDefs.forEach((wd) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(wd.w, wallH, wd.d), wallMat);
    mesh.position.set(wd.x, wallH / 2, wd.z);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    scene.add(mesh);
    // glowing cap
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(wd.w + (wd.w > wd.d ? 0 : 0.6), 0.35, wd.d + (wd.d > wd.w ? 0 : 0.6)),
      new THREE.MeshBasicMaterial({ color: theme.pylonColor }),
    );
    cap.position.set(wd.x, wallH + 0.1, wd.z);
    scene.add(cap);
  });

  /* solid obstacles ------------------------------------------------------- */
  const boxMat = new THREE.MeshStandardMaterial({
    color: 0x120c2e, metalness: 0.55, roughness: 0.45,
    emissive: new THREE.Color(theme.trimColor), emissiveIntensity: 0.18,
  });
  layoutBoxes(themeId).forEach((raw) => {
    const b = {
      x: raw.x * LAYOUT_SCALE, z: raw.z * LAYOUT_SCALE,
      w: raw.w * LAYOUT_SCALE, d: raw.d * LAYOUT_SCALE, h: raw.h,
    };
    world.addBox({ x: b.x, z: b.z, w: b.w, d: b.d, h: b.h });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), boxMat);
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(b.w + 0.12, 0.22, b.d + 0.12),
      new THREE.MeshBasicMaterial({ color: theme.trimColor }),
    );
    trim.position.set(b.x, b.h + 0.06, b.z);
    scene.add(trim);
  });

  /* pylons ---------------------------------------------------------------- */
  const pylonGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
  layoutPylons(themeId).forEach((raw, i) => {
    const p = {
      x: raw.x * LAYOUT_SCALE, z: raw.z * LAYOUT_SCALE,
      r: raw.r * LAYOUT_SCALE, h: raw.h,
    };
    world.addCylinder({ x: p.x, z: p.z, r: p.r, h: p.h });
    const mesh = new THREE.Mesh(pylonGeo, new THREE.MeshStandardMaterial({
      color: 0x181040, metalness: 0.7, roughness: 0.35,
      emissive: new THREE.Color(theme.pylonColor), emissiveIntensity: 0.28,
    }));
    mesh.scale.set(p.r, p.h, p.r);
    mesh.position.set(p.x, p.h / 2, p.z);
    mesh.castShadow = true;
    scene.add(mesh);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(p.r * 1.35, 0.16, 8, 22),
      new THREE.MeshBasicMaterial({ color: i % 2 ? theme.trimColor : theme.pylonColor }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.set(p.x, p.h * 0.72, p.z);
    scene.add(halo);
    animated.push((t) => {
      halo.position.y = p.h * 0.72 + Math.sin(t * 1.4 + i) * 0.5;
      halo.rotation.z = t * 0.6;
    });
  });

  /* central holographic core --------------------------------------------- */
  const coreGroup = new THREE.Group();
  const coreBase = new THREE.Mesh(
    new THREE.CylinderGeometry(4.6, 5.4, 1.2, 24),
    new THREE.MeshStandardMaterial({ color: 0x161038, metalness: 0.8, roughness: 0.3, emissive: theme.pylonColor, emissiveIntensity: 0.35 }),
  );
  coreBase.position.y = 0.6;
  coreBase.receiveShadow = true;
  coreGroup.add(coreBase);
  const coreBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 2.6, 34, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: theme.accent, transparent: true, opacity: 0.24,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  coreBeam.position.y = 18;
  coreGroup.add(coreBeam);
  world.addCylinder({ x: 0, z: 0, r: 5, h: 3 });
  scene.add(coreGroup);

  for (let i = 0; i < 3; i++) {
    const r = 9 + i * 3.5;
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.18, 8, 48),
      new THREE.MeshBasicMaterial({ color: i % 2 ? theme.pylonColor : theme.accent, transparent: true, opacity: 0.85 }),
    );
    torus.rotation.x = Math.PI / 2;
    torus.position.y = 12 + i * 5;
    scene.add(torus);
    animated.push((t) => {
      torus.rotation.z = t * (0.35 + i * 0.18);
      torus.position.y = 12 + i * 5 + Math.sin(t * 0.9 + i * 1.7) * 1.6;
    });
  }

  /* floating holo billboards --------------------------------------------- */
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const billboard = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 8),
      new THREE.MeshBasicMaterial({
        map: makeRingTexture(theme.pylonColor), color: theme.pylonColor, transparent: true,
        opacity: 0.5, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    billboard.position.set(Math.cos(a) * 88, 30, Math.sin(a) * 88);
    billboard.lookAt(0, 18, 0);
    scene.add(billboard);
    animated.push((t) => {
      billboard.position.y = 30 + Math.sin(t * 0.7 + i) * 3;
      billboard.material.opacity = 0.35 + Math.sin(t * 1.2 + i) * 0.15;
    });
  }

  /* boost pads ------------------------------------------------------------ */
  BOOST_PADS.forEach((pad, i) => {
    const color = theme.pads[i % theme.pads.length];
    const tex = makeChevronTexture(color);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 9),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = pad.rot;
    mesh.position.set(pad.x, 0.06, pad.z);
    scene.add(mesh);
    boostPads.push({ x: pad.x, z: pad.z, radius: 4.4, mesh });
    animated.push((t) => {
      tex.offset.y = -t * 0.9;
      mesh.material.opacity = 0.72 + Math.sin(t * 3 + i) * 0.22;
    });
  });

  /* theme flourishes ------------------------------------------------------ */
  if (themeId === 'skyway') {
    // cloud sea far below
    const clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshBasicMaterial({ color: 0x2a6a9a, transparent: true, opacity: 0.35, fog: false }),
    );
    clouds.rotation.x = -Math.PI / 2;
    clouds.position.y = -46;
    scene.add(clouds);
  }
  if (themeId === 'reactor') {
    // glowing magma cracks
    for (let i = 0; i < 14; i++) {
      const crack = new THREE.Mesh(
        new THREE.PlaneGeometry(2 + Math.random() * 5, 26 + Math.random() * 40),
        new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      crack.rotation.x = -Math.PI / 2;
      crack.rotation.z = Math.random() * Math.PI;
      crack.position.set((Math.random() - 0.5) * 110, 0.03, (Math.random() - 0.5) * 110);
      scene.add(crack);
      animated.push((t) => { crack.material.opacity = 0.18 + Math.sin(t * 1.5 + i) * 0.12; });
    }
  }

  /* lighting -------------------------------------------------------------- */
  const ambient = new THREE.AmbientLight(theme.ambient, theme.ambientIntensity);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(theme.pylonColor, 0x120820, 0.45);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(theme.sun, theme.sunIntensity);
  sun.position.set(48, 70, 32);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  sun.shadow.camera.left = -ARENA_HALF * 1.1;
  sun.shadow.camera.right = ARENA_HALF * 1.1;
  sun.shadow.camera.top = ARENA_HALF * 1.1;
  sun.shadow.camera.bottom = -ARENA_HALF * 1.1;
  sun.shadow.bias = -0.0012;
  scene.add(sun);

  const pointA = new THREE.PointLight(theme.accent, 120, 90, 2);
  pointA.position.set(0, 16, 0);
  scene.add(pointA);

  const pointB = new THREE.PointLight(theme.pylonColor, 60, 70, 2);
  pointB.position.set(40, 12, -40);
  scene.add(pointB);
  const pointC = new THREE.PointLight(theme.trimColor, 60, 70, 2);
  pointC.position.set(-40, 12, 40);
  scene.add(pointC);

  animated.push((t) => {
    pointA.intensity = 100 + Math.sin(t * 2.2) * 35;
  });

  return {
    theme,
    boostPads,
    update(dt, time) {
      animated.forEach((fn) => fn(time));
      skyline.rotation.y += dt * 0.008;
      stars.rotation.y += dt * 0.004;
    },
  };
}

/**
 * Build a set of guaranteed-clear spawn points for the *current* arena by
 * sweeping a ring around the centre and rejecting anything that intersects a
 * collider. Every spawn faces the middle of the map. This makes hand-authored
 * layouts (and the arena scale factor) impossible to get wrong.
 */
export function generateSpawnPoints(world, count = 12) {
  const clearances = [0.88, 0.74, 0.6, 0.46];
  const found = [];
  for (const ratio of clearances) {
    const radius = ARENA_HALF * ratio;
    const steps = Math.max(12, Math.round(radius * 0.7));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2 + (ratio * 1.7);
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      if (world.overlapsCircle(x, z, 3.4, 1)) continue;
      // face the centre: forward (−sin yaw, −cos yaw) must point at the origin
      const yaw = Math.atan2(x, z);
      // keep spawns reasonably spread out
      if (found.some((p) => Math.hypot(p.x - x, p.z - z) < 12)) continue;
      found.push({ x, z, yaw });
      if (found.length >= count) return found;
    }
  }
  return found.length ? found : KART_SPAWNS;
}

/** Backwards-compatible alias used by respawn helpers. */
export function clearSpawnPoints(world, count = 12) {
  return generateSpawnPoints(world, count);
}

/** Which spawn point is furthest from every other kart (fair respawn). */
export function pickSpawnAwayFrom(karts, spawns = KART_SPAWNS) {
  let best = spawns[0];
  let bestScore = -Infinity;
  for (const s of spawns) {
    let minDist = Infinity;
    for (const k of karts) {
      if (!k.alive) continue;
      const d = Math.hypot(k.position.x - s.x, k.position.z - s.z);
      if (d < minDist) minDist = d;
    }
    if (minDist > bestScore) { bestScore = minDist; best = s; }
  }
  return best;
}
