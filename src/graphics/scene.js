import * as THREE from 'three';
import { NeonArena } from './arena.js';

/**
 * Super Racers - Three.js scene, camera, lighting and view transitions.
 * The arena geometry and pickup lifecycle live in graphics/arena.js.
 */
export class GraphicsManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070c16);
    this.scene.fog = new THREE.FogExp2(0x070c16, 0.009);

    this.camera = new THREE.PerspectiveCamera(
      48,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );
    this.cameraLookTarget = new THREE.Vector3();

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

    this.viewMode = 'SHOWROOM';
    this.showroomSpinAngle = 0;
    this.isUserDragging = false;
    this.previousMouseX = 0;
    this.manualSpinVelocity = 0;

    this.showroomGroup = new THREE.Group();
    this.showroomGroup.name = 'kart-showroom';
    this.arena = new NeonArena();
    this.arenaGroup = this.arena.group;
    this.arenaBounds = this.arena.bounds;
    this.scene.add(this.showroomGroup);
    this.scene.add(this.arenaGroup);

    this.targetKart = null;

    this.initLights();
    this.buildShowroomEnvironment();
    this.setCameraShowroom();
    this.bindEvents();
  }

  initLights() {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.72);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xfff5e6, 1.4);
    this.sunLight.position.set(20, 35, 20);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 120;
    this.sunLight.shadow.camera.left = -45;
    this.sunLight.shadow.camera.right = 45;
    this.sunLight.shadow.camera.top = 45;
    this.sunLight.shadow.camera.bottom = -45;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0x38bdf8, 0.6);
    this.fillLight.position.set(-20, 20, -15);
    this.scene.add(this.fillLight);

    this.rimLight = new THREE.PointLight(0xff7733, 1.2, 50);
    this.rimLight.position.set(0, 10, -12);
    this.scene.add(this.rimLight);
  }

  buildShowroomEnvironment() {
    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 3.8, 0.45, 48),
      new THREE.MeshStandardMaterial({
        color: 0x111827,
        roughness: 0.35,
        metalness: 0.6
      })
    );
    podium.position.y = -0.225;
    podium.receiveShadow = true;
    this.showroomGroup.add(podium);

    const ringGeometry = new THREE.TorusGeometry(3.62, 0.045, 16, 64);
    ringGeometry.rotateX(Math.PI / 2);
    const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: 0x06b6d4 }));
    ring.position.y = 0.01;
    this.showroomGroup.add(ring);

    const grid = new THREE.GridHelper(50, 50, 0x06b6d4, 0x1e293b);
    grid.position.y = -0.23;
    grid.material.opacity = 0.4;
    grid.material.transparent = true;
    this.showroomGroup.add(grid);

    const spot = new THREE.SpotLight(0x06b6d4, 2.5, 25, Math.PI / 6, 0.4);
    spot.position.set(0, 8, 0);
    spot.target = podium;
    this.showroomGroup.add(spot);
  }

  bindEvents() {
    window.addEventListener('resize', () => this.onResize());

    // Mouse/touch drag rotates the kart only while in the showroom.
    this.canvas.addEventListener('mousedown', event => {
      if (this.viewMode !== 'SHOWROOM') return;
      this.isUserDragging = true;
      this.previousMouseX = event.clientX;
      this.manualSpinVelocity = 0;
    });

    window.addEventListener('mousemove', event => {
      if (!this.isUserDragging || this.viewMode !== 'SHOWROOM') return;
      const deltaX = event.clientX - this.previousMouseX;
      this.previousMouseX = event.clientX;
      this.manualSpinVelocity = deltaX * 0.01;
      this.showroomSpinAngle += this.manualSpinVelocity;
    });

    window.addEventListener('mouseup', () => {
      this.isUserDragging = false;
    });

    this.canvas.addEventListener('touchstart', event => {
      if (this.viewMode !== 'SHOWROOM' || event.touches.length === 0) return;
      this.isUserDragging = true;
      this.previousMouseX = event.touches[0].clientX;
      this.manualSpinVelocity = 0;
    }, { passive: true });

    window.addEventListener('touchmove', event => {
      if (!this.isUserDragging || this.viewMode !== 'SHOWROOM' || event.touches.length === 0) return;
      const deltaX = event.touches[0].clientX - this.previousMouseX;
      this.previousMouseX = event.touches[0].clientX;
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
    this.targetKart = null;
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
    this.arena.update(dt);

    if (this.viewMode === 'SHOWROOM') {
      if (!this.isUserDragging) {
        this.manualSpinVelocity *= 0.92;
        this.showroomSpinAngle += 0.008 + this.manualSpinVelocity;
      }
      return this.showroomSpinAngle;
    }

    if (this.viewMode === 'GAME' && this.targetKart) {
      const kartPosition = this.targetKart.root.position;
      const kartRotation = this.targetKart.root.rotation.y;
      const speedMagnitude = Math.abs(playerSpeed);
      const distance = 6.5 + Math.min(speedMagnitude * 0.08, 2.5);
      const height = 3.2 + Math.min(speedMagnitude * 0.02, 0.8);

      const desiredX = kartPosition.x - Math.sin(kartRotation) * distance;
      const desiredZ = kartPosition.z - Math.cos(kartRotation) * distance;
      const desiredY = kartPosition.y + height;
      const followBlend = 1 - Math.exp(-8 * Math.max(0, dt));

      this.camera.position.x += (desiredX - this.camera.position.x) * followBlend;
      this.camera.position.y += (desiredY - this.camera.position.y) * followBlend;
      this.camera.position.z += (desiredZ - this.camera.position.z) * followBlend;

      this.cameraLookTarget.set(kartPosition.x, kartPosition.y + 0.8, kartPosition.z);
      this.camera.lookAt(this.cameraLookTarget);
    }

    return 0;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
