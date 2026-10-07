import * as THREE from 'three';

export const ARENA_SIZE = 100;
export const ARENA_HALF_SIZE = ARENA_SIZE / 2;
export const WALL_THICKNESS = 1.2;
export const WALL_INNER_EDGE = ARENA_HALF_SIZE - WALL_THICKNESS;
export const KART_WALL_CLEARANCE = 1.35;
export const ARENA_DRIVE_LIMIT = WALL_INNER_EDGE - KART_WALL_CLEARANCE;
export const CRATE_RESPAWN_SECONDS = 5;

const CRATE_POSITIONS = [
  { x: 0, z: 35 },
  { x: -31, z: 30 },
  { x: 31, z: 26 },
  { x: -39, z: 2 },
  { x: 39, z: -7 },
  { x: -24, z: -35 },
  { x: 20, z: -36 },
  { x: 0, z: -7 }
];

function makeQuestionTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '900 108px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 8;
  context.strokeStyle = '#03202c';
  context.fillStyle = '#ffffff';
  context.strokeText('?', 64, 66);
  context.fillText('?', 64, 66);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addNeonWall(group, { x, z, width, depth }, color) {
  const wallHeight = 4.8;
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x101e32,
    roughness: 0.34,
    metalness: 0.72
  });
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(width, wallHeight, depth),
    wallMaterial
  );
  wall.position.set(x, wallHeight / 2, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  group.add(wall);

  const railMaterial = new THREE.MeshBasicMaterial({ color });
  const railHeight = 0.14;
  const railWidth = width > depth ? width : depth;
  const railDepth = width > depth ? 0.34 : 0.34;
  const upperRail = new THREE.Mesh(
    new THREE.BoxGeometry(width > depth ? railWidth : railDepth, railHeight, width > depth ? railDepth : railWidth),
    railMaterial
  );
  upperRail.position.set(x, wallHeight - 0.12, z);
  group.add(upperRail);

  const lowerRail = new THREE.Mesh(
    new THREE.BoxGeometry(width > depth ? railWidth : railDepth, 0.1, width > depth ? railDepth : railWidth),
    railMaterial
  );
  lowerRail.position.set(x, 0.28, z);
  group.add(lowerRail);
}

function createPickupEffect(parent, x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0.25, z);
  group.visible = false;
  parent.add(group);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x8afff4,
    transparent: true,
    opacity: 0
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.055, 8, 32), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const particleMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe47a,
    transparent: true,
    opacity: 0
  });
  const particleGeometry = new THREE.IcosahedronGeometry(0.12, 0);
  const particles = Array.from({ length: 8 }, (_, index) => {
    const mesh = new THREE.Mesh(particleGeometry, particleMaterial.clone());
    const angle = (index / 8) * Math.PI * 2;
    mesh.userData.velocity = new THREE.Vector3(Math.cos(angle), 0.7 + (index % 3) * 0.18, Math.sin(angle));
    group.add(mesh);
    return mesh;
  });

  return { group, ring, particles, elapsed: Infinity, duration: 0.55 };
}

function createMysteryCrate(parent, position, index, questionTexture) {
  const root = new THREE.Group();
  root.position.set(position.x, 0, position.z);
  parent.add(root);

  const visuals = new THREE.Group();
  visuals.position.y = 1.12;
  root.add(visuals);

  const hueColors = [0x38f4ff, 0xff42c8, 0x9b7bff, 0xffcb49];
  const glowColor = hueColors[index % hueColors.length];
  const boxMaterial = new THREE.MeshStandardMaterial({
    color: 0x18253b,
    emissive: glowColor,
    emissiveIntensity: 0.82,
    roughness: 0.24,
    metalness: 0.62
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.42, 1.42, 1.42), boxMaterial);
  box.castShadow = true;
  box.receiveShadow = true;
  visuals.add(box);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(box.geometry),
    new THREE.LineBasicMaterial({ color: 0xe7ffff, transparent: true, opacity: 0.95 })
  );
  visuals.add(outline);

  const emblemMaterial = new THREE.MeshBasicMaterial({
    map: questionTexture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const emblem = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), emblemMaterial);
  emblem.position.set(0, 0, 0.72);
  visuals.add(emblem);

  const baseRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.94, 0.045, 8, 40),
    new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.8 })
  );
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = 0.045;
  root.add(baseRing);

  const effect = createPickupEffect(parent, position.x, position.z);

  return {
    id: `mystery-crate-${index + 1}`,
    x: position.x,
    z: position.z,
    radius: 2.55,
    root,
    visuals,
    box,
    baseRing,
    effect,
    phase: index * 0.72,
    active: true,
    respawnRemaining: 0
  };
}

/**
 * Procedural 100 x 100 neon battle arena and its reusable item pickups.
 * Physics is intentionally handled by the lightweight arcade kart controller.
 */
export class NeonArena {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'neon-arena';
    this.size = ARENA_SIZE;
    this.halfSize = ARENA_HALF_SIZE;
    this.drivableLimit = ARENA_DRIVE_LIMIT;
    this.bounds = {
      size: ARENA_SIZE,
      halfSize: ARENA_HALF_SIZE,
      drivableLimit: ARENA_DRIVE_LIMIT
    };
    this.time = 0;
    this.crates = [];

    this.buildGround();
    this.buildBoundary();
    this.buildCenterMarkings();
    this.buildCrates();

