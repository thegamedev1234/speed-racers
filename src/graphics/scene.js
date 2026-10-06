import * as THREE from 'three';

/**
 * Super Racers - Three.js Scene, Camera, Lighting & Environments.
 * Manages the Showroom 3D studio and the in-game Battle Arena.
 */
export class GraphicsManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e17);
    this.scene.fog = new THREE.FogExp2(0x0a0e17, 0.012);

    // Camera setup
    this.camera = new THREE.PerspectiveCamera(
      48,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // View state
    this.viewMode = 'SHOWROOM'; // 'SHOWROOM' | 'GAME'
    this.showroomSpinAngle = 0;
    this.isUserDragging = false;
    this.previousMouseX = 0;
    this.manualSpinVelocity = 0;

    // Groups
    this.showroomGroup = new THREE.Group();
    this.arenaGroup = new THREE.Group();
    this.scene.add(this.showroomGroup);
    this.scene.add(this.arenaGroup);

    // Player & bots tracking for camera
    this.targetKart = null;

    // Build environments
    this.initLights();
    this.buildShowroomEnvironment();
    this.buildArenaEnvironment();

    // Set initial camera
    this.setCameraShowroom();

    // Bind event listeners
    this.bindEvents();
  }

  initLights() {
    // Soft ambient light
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(this.ambientLight);

    // Key directional light with soft shadows
    this.sunLight = new THREE.DirectionalLight(0xfff5e6, 1.4);
    this.sunLight.position.set(20, 35, 20);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 120;
    const d = 45;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    // Blue fill light
    this.fillLight = new THREE.DirectionalLight(0x38bdf8, 0.6);
    this.fillLight.position.set(-20, 20, -15);
    this.scene.add(this.fillLight);

    // Warm rim backlight
    this.rimLight = new THREE.PointLight(0xff7733, 1.2, 50);
    this.rimLight.position.set(0, 10, -12);
    this.scene.add(this.rimLight);
  }

  buildShowroomEnvironment() {
    // 1. Showroom Podium / Pedestal
    const podiumGeom = new THREE.CylinderGeometry(3.6, 3.8, 0.45, 48);
    const podiumMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.35,
      metalness: 0.6
    });
    this.podiumMesh = new THREE.Mesh(podiumGeom, podiumMat);
    this.podiumMesh.position.y = -0.225;
    this.podiumMesh.receiveShadow = true;
    this.showroomGroup.add(this.podiumMesh);

    // Glowing LED Ring on Podium Edge
    const ringGeom = new THREE.TorusGeometry(3.62, 0.045, 16, 64);
    ringGeom.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });
    const ringMesh = new THREE.Mesh(ringGeom, ringMat);
    ringMesh.position.y = 0.01;
    this.showroomGroup.add(ringMesh);

    // Floor Grid pattern surrounding the podium
    const gridHelper = new THREE.GridHelper(50, 50, 0x06b6d4, 0x1e293b);
    gridHelper.position.y = -0.23;
    gridHelper.material.opacity = 0.4;
    gridHelper.material.transparent = true;
    this.showroomGroup.add(gridHelper);

    // Subtle showroom spotlights
    const spot = new THREE.SpotLight(0x06b6d4, 2.5, 25, Math.PI / 6, 0.4);
    spot.position.set(0, 8, 0);
    spot.target = this.podiumMesh;
    this.showroomGroup.add(spot);
  }

  buildArenaEnvironment() {
    this.arenaBounds = { size: 120 }; // Half size: -60 to +60
    const half = this.arenaBounds.size / 2;

    // 1. Arena Main Floor
    const floorGeom = new THREE.PlaneGeometry(120, 120, 40, 40);
    floorGeom.rotateX(-Math.PI / 2);

    // Stylized checkerboard / cyber grid floor texture via canvas
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 512, 512);

    // Grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 4;
    const step = 64;
    for (let x = 0; x <= 512; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, x);
      ctx.lineTo(512, x);
      ctx.stroke();
    }

    // Racing center circle
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(256, 256, 140, 0, Math.PI * 2);
    ctx.stroke();

    const floorTexture = new THREE.CanvasTexture(canvas);
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(10, 10);

    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.5,
      metalness: 0.2
    });
    const floorMesh = new THREE.Mesh(floorGeom, floorMat);
    floorMesh.receiveShadow = true;
    this.arenaGroup.add(floorMesh);

    // 2. Arena Boundary Walls / Neon Barriers
    const wallHeight = 3.2;
    const wallThick = 1.2;
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.4,
      metalness: 0.7
    });
    const neonRailMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    const walls = [
      { x: 0, z: -half, w: 120, d: wallThick, rot: 0 },
      { x: 0, z: half, w: 120, d: wallThick, rot: 0 },
      { x: -half, z: 0, w: wallThick, d: 120, rot: 0 },
      { x: half, z: 0, w: wallThick, d: 120, rot: 0 }
    ];

    walls.forEach(w => {
      const wallGeom = new THREE.BoxGeometry(w.w, wallHeight, w.d);
      const wallMesh = new THREE.Mesh(wallGeom, wallMat);
      wallMesh.position.set(w.x, wallHeight / 2, w.z);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      this.arenaGroup.add(wallMesh);

      // Neon strip on top of wall
      const railGeom = new THREE.BoxGeometry(
        w.w === wallThick ? 0.3 : w.w,
        0.2,
        w.d === wallThick ? 0.3 : w.d
      );
      const railMesh = new THREE.Mesh(railGeom, neonRailMat);
      railMesh.position.set(w.x, wallHeight + 0.1, w.z);
      this.arenaGroup.add(railMesh);
    });

    // 3. Stadium Corner Floodlight Towers
    const cornerOffsets = [
      [-half + 3, -half + 3],
      [half - 3, -half + 3],
      [-half + 3, half - 3],
      [half - 3, half - 3]
    ];
    cornerOffsets.forEach(([cx, cz]) => {
      const poleGeom = new THREE.CylinderGeometry(0.3, 0.5, 14, 8);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 });
      const poleMesh = new THREE.Mesh(poleGeom, poleMat);
      poleMesh.position.set(cx, 7, cz);
      this.arenaGroup.add(poleMesh);

      const lampHead = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 1.2, 1.2),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8 })
      );
      lampHead.position.set(cx, 14, cz);
      lampHead.lookAt(0, 0, 0);
      this.arenaGroup.add(lampHead);
    });

    // 4. Boost Pads & Obstacle Crates
    this.buildArenaProps();

    // Arena hidden until game starts
    this.arenaGroup.visible = false;
  }

  buildArenaProps() {
    this.obstacles = [];

    // Boost Pads (glowing arrows on floor)
    const boostPadPositions = [
      { x: 0, z: 20, rot: 0 },
      { x: 0, z: -20, rot: Math.PI },
      { x: 25, z: 0, rot: Math.PI / 2 },
      { x: -25, z: 0, rot: -Math.PI / 2 }
    ];

    const boostMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    boostPadPositions.forEach(pos => {
      const padGeom = new THREE.PlaneGeometry(3.5, 6.0);
      padGeom.rotateX(-Math.PI / 2);
      const padMesh = new THREE.Mesh(padGeom, boostMat);
      padMesh.position.set(pos.x, 0.02, pos.z);
      padMesh.rotation.y = pos.rot;
      this.arenaGroup.add(padMesh);
    });

    // Obstacle Crates / Barriers around the arena
    const crateGeom = new THREE.BoxGeometry(2.4, 2.4, 2.4);
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.3,
      metalness: 0.2
    });

    const cratePositions = [
      { x: -15, z: -15 },
      { x: 15, z: 15 },
      { x: -15, z: 15 },
      { x: 15, z: -15 },
      { x: 32, z: 22 },
      { x: -32, z: -22 },
      { x: -30, z: 28 },
      { x: 30, z: -28 }
    ];

    cratePositions.forEach(cp => {
      const crate = new THREE.Mesh(crateGeom, crateMat);
      crate.position.set(cp.x, 1.2, cp.z);
      crate.castShadow = true;
      crate.receiveShadow = true;
      this.arenaGroup.add(crate);
      this.obstacles.push({
        x: cp.x,
        z: cp.z,
        radius: 1.8
      });
    });
  }

  bindEvents() {
    window.addEventListener('resize', () => this.onResize());

    // Allow user to click-drag horizontally to spin kart in Showroom
    this.canvas.addEventListener('mousedown', e => {
      if (this.viewMode !== 'SHOWROOM') return;
      this.isUserDragging = true;
      this.previousMouseX = e.clientX;
      this.manualSpinVelocity = 0;
    });

    window.addEventListener('mousemove', e => {
      if (!this.isUserDragging || this.viewMode !== 'SHOWROOM') return;
      const deltaX = e.clientX - this.previousMouseX;
      this.previousMouseX = e.clientX;
      this.manualSpinVelocity = deltaX * 0.01;
      this.showroomSpinAngle += this.manualSpinVelocity;
    });

    window.addEventListener('mouseup', () => {
      this.isUserDragging = false;
    });

    // Touch support for mobile/tablets
    this.canvas.addEventListener('touchstart', e => {
      if (this.viewMode !== 'SHOWROOM' || e.touches.length === 0) return;
      this.isUserDragging = true;
      this.previousMouseX = e.touches[0].clientX;
      this.manualSpinVelocity = 0;
    }, { passive: true });

    window.addEventListener('touchmove', e => {
      if (!this.isUserDragging || this.viewMode !== 'SHOWROOM' || e.touches.length === 0) return;
      const deltaX = e.touches[0].clientX - this.previousMouseX;
      this.previousMouseX = e.touches[0].clientX;
      this.manualSpinVelocity = deltaX * 0.01;
      this.showroomSpinAngle += this.manualSpinVelocity;
    }, { passive: true });

    window.addEventListener('touchend', () => {
      this.isUserDragging = false;
    });
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  setCameraShowroom() {
    this.viewMode = 'SHOWROOM';
    this.showroomGroup.visible = true;
    this.arenaGroup.visible = false;
    this.camera.position.set(0, 2.3, 5.4);
    this.camera.lookAt(0, 0.7, 0);
  }

  setCameraGame(targetKart) {
    this.viewMode = 'GAME';
    this.targetKart = targetKart;
    this.showroomGroup.visible = false;
    this.arenaGroup.visible = true;
  }

  update(dt, playerSpeed = 0) {
    if (this.viewMode === 'SHOWROOM') {
      // If user isn't dragging, apply gentle auto-spin + damp manual velocity
      if (!this.isUserDragging) {
        this.manualSpinVelocity *= 0.92;
        this.showroomSpinAngle += 0.008 + this.manualSpinVelocity;
      }
      return this.showroomSpinAngle;
    } else if (this.viewMode === 'GAME' && this.targetKart) {
      // Dynamic third-person chase camera
      const kartPos = this.targetKart.root.position;
      const kartRotY = this.targetKart.root.rotation.y;

      // Distance pulls back slightly at higher speeds for speed rush feel
      const dist = 6.5 + Math.min(Math.abs(playerSpeed) * 0.08, 2.5);
      const height = 3.2 + Math.min(Math.abs(playerSpeed) * 0.02, 0.8);

      // Desired camera position behind kart
      const camTargetX = kartPos.x - Math.sin(kartRotY) * dist;
      const camTargetZ = kartPos.z - Math.cos(kartRotY) * dist;
      const camTargetY = kartPos.y + height;

      // Smooth camera interpolation (lerp)
      const lerpFactor = 0.12;
      this.camera.position.x += (camTargetX - this.camera.position.x) * lerpFactor;
      this.camera.position.y += (camTargetY - this.camera.position.y) * lerpFactor;
      this.camera.position.z += (camTargetZ - this.camera.position.z) * lerpFactor;

      // Look slightly above the kart
      const lookTarget = new THREE.Vector3(kartPos.x, kartPos.y + 0.8, kartPos.z);
      this.camera.lookAt(lookTarget);
    }
    return 0;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
