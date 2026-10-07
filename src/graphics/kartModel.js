import * as THREE from 'three';

/**
 * Creates a stylized composite 3D Kart model inspired by Smash Karts.
 * Made entirely of procedural Three.js primitives for lightweight, fast rendering.
 */
export function createKart(skinConfig) {
  const root = new THREE.Group();
  root.name = 'kart-root';

  // Materials containers to allow real-time skin swapping
  const materials = {
    primary: new THREE.MeshStandardMaterial({
      color: skinConfig.primaryColor,
      roughness: 0.25,
      metalness: 0.35
    }),
    secondary: new THREE.MeshStandardMaterial({
      color: skinConfig.secondaryColor,
      roughness: 0.4,
      metalness: 0.2
    }),
    accent: new THREE.MeshStandardMaterial({
      color: skinConfig.accentColor,
      roughness: 0.2,
      metalness: 0.5
    }),
    chrome: new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.1,
      metalness: 0.95
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.85,
      metalness: 0.05
    }),
    rim: new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.2,
      metalness: 0.85
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.1,
      metalness: 0.9,
      envMapIntensity: 1.0
    }),
    headlight: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffeedd,
      emissiveIntensity: 0.8,
      roughness: 0.1
    }),
    taillight: new THREE.MeshStandardMaterial({
      color: 0xff1122,
      emissive: 0xff0022,
      emissiveIntensity: 0.9,
      roughness: 0.1
    }),
    exhaustGlow: new THREE.MeshBasicMaterial({
      color: 0xff6600
    })
  };

  // Body container that tilts slightly during turns and acceleration
  const chassis = new THREE.Group();
  chassis.name = 'chassis';
  root.add(chassis);

  // 1. MAIN CHASSIS BODY
  const mainBodyGeom = new THREE.BoxGeometry(1.2, 0.4, 2.0);
  const mainBodyMesh = new THREE.Mesh(mainBodyGeom, materials.primary);
  mainBodyMesh.position.set(0, 0.35, 0);
  mainBodyMesh.castShadow = true;
  mainBodyMesh.receiveShadow = true;
  chassis.add(mainBodyMesh);

  // 2. FRONT NOSE CONE (slanted aerodynamic hood)
  const noseGeom = new THREE.CylinderGeometry(0.55, 0.65, 0.8, 4);
  const noseMesh = new THREE.Mesh(noseGeom, materials.primary);
  noseMesh.rotation.y = Math.PI / 4;
  noseMesh.rotation.x = -Math.PI / 10;
  noseMesh.position.set(0, 0.38, 1.25);
  noseMesh.scale.set(1.1, 0.5, 0.9);
  noseMesh.castShadow = true;
  chassis.add(noseMesh);

  // 3. FRONT BUMPER BAR & HEADLIGHTS
  const bumperGeom = new THREE.CylinderGeometry(0.12, 0.12, 1.6, 12);
  const bumperMesh = new THREE.Mesh(bumperGeom, materials.secondary);
  bumperMesh.rotation.z = Math.PI / 2;
  bumperMesh.position.set(0, 0.24, 1.7);
  bumperMesh.castShadow = true;
  chassis.add(bumperMesh);

  // Dual Headlights
  [-0.45, 0.45].forEach(x => {
    const lightGeom = new THREE.CylinderGeometry(0.1, 0.12, 0.1, 16);
    const lightMesh = new THREE.Mesh(lightGeom, materials.headlight);
    lightMesh.rotation.x = Math.PI / 2;
    lightMesh.position.set(x, 0.38, 1.55);
    chassis.add(lightMesh);
  });

  // 4. SIDE PODS (Left & Right air scoops)
  [-0.68, 0.68].forEach(x => {
    const podGeom = new THREE.BoxGeometry(0.3, 0.32, 1.3);
    const podMesh = new THREE.Mesh(podGeom, materials.accent);
    podMesh.position.set(x, 0.32, 0.05);
    podMesh.castShadow = true;
    chassis.add(podMesh);

    // Pod air intake vent
    const ventGeom = new THREE.BoxGeometry(0.24, 0.22, 0.1);
    const ventMesh = new THREE.Mesh(ventGeom, materials.secondary);
    ventMesh.position.set(x, 0.32, 0.7);
    chassis.add(ventMesh);
  });

  // 5. COCKPIT & SEAT
  const cockpitGeom = new THREE.BoxGeometry(0.75, 0.25, 0.9);
  const cockpitMesh = new THREE.Mesh(cockpitGeom, materials.secondary);
  cockpitMesh.position.set(0, 0.45, 0.05);
  chassis.add(cockpitMesh);

  // Seat Backrest
  const seatBackGeom = new THREE.BoxGeometry(0.65, 0.6, 0.15);
  const seatBackMesh = new THREE.Mesh(seatBackGeom, materials.secondary);
  seatBackMesh.position.set(0, 0.62, -0.32);
  seatBackMesh.rotation.x = -Math.PI / 18;
  chassis.add(seatBackMesh);

  // Steering Column & Wheel
  const colGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.4, 8);
  const colMesh = new THREE.Mesh(colGeom, materials.chrome);
  colMesh.position.set(0, 0.55, 0.35);
  colMesh.rotation.x = -Math.PI / 5;
  chassis.add(colMesh);

  const wheelRimGeom = new THREE.TorusGeometry(0.18, 0.035, 8, 16);
  const wheelRimMesh = new THREE.Mesh(wheelRimGeom, materials.secondary);
  wheelRimMesh.position.set(0, 0.7, 0.24);
  wheelRimMesh.rotation.x = Math.PI / 3.5;
  chassis.add(wheelRimMesh);

  // 6. DRIVER BOBBLEHEAD & HELMET
  const driverGroup = new THREE.Group();
  driverGroup.name = 'driver';
  driverGroup.position.set(0, 0.78, -0.05);

  // Helmet sphere
  const helmetGeom = new THREE.SphereGeometry(0.32, 20, 20);
  const helmetMesh = new THREE.Mesh(helmetGeom, materials.primary);
  helmetMesh.castShadow = true;
  driverGroup.add(helmetMesh);

  // Visor
  const visorGeom = new THREE.SphereGeometry(0.26, 16, 16, 0, Math.PI, 0, Math.PI / 2);
  const visorMesh = new THREE.Mesh(visorGeom, materials.glass);
  visorMesh.rotation.x = Math.PI / 2.2;
  visorMesh.position.set(0, 0.02, 0.12);
  driverGroup.add(visorMesh);

  // Helmet crest / stripe
  const crestGeom = new THREE.BoxGeometry(0.08, 0.1, 0.5);
  const crestMesh = new THREE.Mesh(crestGeom, materials.accent);
  crestMesh.position.set(0, 0.26, 0);
  driverGroup.add(crestMesh);

  chassis.add(driverGroup);

  // 7. ENGINE BLOCK & EXHAUST PIPES
  const engineGeom = new THREE.BoxGeometry(0.7, 0.4, 0.45);
  const engineMesh = new THREE.Mesh(engineGeom, materials.chrome);
  engineMesh.position.set(0, 0.52, -0.7);
  engineMesh.castShadow = true;
  chassis.add(engineMesh);

  // Twin Exhaust Pipes
  const exhaustPipes = [];
  [-0.22, 0.22].forEach(x => {
    const pipeGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.5, 12);
    const pipeMesh = new THREE.Mesh(pipeGeom, materials.chrome);
    pipeMesh.rotation.x = Math.PI / 2.5;
    pipeMesh.position.set(x, 0.45, -1.02);
    chassis.add(pipeMesh);

    // Glowing exhaust tip
    const flameGeom = new THREE.SphereGeometry(0.06, 8, 8);
    const flameMesh = new THREE.Mesh(flameGeom, materials.exhaustGlow);
    flameMesh.position.set(x, 0.54, -1.25);
    flameMesh.visible = false;
    chassis.add(flameMesh);
    exhaustPipes.push(flameMesh);
  });

  // Rear Taillights
  [-0.45, 0.45].forEach(x => {
    const tailGeom = new THREE.BoxGeometry(0.18, 0.1, 0.08);
    const tailMesh = new THREE.Mesh(tailGeom, materials.taillight);
    tailMesh.position.set(x, 0.42, -1.02);
    chassis.add(tailMesh);
  });

  // 8. REAR SPOILER / WING
  // Dual struts
  [-0.38, 0.38].forEach(x => {
    const strutGeom = new THREE.BoxGeometry(0.06, 0.35, 0.08);
    const strutMesh = new THREE.Mesh(strutGeom, materials.secondary);
    strutMesh.position.set(x, 0.72, -0.9);
    strutMesh.rotation.x = -Math.PI / 12;
    chassis.add(strutMesh);
  });

  // Wing blade
  const wingGeom = new THREE.BoxGeometry(1.4, 0.08, 0.32);
  const wingMesh = new THREE.Mesh(wingGeom, materials.primary);
  wingMesh.position.set(0, 0.88, -0.95);
  wingMesh.rotation.x = -Math.PI / 20;
  wingMesh.castShadow = true;
  chassis.add(wingMesh);

  // Wing endplates
  [-0.7, 0.7].forEach(x => {
    const plateGeom = new THREE.BoxGeometry(0.05, 0.22, 0.4);
    const plateMesh = new THREE.Mesh(plateGeom, materials.accent);
    plateMesh.position.set(x, 0.88, -0.95);
    chassis.add(plateMesh);
  });

  // 9. WHEELS & SUSPENSION
  // Front and rear wheel hubs
  const wheelRadius = 0.32;
  const wheelWidth = 0.28;
  const wheelGeom = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 20);
  wheelGeom.rotateZ(Math.PI / 2); // align axle along X-axis

  const rimGeom = new THREE.CylinderGeometry(wheelRadius * 0.65, wheelRadius * 0.65, wheelWidth + 0.02, 12);
  rimGeom.rotateZ(Math.PI / 2);

  const hubCapGeom = new THREE.CylinderGeometry(wheelRadius * 0.25, wheelRadius * 0.25, wheelWidth + 0.04, 8);
  hubCapGeom.rotateZ(Math.PI / 2);

  const wheelPositions = [
    { name: 'frontLeft', x: -0.82, y: 0.32, z: 0.95, isFront: true },
    { name: 'frontRight', x: 0.82, y: 0.32, z: 0.95, isFront: true },
    { name: 'rearLeft', x: -0.86, y: 0.36, z: -0.8, isFront: false },
    { name: 'rearRight', x: 0.86, y: 0.36, z: -0.8, isFront: false }
  ];

  const wheels = [];
  const frontSteerGroups = [];

  wheelPositions.forEach(cfg => {
    // Steer anchor (allows Y rotation for front wheels)
    const steerGroup = new THREE.Group();
    steerGroup.position.set(cfg.x, cfg.y, cfg.z);
    root.add(steerGroup);

    // Roll container (allows X rotation as wheel spins)
    const rollGroup = new THREE.Group();
    steerGroup.add(rollGroup);

    // Tire mesh
    const tire = new THREE.Mesh(wheelGeom, materials.rubber);
    tire.castShadow = true;
    rollGroup.add(tire);

    // Rim mesh
    const rim = new THREE.Mesh(rimGeom, materials.rim);
    rollGroup.add(rim);

    // Hubcap mesh
    const hub = new THREE.Mesh(hubCapGeom, materials.accent);
    rollGroup.add(hub);

    wheels.push({ rollGroup, config: cfg });

    if (cfg.isFront) {
      frontSteerGroups.push(steerGroup);
    }
  });

  let currentSkin = skinConfig;

  // Real-time skin updater
  function applySkin(newSkin) {
    currentSkin = newSkin;
    materials.primary.color.setHex(newSkin.primaryColor);
    materials.secondary.color.setHex(newSkin.secondaryColor);
    materials.accent.color.setHex(newSkin.accentColor);
    if (newSkin.emissiveColor) {
      materials.primary.emissive = new THREE.Color(newSkin.emissiveColor).multiplyScalar(0.15);
    }
  }

  // Animation & simulation update
  let wheelAngle = 0;
  function update({ speed = 0, steer = 0, dt = 0.016, isDrifting = false }) {
    // Wheel rolling rotation
    const travelDist = speed * dt;
    wheelAngle -= travelDist / wheelRadius;
    wheels.forEach(w => {
      w.rollGroup.rotation.x = wheelAngle;
    });

    // Front wheel steering angle
    const targetSteerAngle = steer * 0.45;
    frontSteerGroups.forEach(sg => {
      sg.rotation.y = targetSteerAngle;
    });

    // Chassis dynamic response: roll into turn & pitch on accel/brake
    const targetRoll = -steer * Math.min(Math.abs(speed) / 10, 1) * 0.15;
    const targetPitch = Math.max(-0.08, Math.min(0.08, speed * 0.005));

    const bodyResponse = 1 - Math.exp(-12 * dt);
    chassis.rotation.z += (targetRoll - chassis.rotation.z) * bodyResponse;
    chassis.rotation.x += (targetPitch - chassis.rotation.x) * bodyResponse;

    // Driver head nod & bobble
    if (driverGroup) {
      driverGroup.rotation.z = -chassis.rotation.z * 0.6;
      driverGroup.position.y = 0.78 + Math.sin(Date.now() * 0.01) * 0.015 * Math.min(1, Math.abs(speed) / 5);
    }

    // Exhaust glow effect when driving fast or drifting
    const showExhaust = Math.abs(speed) > 12 || isDrifting;
    exhaustPipes.forEach(flame => {
      flame.visible = showExhaust;
      if (showExhaust) {
        const scale = 0.8 + Math.random() * 0.7;
        flame.scale.set(scale, scale, scale * 1.5);
      }
    });
  }

  return {
    root,
    chassis,
    applySkin,
    update,
    getSkin: () => currentSkin,
    materials
  };
}
