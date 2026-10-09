/**
 * Super Racers — Three.js engine.
 *
 * Responsibilities
 *  • one WebGLRenderer shared by two completely different scenes:
 *      1. `menuScene`  — the rotating showroom (pre-game)
 *      2. `arenaScene` — the Neon Deathmatch arena (in-game)
 *  • the HARD scene transition between them (dispose + rebuild, camera reset)
 *  • a pooled particle/FX layer (sparks, smoke, explosions, tracers, rings)
 *  • the third-person chase camera rig with orbit, zoom, look-behind & shake
 *  • optional bloom post-processing
 *
 * The game loop itself lives in main.js; the engine exposes update()/render().
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { buildKartMesh } from '../graphics/karts.js';
import { buildArenaObjects, THEMES, ARENA_HALF } from './arena.js';
import {
  makeGlowTexture, makeSmokeTexture, makeGridTexture, makeRingTexture, makeSkyTexture,
} from '../graphics/textures.js';

const QUALITY = {
  low: { pixelRatio: 1, shadows: false, particles: 380, bloom: false },
  medium: { pixelRatio: 1.5, shadows: true, particles: 900, bloom: true },
  high: { pixelRatio: 2, shadows: true, particles: 1600, bloom: true },
};

/* ═══════════════════════════════════════════════════════════════════════════
   PARTICLE POOL — one draw call for all sparks / one for all smoke
   ═══════════════════════════════════════════════════════════════════════════ */
const PARTICLE_VERT = /* glsl */`
  attribute float psize;
  attribute float palpha;
  attribute vec3 pcolor;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = pcolor;
    vAlpha = palpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = psize * (320.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;
const PARTICLE_FRAG = /* glsl */`
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    vec4 c = vec4(vColor, vAlpha) * t;
    if (c.a < 0.01) discard;
    gl_FragColor = c;
  }