    this.group.visible = false;
  }

  buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE),
      new THREE.MeshStandardMaterial({
        color: 0x071321,
        roughness: 0.72,
        metalness: 0.24
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.035;
    ground.receiveShadow = true;
    this.group.add(ground);

    const grid = new THREE.GridHelper(ARENA_SIZE, 50, 0x20dafa, 0x17324b);
    grid.position.y = 0.012;
    grid.material.transparent = true;
    grid.material.opacity = 0.64;
    grid.material.depthWrite = false;
    this.group.add(grid);
  }

  buildBoundary() {
    const edge = ARENA_HALF_SIZE - WALL_THICKNESS / 2;
    const wallConfigs = [
      { x: 0, z: -edge, width: ARENA_SIZE, depth: WALL_THICKNESS },
      { x: 0, z: edge, width: ARENA_SIZE, depth: WALL_THICKNESS },
      { x: -edge, z: 0, width: WALL_THICKNESS, depth: ARENA_SIZE },
      { x: edge, z: 0, width: WALL_THICKNESS, depth: ARENA_SIZE }
    ];
    const colors = [0x16e0ff, 0xff42c8, 0xff42c8, 0x16e0ff];

    wallConfigs.forEach((config, index) => {
      addNeonWall(this.group, config, colors[index]);
    });
  }

  buildCenterMarkings() {
    const outerRing = new THREE.Mesh(
      new THREE.TorusGeometry(12, 0.075, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0x1f718c, transparent: true, opacity: 0.75 })
    );
    outerRing.rotation.x = Math.PI / 2;
    outerRing.position.y = 0.025;
    this.group.add(outerRing);

    const innerRing = new THREE.Mesh(
      new THREE.TorusGeometry(5.5, 0.07, 8, 72),
      new THREE.MeshBasicMaterial({ color: 0x8f3bd1, transparent: true, opacity: 0.78 })
    );
    innerRing.rotation.x = Math.PI / 2;
    innerRing.position.y = 0.028;
    this.group.add(innerRing);
  }

  buildCrates() {
    const questionTexture = makeQuestionTexture();
    this.crates = CRATE_POSITIONS.map((position, index) => (
      createMysteryCrate(this.group, position, index, questionTexture)
    ));
  }

  update(dt) {
    const delta = Math.max(0, Math.min(dt, 0.1));
    this.time += delta;

    this.crates.forEach(crate => {
      if (crate.active) {
        crate.visuals.rotation.y += delta * 1.25;
        crate.visuals.rotation.x = Math.sin(this.time * 1.4 + crate.phase) * 0.08;
        crate.visuals.position.y = 1.12 + Math.sin(this.time * 2.2 + crate.phase) * 0.13;
        crate.baseRing.material.opacity = 0.62 + Math.sin(this.time * 3 + crate.phase) * 0.22;
      } else {
        crate.respawnRemaining = Math.max(0, crate.respawnRemaining - delta);
        if (crate.respawnRemaining === 0) {
          crate.active = true;
          crate.root.visible = true;
        }
      }

      this.updatePickupEffect(crate.effect, delta);
    });
  }

  updatePickupEffect(effect, dt) {
    if (effect.elapsed === Infinity) return;

    effect.elapsed += dt;
    const progress = Math.min(effect.elapsed / effect.duration, 1);
    effect.ring.scale.setScalar(0.5 + progress * 2.8);
    effect.ring.material.opacity = 1 - progress;

    effect.particles.forEach(particle => {
      particle.position.addScaledVector(particle.userData.velocity, dt * 4.6);
      particle.material.opacity = 1 - progress;
      particle.scale.setScalar(Math.max(0.001, 1 - progress));
    });

    if (progress >= 1) {
      effect.group.visible = false;
      effect.elapsed = Infinity;
    }
  }

  triggerPickupEffect(crate) {
    const { effect } = crate;
    effect.elapsed = 0;
    effect.group.visible = true;
    effect.ring.scale.setScalar(0.5);
    effect.ring.material.opacity = 1;
    effect.particles.forEach(particle => {
      particle.position.set(0, 0.1, 0);
      particle.scale.setScalar(1);
      particle.material.opacity = 1;
    });
  }

  collectAlongPath(startX, startZ, endX, endZ) {
    const segmentX = endX - startX;
    const segmentZ = endZ - startZ;
    const segmentLengthSquared = segmentX * segmentX + segmentZ * segmentZ;

    for (const crate of this.crates) {
      if (!crate.active) continue;

      const fromCrateX = crate.x - startX;
      const fromCrateZ = crate.z - startZ;
      const projection = segmentLengthSquared > 0
        ? THREE.MathUtils.clamp((fromCrateX * segmentX + fromCrateZ * segmentZ) / segmentLengthSquared, 0, 1)
        : 0;
      const closestX = startX + segmentX * projection;
      const closestZ = startZ + segmentZ * projection;
      const distanceSquared = (crate.x - closestX) ** 2 + (crate.z - closestZ) ** 2;

      if (distanceSquared <= crate.radius * crate.radius) {
        crate.active = false;
        crate.root.visible = false;
        crate.respawnRemaining = CRATE_RESPAWN_SECONDS;
        this.triggerPickupEffect(crate);
        return crate;
      }
    }

    return null;
  }

  resetCrates() {
    this.crates.forEach(crate => {
      crate.active = true;
      crate.respawnRemaining = 0;
      crate.root.visible = true;
      crate.visuals.rotation.set(0, 0, 0);
      crate.visuals.position.y = 1.12;
      crate.effect.elapsed = Infinity;
      crate.effect.group.visible = false;
    });
  }
}
