/**
 * Super Racers — GLB kart model (buggy-battle.glb).
 *
 * Loads `public/models/karts/buggy-battle.glb` with Three.js GLTFLoader and
 * presents it through the same visual contract as the old procedural builder
 * in `karts.js`:
 *
 *   { group, wheels, frontWheels, flames, glow, body, materials, skin }
 *
 * ⚠️  ORIENTATION CONTRACT: every kart faces −Z in local space.
 *     engine/physics therefore use  forward = (−sin(yaw), 0, −cos(yaw))
 *     so that positive Y rotation = turning LEFT (matches A / ←).
 *
 * The GLB is loaded as-is (no extra rotation) — it is authored facing −Z, so
 * its front (nose) sits at the −Z end of its bounding box and its rear at +Z.
 * If a future revision of the model is authored facing +Z, flip it here:
 *   model.rotation.y = Math.PI;
 *
 * Environment geometry (ground / pedestal / rocks / base / terrain) that may
 * ship inside the GLB is stripped out in `prepareModel` *before* the bounding
 * box is computed, so only the vehicle is measured and centred. The kart is
 * then placed flush on the floor:
 *   • wheels touch y = 0  (min Y of the vehicle is placed at 0)
 *   • origin at the kart base (centre of X/Z, bottom at Y)
 *   • the GLB root aligns with the physics kart body, so the chase camera
 *     reading kart.position / kart.yaw / kart.steer / kart.speed lines up.
 *
 * `buildKartMesh` is synchronous: the GLB is preloaded once via `loadKartModel()`
 * (awaited before the engine boots in main.js) and cloned per kart. Geometries
 * and materials are shared between karts, exactly like the previous geometry
 * cache, so 8 karts cost one set of buffers.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeGlowTexture } from './textures.js';

const MODEL_URL = '/models/karts/buggy-battle.glb';
/**
 * Scale applied to the GLB. The model is ~3.64 m wide × ~3.27 m long × ~1.36 m
 * tall at unit scale, which matches the previous kart's wheel-to-wheel footprint,
 * so 1.0 keeps the world / camera / physics scale unchanged.
 */
const SCALE = 1.0;

// Names (case-insensitive) that mark environment geometry rather than the vehicle.
const ENV_NAMES = /ground|rock|pedestal|base|terrain/i;

// shared underglow texture; colour is tinted per skin at build time
const glowTex = makeGlowTexture(0.25);

const loader = new GLTFLoader();
let cached = null;   // { scene, box, center, bodyMat }
let loadPromise = null;

/** True when a mesh is environment geometry that must not be part of the kart. */
function isEnvironmentMesh(mesh) {
  if (!mesh.isMesh) return false;
  const name = (mesh.name || '').toLowerCase();
  if (ENV_NAMES.test(name)) return true;
  // Heuristic: a thin, wide horizontal slab (environment floor / pedestal).
  // The vehicle's wheels and body are chunky in all axes; a ground slab is
  // very thin vertically while spanning wide horizontally.
  const box = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3();
  box.getSize(size);
  return size.y < 0.4 && Math.max(size.x, size.z) > 2.0;
}

function prepareModel(scene) {
  // Strip environment geometry (ground / pedestal / rocks / base / terrain)
  // from the scene graph *before* measuring the vehicle.
  const toRemove = [];
  scene.traverse((o) => {
    if (o.isMesh && isEnvironmentMesh(o)) toRemove.push(o);
  });
  toRemove.forEach((o) => {
    if (o.parent) o.parent.remove(o);
  });

  const box = new THREE.Box3().setFromObject(scene);
  const center = new THREE.Vector3();
  box.getCenter(center);

  let bodyMat = null;
  scene.traverse((o) => {
    if (o.isMesh && o.material && !bodyMat) bodyMat = o.material;
  });

  return { scene, box, center, bodyMat };
}

async function ensureLoaded() {
  if (cached) return cached;
  if (!loadPromise) {
    loadPromise = (async () => {
      const gltf = await loader.loadAsync(MODEL_URL);
      cached = prepareModel(gltf.scene);
      return cached;
    })();
  }
  return loadPromise;
}

/** Preload the GLB once so every kart can be built synchronously afterwards. */
export async function loadKartModel() {
  return ensureLoaded();
}