`;

class ParticlePool {
  constructor(scene, capacity, texture, additive = true) {
    this.capacity = capacity;
    this.count = 0;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.geo = geo;
    scene.add(this.points);
  }

  spawn({ x, y, z, vx = 0, vy = 0, vz = 0, life = 0.6, size = 1, color = 0xffffff, gravity = 0, drag = 1.5, grow = 0 }) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    const c = new THREE.Color(color);
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.size[i] = size;
    this.alpha[i] = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = gravity;
    this.drag[i] = drag;
    this.grow[i] = grow;
  }

  clear() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const last = --this.count;
        if (i !== last) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[last * 3 + k];
            this.vel[i * 3 + k] = this.vel[last * 3 + k];
            this.col[i * 3 + k] = this.col[last * 3 + k];
          }
          this.size[i] = this.size[last];
          this.alpha[i] = this.alpha[last];
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.grav[i] = this.grav[last];
          this.drag[i] = this.drag[last];
          this.grow[i] = this.grow[last];
        }
        i--;
        continue;
      }
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= damp;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * damp - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= damp;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = t > 0.75 ? (1 - t) * 4 : t / 0.75;
    }
    this.geo.setDrawRange(0, this.count);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.psize.needsUpdate = true;
    this.geo.attributes.palpha.needsUpdate = true;
  }
}

/**
 * Pure chase-camera offset math (exported so it can be unit tested).
 *
 * ⚠️  Forward is (−sin yaw, 0, −cos yaw), so at yaw = 0 the kart drives toward
 *     −Z and the camera must sit at +Z to look at its back.
 */
export function chaseCameraOffset(yaw, orbitYaw, pitch, distance, lookBehind = false) {
  const a = yaw + orbitYaw + (lookBehind ? Math.PI : 0);
  const flat = Math.cos(pitch) * distance;
  return {
    x: Math.sin(a) * flat,
    y: Math.sin(pitch) * distance * 0.92,
    z: Math.cos(a) * flat,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENGINE
   ═══════════════════════════════════════════════════════════════════════════ */
export class Engine {
  constructor({ container, profile, callbacks = {} }) {
    this.container = container;
    this.profile = profile;
    this.callbacks = callbacks;
    this.quality = QUALITY[profile.settings.quality] || QUALITY.medium;

    this.sprites = [];
    this.lightPool = [];
    this.rings = [];
    this.time = 0;

    this.cameraMode = 'showroom';
    this.rig = {
      yaw: 0, targetYaw: 0, pitch: 0.28, distance: 11,
      orbitYaw: 0, orbitPitch: 0, lookBehind: 0,
      shake: 0, shakeDecay: 1.6,
      pos: new THREE.Vector3(0, 6, 18),
      lookAt: new THREE.Vector3(),
      fov: 74, targetFov: 74,
    };

    this.initRenderer();
    this.initCommon();
    this.buildMenuScene();
  }

  /* ── renderer ──────────────────────────────────────────────── */
  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality.pixelRatio > 1, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(this.rig.fov, window.innerWidth / window.innerHeight, 0.3, 1200);
    this.camera.position.set(0, 6, 18);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setSize(w, h);
      if (this.bloomPass) this.bloomPass.resolution.set(w, h);
    }
  }

  /* ── shared assets / pools ─────────────────────────────────── */
  initCommon() {
    this.textures = {
      glow: makeGlowTexture(0.3),
      smoke: makeSmokeTexture(),
      ring: makeRingTexture('#22e1ff'),
    };

    this.menuScene = null;
    this.arenaScene = null;
    this.scene = null;
    this.arenaApi = null;

    // sprite pool (explosions / flashes)
    this.spritePool = [];
    for (let i = 0; i < 40; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.textures.glow, color: 0xffffff, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
      }));
      sprite.visible = false;
      this.spritePool.push({ sprite, life: 0, maxLife: 1, scale: 1, grow: 0, spawned: false });
    }

    // light pool for explosion flashes
    for (let i = 0; i < 6; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 40, 2);
      this.lightPool.push({ light, life: 0, maxLife: 0.2, base: 0, spawned: false });
    }
  }

  createPools() {
    // release the previous pools (each scene gets fresh, scene-attached pools)
    [this.sparks, this.smoke].forEach((pool) => {
      if (!pool || !pool.points) return;
      pool.points.geometry?.dispose?.();
      pool.points.material?.dispose?.();
    });
    const cap = Math.max(200, Math.round(this.quality.particles * 0.62));
    this.sparks = new ParticlePool(this.scene, cap, this.textures.glow, true);
    this.smoke = new ParticlePool(this.scene, Math.round(cap * 0.55), this.textures.smoke, false);

    // sprite + light pools are shared objects, so re-parenting them onto the
    // freshly built scene is enough (three removes them from the old parent).
    this.spritePool.forEach((s) => this.scene.add(s.sprite));
    this.lightPool.forEach((l) => this.scene.add(l.light));
  }

  /* ── post-processing ───────────────────────────────────────── */
  setupComposer() {
    const wantBloom = this.profile.settings.bloom && this.quality.bloom;
    if (!wantBloom) {
      if (this.composer) { this.composer.dispose?.(); this.composer = null; this.bloomPass = null; }
      return;
    }
    if (this.composer) { this.composer.dispose?.(); }
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.62, 0.75, 0.78,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  /* ═══════════════════════════════════════════════════════════
     SCENE 1 — MENU SHOWROOM
     ═══════════════════════════════════════════════════════════ */
  buildMenuScene() {
    this.disposeMenuScene();
    this.disposeArena();
    this.scene = new THREE.Scene();
    this.menuScene = this.scene;
    this.scene.fog = new THREE.FogExp2(0x07021a, 0.018);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(300, 20, 14),
      new THREE.MeshBasicMaterial({ map: makeSkyTexture('#231058', '#05010f'), side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    this.scene.add(sky);

    // reflective studio floor
    const gridTex = makeGridTexture({ bg: '#0a0520', line: '#22e1ff', accent: '#ff2bd6', cell: 128 });
    gridTex.repeat.set(8, 8);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(90, 64),
      new THREE.MeshStandardMaterial({
        map: gridTex, emissive: new THREE.Color(0x22e1ff), emissiveMap: gridTex,
        emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.35,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // pedestal
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(4.6, 5.2, 0.7, 48),
      new THREE.MeshStandardMaterial({ color: 0x120a33, metalness: 0.85, roughness: 0.25, emissive: 0x1b0a44, emissiveIntensity: 0.6 }),
    );
    pedestal.position.y = 0.35;
    pedestal.receiveShadow = true;
    this.scene.add(pedestal);

    const padRing = new THREE.Mesh(
      new THREE.TorusGeometry(5.4, 0.09, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x22e1ff }),
    );
    padRing.rotation.x = Math.PI / 2;
    padRing.position.y = 0.08;
    this.scene.add(padRing);

    const padRing2 = new THREE.Mesh(
      new THREE.TorusGeometry(7.2, 0.06, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xff2bd6, transparent: true, opacity: 0.7 }),
    );
    padRing2.rotation.x = Math.PI / 2;
    padRing2.position.y = 0.05;
    this.scene.add(padRing2);

    // holographic rings floating around the kart
    this.menuRings = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(8 + i * 3, 0.05, 6, 72),
        new THREE.MeshBasicMaterial({
          color: i % 2 ? 0xff2bd6 : 0x22e1ff, transparent: true, opacity: 0.35,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      ring.rotation.x = Math.PI / 2.4;
      ring.position.y = 3 + i * 1.4;
      this.scene.add(ring);
      this.menuRings.push(ring);
    }

    // light shafts (fake volumetrics)
    [0x22e1ff, 0xff2bd6, 0x8a5cff].forEach((color, i) => {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(4.5, 34, 18, 1, true),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      cone.position.set(Math.cos(i * 2.1) * 12, 17, Math.sin(i * 2.1) * 12);
      cone.rotation.z = Math.cos(i * 2.1) * 0.25;
      cone.rotation.x = -Math.sin(i * 2.1) * 0.25;
      this.scene.add(cone);
    });

    // floating dust
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(420 * 3);
    for (let i = 0; i < 420; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 90;
      dustPos[i * 3 + 1] = Math.random() * 26;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 90;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      map: this.textures.glow, color: 0x9fd8ff, size: 1.4, transparent: true,
      opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.scene.add(dust);
    this.menuDust = dust;

    /* lights */
    this.scene.add(new THREE.AmbientLight(0x3a2a7a, 0.7));
    const key = new THREE.SpotLight(0xffffff, 420, 60, 0.62, 0.5, 2);
    key.position.set(6, 22, 10);
    key.target.position.set(0, 1, 0);
    key.castShadow = this.quality.shadows;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key, key.target);

    const rimA = new THREE.PointLight(0x22e1ff, 220, 46, 2);
    rimA.position.set(-11, 6, -8);
    this.scene.add(rimA);
    const rimB = new THREE.PointLight(0xff2bd6, 200, 46, 2);
    rimB.position.set(11, 5.5, 8);
    this.scene.add(rimB);
    const rimC = new THREE.PointLight(0x8a5cff, 130, 40, 2);
    rimC.position.set(0, 12, -14);
    this.scene.add(rimC);
    this.menuLights = { key, rimA, rimB, rimC };

    /* the showroom kart */
    this.menuKart = buildKartMesh(this.profile.skin);
    this.menuKart.group.position.y = 0.7;
    this.scene.add(this.menuKart.group);

    this.createPools();
    this.cameraMode = 'showroom';
    this.rig.orbitYaw = 0;
    this.rig.orbitPitch = 0;
    this.rig.distance = 13.5;
    this.setupComposer();
  }

  /** Live-update the showroom kart when the player picks another skin. */
  updateMenuSkin(skin) {
    if (!this.menuScene) return;
    if (this.menuKart) {
      this.menuScene.remove(this.menuKart.group);
      this.menuKart.group.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
    }
    this.menuKart = buildKartMesh(skin);
    this.menuKart.group.position.y = 0.7;
    this.menuScene.add(this.menuKart.group);
    // retire pools onto the fresh scene graph (they live in the same scene)
    if (this.menuLights) {
      this.menuLights.rimA.color.set(skin.glow);
      this.menuLights.rimB.color.set(skin.accent);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     SCENE 2 — ARENA (the hard transition)
     ═══════════════════════════════════════════════════════════ */
  buildArenaScene(themeId, world) {
    this.disposeMenuScene();
    this.disposeArena();

    this.scene = new THREE.Scene();
    this.arenaScene = this.scene;
    this.world = world;

    this.arenaApi = buildArenaObjects(this.scene, world, themeId);
    this.createPools();
    this.setupComposer();

    this.cameraMode = 'chase';
    this.rig.orbitYaw = 0;
    this.rig.orbitPitch = 0;
    this.rig.distance = 11;
    this.rig.shake = 0;
    this.rig.pos.set(0, 8, 20);
    this.camera.position.set(0, 8, 20);
    this.camera.fov = 76;
    this.rig.fov = 76;
    this.camera.updateProjectionMatrix();

    return this.arenaApi;
  }

  disposeMenuScene() {
    if (!this.menuScene) return;
    this.detachPools();
    disposeScene(this.menuScene);
    this.menuScene = null;
    this.menuKart = null;
    this.menuRings = null;
  }

  disposeArena() {
    if (!this.arenaScene) return;
    this.detachPools();
    disposeScene(this.arenaScene);
    this.arenaScene = null;
    this.arenaApi = null;
  }

  detachPools() {
    if (!this.scene) return;
    if (this.sparks) this.scene.remove(this.sparks.points);
    if (this.smoke) this.scene.remove(this.smoke.points);
    this.spritePool.forEach((s) => this.scene.remove(s.sprite));
    this.lightPool.forEach((l) => this.scene.remove(l.light));
  }

  returnToMenu() {
    this.buildMenuScene();
  }

  /* ═══════════════════════════════════════════════════════════
     FRAME
     ═══════════════════════════════════════════════════════════ */
  update(dt, camTarget = null) {
    this.time += dt;
    if (this.sparks) this.sparks.update(dt);
    if (this.smoke) this.smoke.update(dt);
    this.updateSprites(dt);
    this.updateLights(dt);
    this.updateRings(dt);

    if (this.cameraMode === 'showroom') this.updateShowroomCamera(dt, camTarget);
    else if (camTarget && camTarget.kart) this.updateChaseCamera(dt, camTarget);

    // shake decay
    if (this.rig.shake > 0) {
      this.rig.shake = Math.max(0, this.rig.shake - dt * this.rig.shakeDecay);
    }
  }

  updateShowroomCamera(dt, camTarget) {
    const kart = this.menuKart;
    if (kart) {
      kart.group.rotation.y += dt * 0.35;
      // wheels idle spin
      kart.wheels.forEach((w, i) => {
        w.rotation.x += dt * (i < 2 ? 1.2 : 1.2);
      });
      const bob = Math.sin(this.time * 1.6) * 0.06;
      kart.group.position.y = 0.7 + bob;
      kart.group.rotation.z = Math.sin(this.time * 0.9) * 0.012;
      // underglow pulse
      if (kart.glow) kart.glow.material.opacity = 0.4 + Math.sin(this.time * 2.4) * 0.16;
      const flameOn = Math.sin(this.time * 0.8) > 0.55;
      kart.flames.forEach((f, i) => {
        f.visible = flameOn;
        const s = 0.7 + Math.sin(this.time * 18 + i) * 0.3;
        f.scale.set(s, s * (1 + Math.sin(this.time * 12) * 0.2), s);
      });
    }

    if (this.menuRings) {
      this.menuRings.forEach((r, i) => {
        r.rotation.z += dt * (0.2 + i * 0.12);
        r.position.y = 3 + i * 1.4 + Math.sin(this.time * 1.1 + i) * 0.4;
      });
    }
    if (this.menuDust) this.menuDust.rotation.y += dt * 0.03;

    // auto-orbit unless the player is dragging
    if (camTarget?.dragging) {
      this.rig.orbitYaw -= camTarget.lookDelta.x * 0.006 * this.profile.settings.sensitivity;
      this.rig.orbitPitch = THREE.MathUtils.clamp(
        this.rig.orbitPitch + camTarget.lookDelta.y * 0.004 * this.profile.settings.sensitivity, -0.35, 0.7,
      );
    } else {
      this.rig.orbitYaw += dt * 0.12;
    }
    if (camTarget?.zoom) {
      this.rig.distance = THREE.MathUtils.clamp(this.rig.distance + camTarget.zoom * 1.1, 7, 24);
    }

    const focus = new THREE.Vector3(0, 1.6, 0);
    const dist = this.rig.distance;
    const pitch = 0.22 + this.rig.orbitPitch;
    const yaw = this.rig.orbitYaw + Math.PI;
    const desired = new THREE.Vector3(
      focus.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      focus.y + Math.sin(pitch) * dist,
      focus.z + Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    this.camera.position.lerp(desired, 1 - Math.exp(-6 * dt));
    this.camera.lookAt(focus.x, focus.y + 0.15 + this.rig.orbitPitch * -1.2, focus.z);

    if (Math.abs(this.camera.fov - 62) > 0.05) {
      this.camera.fov += (62 - this.camera.fov) * Math.min(1, 4 * dt);
      this.camera.updateProjectionMatrix();
    }

    // light show
    if (this.menuLights) {
      this.menuLights.rimA.intensity = 200 + Math.sin(this.time * 2.1) * 60;
      this.menuLights.rimB.intensity = 180 + Math.sin(this.time * 1.7 + 1) * 60;
    }
  }

  /**
   * Third-person chase camera.
   * @param {object} t { kart, speedRatio, boosting, lookBehind, lookDelta, zoom, dragging }
   */
  updateChaseCamera(dt, t) {
    const kart = t.kart;
    const rig = this.rig;
    const sens = this.profile.settings.sensitivity;

    // orbit input (mouse drag)
    if (t.lookDelta) {
      rig.orbitYaw -= t.lookDelta.x * 0.0045 * sens;
      rig.orbitPitch = THREE.MathUtils.clamp(
        rig.orbitPitch + t.lookDelta.y * 0.003 * sens * (this.profile.settings.invertY ? -1 : 1),
        -0.45, 0.85,
      );
    }
    if (t.zoom) rig.distance = THREE.MathUtils.clamp(rig.distance + t.zoom * 1.2, 6, 22);

    // recentre the orbit smoothly while driving forward
    if (!t.dragging && Math.abs(t.speedRatio) > 0.05) {
      const recentre = rig.orbitYaw * (1 - Math.exp(-0.9 * dt * (0.4 + t.speedRatio)));
      rig.orbitYaw -= recentre;
      rig.orbitPitch *= 1 - Math.exp(-0.6 * dt);
    }

    const behind = t.lookBehind ? Math.PI : 0;
    // forward is −Z at yaw 0 ⇒ the rig angle equals the kart yaw so the camera
    // ends up behind the kart (looking at its back), not in front of it.
    rig.targetYaw = kart.yaw + rig.orbitYaw + behind;
    let delta = rig.targetYaw - rig.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    rig.yaw += delta * Math.min(1, (t.lookBehind ? 7 : 6.5) * dt);

    const speedZoom = 1 + Math.min(0.34, t.speedRatio * 0.3) + (t.boosting ? 0.1 : 0);
    const dist = rig.distance * speedZoom;
    const pitch = 0.24 + rig.orbitPitch + t.speedRatio * 0.03;

    const focus = new THREE.Vector3(
      kart.position.x, kart.position.y + 1.55, kart.position.z,
    );
    const off = chaseCameraOffset(0, rig.yaw, pitch, dist, false);
    const desired = new THREE.Vector3(focus.x + off.x, focus.y + off.y, focus.z + off.z);
    // keep the camera inside the arena walls
    const limit = ARENA_HALF + 12;
    desired.x = THREE.MathUtils.clamp(desired.x, -limit, limit);
    desired.z = THREE.MathUtils.clamp(desired.z, -limit, limit);
    desired.y = Math.max(2.2, desired.y);

    rig.pos.lerp(desired, 1 - Math.exp(-9 * dt));

    // shake
    const shakeAmt = rig.shake * this.profile.settings.shake;
    const jitter = shakeAmt > 0.001
      ? new THREE.Vector3(
        (Math.random() - 0.5) * shakeAmt * 1.6,
        (Math.random() - 0.5) * shakeAmt * 1.3,
        (Math.random() - 0.5) * shakeAmt * 1.6,
      )
      : null;

    this.camera.position.copy(rig.pos);
    if (jitter) this.camera.position.add(jitter);

    rig.lookAt.set(
      kart.position.x + (t.lookBehind ? 0 : 0),
      kart.position.y + 1.7 + (jitter ? jitter.y * 0.4 : 0),
      kart.position.z,
    );
    this.camera.lookAt(rig.lookAt);
    this.camera.rotation.z += (kart.steer || 0) * 0.035 * (this.profile.settings.shake > 0 ? 1 : 0);

    // dynamic FOV = speed sensation
    rig.targetFov = 74 + t.speedRatio * 14 + (t.boosting ? 8 : 0);
    rig.fov += (rig.targetFov - rig.fov) * Math.min(1, 5 * dt);
    this.camera.fov = rig.fov;
    this.camera.updateProjectionMatrix();
  }

  updateSprites(dt) {
    for (const s of this.spritePool) {
      if (!s.spawned) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.spawned = false;
        s.sprite.visible = false;
        continue;
      }
      const t = 1 - s.life / s.maxLife;
      s.sprite.scale.setScalar(s.scale * (1 + s.grow * t));
      s.sprite.material.opacity = Math.pow(1 - t, 1.6);
    }
  }

  updateLights(dt) {
    for (const l of this.lightPool) {
      if (!l.spawned) continue;
      l.life -= dt;
      if (l.life <= 0) { l.spawned = false; l.light.intensity = 0; continue; }
      const t = l.life / l.maxLife;
      l.light.intensity = l.base * t * t;
    }
  }

  updateRings(dt) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      const t = 1 - r.life / r.maxLife;
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        this.rings.splice(i, 1);
        continue;
      }
      r.life -= dt;
      const scale = r.scale * (0.15 + t * 0.95);
      r.mesh.scale.set(scale, scale, scale);
      r.mesh.material.opacity = Math.max(0, 0.85 * (1 - t));
    }
  }

  render() {
    if (!this.scene) return;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.renderer.info.reset?.();
  }

  /* ═══════════════════════════════════════════════════════════
     FX INTERFACE (used by combat / game)
     ═══════════════════════════════════════════════════════════ */
  spawnSprite(pos, { color = 0xffffff, scale = 3, life = 0.5, grow = 1.6 }) {
    const slot = this.spritePool.find((s) => !s.spawned);
    if (!slot) return;
    slot.spawned = true;
    slot.life = life;
    slot.maxLife = life;
    slot.scale = scale;
    slot.grow = grow;
    slot.sprite.position.copy(pos);
    slot.sprite.material.color.set(color);
    slot.sprite.material.opacity = 1;
    slot.sprite.scale.setScalar(scale);
    slot.sprite.visible = true;
  }

  flashLight(pos, color, intensity = 300, life = 0.25) {
    const slot = this.lightPool.find((l) => !l.spawned);
    if (!slot) return;
    slot.spawned = true;
    slot.life = life;
    slot.maxLife = life;
    slot.base = intensity;
    slot.light.position.copy(pos);
    slot.light.color.set(color);
    slot.light.intensity = intensity;
  }

  sparks(pos, { count = 12, color = 0xffd166, speed = 10, up = false, spread = 1 } = {}) {
    if (!this.sparks) return;
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, up ? Math.random() * 0.9 : Math.random() - 0.2, Math.random() - 0.5).normalize();
      const sp = speed * (0.35 + Math.random() * 0.9) * spread;
      this.sparks.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: dir.x * sp, vy: dir.y * sp + (up ? 3 : 1.5), vz: dir.z * sp,
        life: 0.35 + Math.random() * 0.5, size: 0.5 + Math.random() * 0.75,
        color, gravity: 14, drag: 1.1,
      });
    }
  }

  smoke(pos, { count = 6, scale = 1, color = 0x8a8a9a, vel = null } = {}) {
    if (!this.smoke) return;
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7 + 0.1, Math.random() - 0.5).normalize();
      const sp = 2.2 * (0.4 + Math.random()) * scale;
      this.smoke.spawn({
        x: pos.x + dir.x * 0.6, y: pos.y + dir.y * 0.4, z: pos.z + dir.z * 0.6,
        vx: (vel?.x || 0) * 0.3 + dir.x * sp,
        vy: (vel?.y || 0) * 0.3 + dir.y * sp * 0.6,
        vz: (vel?.z || 0) * 0.3 + dir.z * sp,
        life: 0.6 + Math.random() * 0.9, size: 1.6 * scale + Math.random() * 1.4 * scale,
        color, gravity: -1.2, drag: 1.6, grow: 2.2 * scale,
      });
    }
  }

  explosion(pos, { color = 0xffa040, scale = 1 } = {}) {
    this.spawnSprite(pos, { color, scale: 3.4 * scale, life: 0.42, grow: 2.4 });
    this.spawnSprite(pos, { color: 0xffffff, scale: 1.5 * scale, life: 0.2, grow: 3.2 });
    this.sparks(pos, { count: Math.round(22 * scale), color, speed: 20 * scale, spread: 1.2 });
    this.sparks(pos, { count: Math.round(8 * scale), color: 0xfff0c0, speed: 30 * scale });
    this.smoke(pos, { count: Math.round(7 * scale), scale: 1.1 * scale, color: 0x555063 });
    this.flashLight(pos, color, 320 * scale, 0.32);
    this.shake(0.5 * scale, 0.3);
  }

  kartExplosion(kart) {
    const pos = kart.position.clone().setY(1.1);
    this.explosion(pos, { color: 0xff7a1a, scale: 1.5 });
    this.explosion(pos.clone().add(new THREE.Vector3(0, 0.6, 0)), { color: 0xffd166, scale: 1.1 });
    const debrisColor = kart.mesh ? kart.mesh.materials.bodyMat.color.getHex() : 0xff8844;
    this.sparks(pos, { count: 40, color: debrisColor, speed: 22, spread: 1.4 });
    this.smoke(pos, { count: 12, scale: 1.6, color: 0x40384a });
    this.flashLight(pos, 0xffa040, 420, 0.45);
    this.shake(1.2, 0.55);
    this.damageNumber(pos.clone().setY(3), 'DESTROYED', 'crit');
  }

  boostBurst(kart) {
    const back = kart.position.clone().addScaledVector(kart.forwardVector, -2.4).setY(0.8);
    this.sparks(back, { count: 22, color: 0xffb060, speed: 16, spread: 1.1 });
    this.spawnSprite(back, { color: 0xff7a1a, scale: 2.2, life: 0.3, grow: 1.6 });
  }

  muzzleFlash(pos, dir, color) {
    this.spawnSprite(pos, { color, scale: 1.3, life: 0.13, grow: 1.4 });
    this.sparks(pos, { count: 5, color, speed: 10 });
  }

  shieldUp(kart) {
    const pos = kart.position.clone().setY(1.1);
    this.spawnSprite(pos, { color: 0x22e1ff, scale: 4.2, life: 0.5, grow: 0.6 });
    this.sparks(pos, { count: 20, color: 0x22e1ff, speed: 8, up: true });
  }

  shieldHit(pos, color = 0x22e1ff) {
    this.spawnSprite(pos, { color, scale: 2.6, life: 0.25, grow: 1.4 });
    this.sparks(pos, { count: 6, color, speed: 9 });
  }

  shockRing(pos, { color = 0x22e1ff, scale = 14, duration = 0.55 } = {}) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1, 64),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(pos);
    mesh.position.y = 0.14;
    this.scene.add(mesh);
    this.rings.push({ mesh, life: duration, maxLife: duration, scale });
  }

  playerHurt(amount, source) {
    this.callbacks.onHurt?.(amount, source);
    this.shake(Math.min(0.9, 0.25 + amount / 60), 0.35);
  }

  damageNumber(worldPos, text, kind = '') {
    const screen = this.projectToScreen(worldPos);
    if (!screen.visible) return;
    this.callbacks.onDamageNumber?.(screen, text, kind);
  }

  hitMarker(lethal) {
    this.callbacks.onHitMarker?.(lethal);
  }

  shake(amount) {
    this.rig.shake = Math.min(3.2, this.rig.shake + amount);
  }

  projectToScreen(vec3) {
    const v = vec3.clone().project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      visible: v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2,
    };
  }

  /* ── builders handed to the combat system ─────────────────── */
  makeCrateBuilder(themeId) {
    const theme = THEMES[themeId] || THEMES.neon;
    const panelTex = makeRingTexture(theme.crateAccent);
    return () => {
      const group = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 2.1, 2.1),
        new THREE.MeshStandardMaterial({
          color: 0x161033, metalness: 0.6, roughness: 0.4,
          emissive: new THREE.Color(theme.crateAccent), emissiveIntensity: 0.45,
        }),
      );
      core.castShadow = true;
      group.add(core);

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(2.28, 2.28, 2.28),
        new THREE.MeshBasicMaterial({ color: theme.crateAccent, wireframe: true, transparent: true, opacity: 0.85 }),
      );
      group.add(frame);

      const holo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: panelTex, color: theme.crateAccent, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      holo.scale.setScalar(5.4);
      group.add(holo);

      group.userData.spin = true;
      return group;
    };
  }

  buildMine(color = 0xffc23d) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0x1a1636, metalness: 0.8, roughness: 0.3, emissive: color, emissiveIntensity: 1.2 }),
    );
    group.add(body);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const spike = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.7),
        new THREE.MeshStandardMaterial({ color: 0x9aa4c0, metalness: 0.9, roughness: 0.2 }),
      );
      spike.position.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35);
      spike.rotation.y = -a;
      group.add(spike);
    }
    const blink = new THREE.PointLight(color, 30, 12, 2);
    blink.position.y = 0.6;
    group.add(blink);
    return group;
  }

  buildMissile(color = 0xff7a1a) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xdfe6f5, metalness: 0.85, roughness: 0.25,
      emissive: color, emissiveIntensity: 0.35,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.1, 10), bodyMat);
    body.rotation.x = Math.PI / 2;
    group.add(body);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 10), new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 1.8, roughness: 0.3,
    }));
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.74;
    group.add(tip);
    [-1, 1].forEach((s) => {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.3), bodyMat);
      fin.position.set(0, 0, 0.52);
      fin.rotation.z = s * 0.6;
      group.add(fin);
    });
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.textures.glow, color, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    flame.scale.setScalar(1.5);
    flame.position.z = 0.85;
    group.add(flame);
    return group;
  }

  dispose() {
    this.disposeMenuScene();
    this.disposeArena();
    this.composer?.dispose?.();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */
function disposeScene(scene) {
  scene.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose?.();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    mats.forEach((m) => m.dispose?.());
  });
  scene.clear?.();
}

export { QUALITY };
