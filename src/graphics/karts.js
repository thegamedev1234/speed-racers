/**
 * Super Racers — procedural 3D kart model.
 *
 * ⚠️ ORIENTATION CONTRACT: every kart faces **−Z** in local space.
 *    engine/physics therefore use  forward = (−sin(yaw), 0, −cos(yaw))
 *    so that positive Y rotation = turning LEFT (matches A / ←).
 */

import * as THREE from 'three';
import { makeGlowTexture } from './textures.js';

const glowTex = makeGlowTexture(0.25);

/* geometry cache — 8 karts share the same buffers */
const g = {};
function geo(key, build) {
  if (!g[key]) g[key] = build();
  return g[key];
}

const G = {
  body: () => new THREE.BoxGeometry(1.7, 0.5, 3.0),
  nose: () => new THREE.BoxGeometry(1.25, 0.34, 1.0),
  bumper: () => new THREE.BoxGeometry(1.5, 0.22, 0.4),
  pod: () => new THREE.BoxGeometry(0.34, 0.36, 1.5),
  podFin: () => new THREE.BoxGeometry(0.06, 0.3, 1.1),
  cockpit: () => new THREE.BoxGeometry(0.95, 0.42, 0.95),
  seatBack: () => new THREE.BoxGeometry(0.8, 0.55, 0.18),
  wingPost: () => new THREE.BoxGeometry(0.11, 0.45, 0.11),
  wing: () => new THREE.BoxGeometry(2.0, 0.1, 0.62),
  wingEdge: () => new THREE.BoxGeometry(2.0, 0.16, 0.08),
  engine: () => new THREE.BoxGeometry(0.8, 0.42, 0.8),
  pipe: () => new THREE.CylinderGeometry(0.11, 0.13, 0.7, 10),
  wheel: () => { const x = new THREE.CylinderGeometry(0.54, 0.54, 0.44, 20); x.rotateZ(Math.PI / 2); return x; },
  rim: () => { const x = new THREE.CylinderGeometry(0.3, 0.3, 0.47, 14); x.rotateZ(Math.PI / 2); return x; },
  helmet: () => new THREE.SphereGeometry(0.3, 16, 12),
  visor: () => new THREE.BoxGeometry(0.42, 0.16, 0.12),
  strip: () => new THREE.BoxGeometry(0.08, 0.07, 2.4),
  glowPlane: () => new THREE.PlaneGeometry(3.6, 4.8),
  flame: () => new THREE.ConeGeometry(0.42, 1.7, 12, 1, true),
  cannon: () => new THREE.CylinderGeometry(0.11, 0.13, 0.8, 10),
  headlight: () => new THREE.BoxGeometry(0.34, 0.14, 0.1),
};

const P = {
  wheel: () => new THREE.Group(),
};

/**
 * Build a full kart rig.
 * @returns {{group:THREE.Group, wheels:THREE.Object3D[], frontWheels:THREE.Object3D[],
 *            flames:THREE.Object3D[], glow:THREE.Mesh, body:THREE.Mesh, materials:object}}
 */