/** Build one kart visual from the cached GLB. Synchronous — safe to call during a match step. */
export function buildKartMesh(skin) {
  if (!cached) {
    // Should not happen in production: main.js awaits loadKartModel() before
    // booting the engine. Fall back to a bare visual so nothing throws.
    return buildFallback(skin);
  }

  const { scene, box, center, bodyMat } = cached;

  // clone the cleaned master scene (geometries / materials are shared between karts)
  const model = new THREE.Group();
  scene.children.forEach((child) => model.add(child.clone()));

  const s = SCALE;
  // centre X/Z on the origin and lift so the lowest point (wheels) sits at y = 0
  model.position.set(-center.x * s, -box.min.y * s, -center.z * s);
  model.scale.setScalar(s);

  const root = new THREE.Group();
  root.add(model);

  const halfX = ((box.max.x - box.min.x) / 2) * s;
  const halfZ = ((box.max.z - box.min.z) / 2) * s;
  const wheelRadius = 0.24 * s;
  const wheelY = wheelRadius; // bottom of the tyre on the ground (y = 0)
  const frontZ = box.min.z * s; // −Z is forward ⇒ front wheels at the −Z end
  const rearZ = box.max.z * s;
  const flameY = 1.0 * s;
  const flameZ = box.max.z * s * 0.95; // boost flames at the rear (+Z)

  /* ── wheels ── */
  const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.3 * s, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x0d0d14, metalness: 0.15, roughness: 0.85,
  });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xbfcadd, metalness: 0.95, roughness: 0.18 });

  const wheels = [];
  const frontWheels = [];
  const wheelSpecs = [
    { x: -halfX * 0.9, z: frontZ, front: true },
    { x: halfX * 0.9, z: frontZ, front: true },
    { x: -halfX * 0.9, z: rearZ, front: false },
    { x: halfX * 0.9, z: rearZ, front: false },
  ];
  wheelSpecs.forEach((spec) => {
    const pivot = new THREE.Group();
    pivot.position.set(spec.x, wheelY, spec.z);

    const tire = new THREE.Mesh(wheelGeo, wheelMat);
    tire.castShadow = true;
    pivot.add(tire);

    const hub = new THREE.Mesh(new THREE.SphereGeometry(wheelRadius * 0.26, 10, 8), hubMat);
    pivot.add(hub);

    root.add(pivot);
    wheels.push(tire);
    if (spec.front) frontWheels.push(pivot);
  });

  /* ── underglow ── */
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(halfX * 2 * 1.4, halfZ * 2 * 1.4),
    new THREE.MeshBasicMaterial({
      map: glowTex, color: new THREE.Color(skin.glow), transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.06 * s;
  root.add(glow);

  /* ── boost flames (hidden until boosting) ── */
  const flameGeo = new THREE.ConeGeometry(0.3 * s, 1.0 * s, 12, 1, true);
  const flames = [];
  [-halfX * 0.35, halfX * 0.35].forEach((x) => {
    const flame = new THREE.Mesh(
      flameGeo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(skin.glow), transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(x, flameY, flameZ);
    flame.visible = false;
    root.add(flame);
    flames.push(flame);
  });

  root.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
  model.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  return {
    group: root,
    body: model,
    wheels,
    frontWheels,
    flames,
    glow,
    materials: { bodyMat },
    skin,
  };
}

/**
 * Minimal visual used only if the GLB failed to load (keeps every hook that
 * main.js / engine.js read so a missing model never breaks the frame).
 */
function buildFallback(skin) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.5, 3.0),
    new THREE.MeshStandardMaterial({ color: skin.body, metalness: 0.45, roughness: 0.34 }),
  );
  body.position.set(0, 0.66, 0.1);
  body.castShadow = true;
  group.add(body);

  const wheels = [];
  const frontWheels = [];
  [[-1.08, -1.35], [1.08, -1.35], [-1.12, 1.32], [1.12, 1.32]].forEach(([x, z], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.55, z);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.44, 20));
    tire.rotation.z = Math.PI / 2;
    pivot.add(tire);
    group.add(pivot);
    wheels.push(tire);
    if (i < 2) frontWheels.push(pivot);
  });

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 4.8),
    new THREE.MeshBasicMaterial({ color: skin.glow, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.06;
  group.add(glow);

  const flames = [];
  [-0.28, 0.28].forEach((x) => {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.7, 12));
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(x, 1.0, 2.1);
    flame.visible = false;
    group.add(flame);
    flames.push(flame);
  });

  return { group, body, wheels, frontWheels, flames, glow, materials: { bodyMat: body.material }, skin };
}