export function buildKartMesh(skin) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: skin.body, metalness: 0.45, roughness: 0.34,
    emissive: new THREE.Color(skin.glow).multiplyScalar(0.08),
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x141420, metalness: 0.55, roughness: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: skin.accent, metalness: 0.7, roughness: 0.25,
    emissive: new THREE.Color(skin.accent).multiplyScalar(0.35),
  });
  const neonMat = new THREE.MeshStandardMaterial({
    color: skin.glow, emissive: new THREE.Color(skin.glow), emissiveIntensity: 2.4,
    roughness: 0.2, metalness: 0.1,
  });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xbfcadd, metalness: 0.95, roughness: 0.18 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0d0d14, metalness: 0.15, roughness: 0.85 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0a1a2a, metalness: 0.9, roughness: 0.08,
    emissive: 0x0a2a44, emissiveIntensity: 0.6,
  });

  /* chassis */
  const body = new THREE.Mesh(G.body(), bodyMat);
  body.position.set(0, 0.66, 0.1);
  body.castShadow = true;
  group.add(body);

  const nose = new THREE.Mesh(G.nose(), bodyMat);
  nose.position.set(0, 0.54, -1.85);
  nose.rotation.x = 0.12;
  nose.castShadow = true;
  group.add(nose);

  const bumper = new THREE.Mesh(G.bumper(), accentMat);
  bumper.position.set(0, 0.44, -2.42);
  group.add(bumper);

  /* nose lights */
  [-0.42, 0.42].forEach((x) => {
    const hl = new THREE.Mesh(G.headlight(), new THREE.MeshStandardMaterial({
      color: 0xfff6d0, emissive: 0xfff0b0, emissiveIntensity: 2.2,
    }));
    hl.position.set(x, 0.6, -2.33);
    group.add(hl);
  });

  /* side pods + neon fins */
  [-1, 1].forEach((s) => {
    const pod = new THREE.Mesh(G.pod(), darkMat);
    pod.position.set(s * 1.06, 0.6, -0.15);
    pod.castShadow = true;
    group.add(pod);

    const fin = new THREE.Mesh(G.podFin(), neonMat);
    fin.position.set(s * 1.24, 0.66, -0.15);
    group.add(fin);

    const strip = new THREE.Mesh(G.strip(), neonMat);
    strip.position.set(s * 0.87, 0.44, 0.2);
    group.add(strip);
  });

  /* cockpit + driver */
  const cockpit = new THREE.Mesh(G.cockpit(), darkMat);
  cockpit.position.set(0, 0.95, 0.15);
  group.add(cockpit);

  const seatBack = new THREE.Mesh(G.seatBack(), bodyMat);
  seatBack.position.set(0, 1.12, 0.55);
  group.add(seatBack);

  const helmet = new THREE.Mesh(G.helmet(), accentMat);
  helmet.position.set(0, 1.34, 0.18);
  group.add(helmet);

  const visor = new THREE.Mesh(G.visor(), glassMat);
  visor.position.set(0, 1.35, -0.06);
  group.add(visor);

  /* engine block + exhausts */
  const engine = new THREE.Mesh(G.engine(), chromeMat);
  engine.position.set(0, 0.95, 1.0);
  engine.castShadow = true;
  group.add(engine);

  [-0.28, 0.28].forEach((x) => {
    const pipe = new THREE.Mesh(G.pipe(), chromeMat);
    pipe.position.set(x, 1.0, 1.5);
    pipe.rotation.x = Math.PI / 2;
    group.add(pipe);
  });

  /* rear wing */
  [-0.62, 0.62].forEach((x) => {
    const post = new THREE.Mesh(G.wingPost(), darkMat);
    post.position.set(x, 1.32, 1.5);
    group.add(post);
  });
  const wing = new THREE.Mesh(G.wing(), bodyMat);
  wing.position.set(0, 1.56, 1.52);
  wing.castShadow = true;
  group.add(wing);
  const wingEdge = new THREE.Mesh(G.wingEdge(), neonMat);
  wingEdge.position.set(0, 1.6, 1.85);
  group.add(wingEdge);

  /* front cannons (they read as weapon hardpoints) */
  [-0.6, 0.6].forEach((x) => {
    const cannon = new THREE.Mesh(G.cannon(), darkMat);
    cannon.position.set(x, 0.72, -1.15);
    cannon.rotation.x = Math.PI / 2;
    group.add(cannon);
  });

  /* wheels */
  const wheels = [];
  const frontWheels = [];
  const wheelSpecs = [
    { x: -1.08, z: -1.35, front: true },
    { x: 1.08, z: -1.35, front: true },
    { x: -1.12, z: 1.32, front: false },
    { x: 1.12, z: 1.32, front: false },
  ];
  wheelSpecs.forEach((spec) => {
    const pivot = P.wheel();
    pivot.position.set(spec.x, 0.55, spec.z);

    const tire = new THREE.Mesh(G.wheel(), tireMat);
    tire.castShadow = true;
    pivot.add(tire);

    const rim = new THREE.Mesh(G.rim(), accentMat);
    pivot.add(rim);

    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), chromeMat);
    pivot.add(hub);

    group.add(pivot);
    wheels.push(tire);
    if (spec.front) frontWheels.push(pivot);
  });

  /* underglow */
  const glow = new THREE.Mesh(G.glowPlane(), new THREE.MeshBasicMaterial({
    map: glowTex, color: skin.glow, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.06;
  group.add(glow);

  /* boost flames (hidden until boosting) */
  const flames = [];
  [-0.28, 0.28].forEach((x) => {
    const flame = new THREE.Mesh(G.flame(), new THREE.MeshBasicMaterial({
      color: skin.glow, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(x, 1.0, 2.1);
    flame.visible = false;
    group.add(flame);
    flames.push(flame);
  });

  /* nitro tank detailing */
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 4, 10), new THREE.MeshStandardMaterial({
    color: 0x2a3350, metalness: 0.8, roughness: 0.3,
    emissive: new THREE.Color(skin.glow).multiplyScalar(0.5),
  }));
  tank.position.set(0, 1.16, 1.1);
  tank.rotation.z = Math.PI / 2;
  group.add(tank);

  group.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });

  return {
    group, wheels, frontWheels, flames, glow, body,
    materials: { bodyMat, darkMat, accentMat, neonMat, chromeMat, tireMat, glassMat },
    skin,
  };
}

/** Simple "shell" kart used while remote avatars interpolate in. */
export function buildRemoteMarker(color) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 1.9, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  return ring;
}

export const KART_FORWARD_AXIS = new THREE.Vector3(0, 0, -1);
