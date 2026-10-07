const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function moveTowards(value, target, maxDelta) {
  if (Math.abs(target - value) <= maxDelta) return target;
  return value + Math.sign(target - value) * maxDelta;
}

/**
 * Dependency-free arcade kart handling for the player vehicle.
 * The controller keeps forward speed, steering and drift slip predictable while
 * avoiding a WASM physics startup dependency for this small arena prototype.
 */
export class ArcadeKartPhysics {
  constructor({ bounds = 47.3 } = {}) {
    this.bounds = bounds;
    this.tuning = {
      maxSpeed: 27,
      maxReverseSpeed: -8,
      acceleration: 20,
      reverseAcceleration: 9,
      brakeAcceleration: 36,
      coastFriction: 3.8,
      steerResponse: 11,
      lowSpeedTurnRate: 0.42,
      maxTurnRate: 1.9,
      driftTurnMultiplier: 1.24,
      driftSlide: 0.2,
      driftGrip: 3.4,
      normalGrip: 10
    };
    this.state = this.createState();
  }

  createState() {
    return {
      x: 0,
      z: 0,
      rotationY: 0,
      speed: 0,
      lateralSpeed: 0,
      steer: 0,
      isDrifting: false,
      distanceTraveled: 0,
      maxSpeed: this.tuning.maxSpeed,
      maxReverseSpeed: this.tuning.maxReverseSpeed
    };
  }

  reset({ x = 0, z = 0, rotationY = 0 } = {}) {
    Object.assign(this.state, {
      x,
      z,
      rotationY,
      speed: 0,
      lateralSpeed: 0,
      steer: 0,
      isDrifting: false,
      distanceTraveled: 0
    });
    return this.state;
  }

  step({ dt, throttle = 0, steer = 0, drifting = false } = {}) {
    const p = this.state;
    const delta = clamp(Number(dt) || 0, 0, 0.1);
    const safeThrottle = clamp(throttle, -1, 1);
    const steerTarget = clamp(steer, -1, 1);
    const startX = p.x;
    const startZ = p.z;

    p.isDrifting = Boolean(drifting);

    // Throttle is signed: forward input, brake/reverse input, or coast.
    if (safeThrottle > 0) {
      p.speed = moveTowards(p.speed, this.tuning.maxSpeed, this.tuning.acceleration * safeThrottle * delta);
    } else if (safeThrottle < 0) {
      if (p.speed > 0.15) {
        p.speed = moveTowards(p.speed, 0, this.tuning.brakeAcceleration * -safeThrottle * delta);
      } else {
        p.speed = moveTowards(p.speed, this.tuning.maxReverseSpeed, this.tuning.reverseAcceleration * -safeThrottle * delta);
      }
    } else {
      p.speed = moveTowards(p.speed, 0, this.tuning.coastFriction * delta);
    }

    if (Math.abs(p.speed) < 0.035) p.speed = 0;

    const steeringBlend = 1 - Math.exp(-this.tuning.steerResponse * delta);
    p.steer += (steerTarget - p.steer) * steeringBlend;

    const speedRatio = clamp(Math.abs(p.speed) / this.tuning.maxSpeed, 0, 1);
    const direction = p.speed < 0 ? -1 : 1;
    const turnRate = this.tuning.lowSpeedTurnRate + (this.tuning.maxTurnRate - this.tuning.lowSpeedTurnRate) * speedRatio;
    p.rotationY += p.steer * turnRate * (p.isDrifting ? this.tuning.driftTurnMultiplier : 1) * direction * delta;

    const lateralTarget = p.isDrifting ? p.steer * Math.abs(p.speed) * this.tuning.driftSlide : 0;
    const grip = p.isDrifting ? this.tuning.driftGrip : this.tuning.normalGrip;
    p.lateralSpeed += (lateralTarget - p.lateralSpeed) * (1 - Math.exp(-grip * delta));

    const forwardX = Math.sin(p.rotationY);
    const forwardZ = Math.cos(p.rotationY);
    const rightX = Math.cos(p.rotationY);
    const rightZ = -Math.sin(p.rotationY);
    const velocityX = forwardX * p.speed + rightX * p.lateralSpeed;
    const velocityZ = forwardZ * p.speed + rightZ * p.lateralSpeed;
    const nextX = p.x + velocityX * delta;
    const nextZ = p.z + velocityZ * delta;
    const impactSpeed = Math.hypot(velocityX, velocityZ);

    let resolvedVelocityX = velocityX;
    let resolvedVelocityZ = velocityZ;
    let collided = false;

    if (nextX < -this.bounds) {
      p.x = -this.bounds;
      resolvedVelocityX = Math.abs(velocityX) * 0.28;
      collided = true;
    } else if (nextX > this.bounds) {
      p.x = this.bounds;
      resolvedVelocityX = -Math.abs(velocityX) * 0.28;
      collided = true;
    } else {
      p.x = nextX;
    }

    if (nextZ < -this.bounds) {
      p.z = -this.bounds;
      resolvedVelocityZ = Math.abs(velocityZ) * 0.28;
      collided = true;
    } else if (nextZ > this.bounds) {
      p.z = this.bounds;
      resolvedVelocityZ = -Math.abs(velocityZ) * 0.28;
      collided = true;
    } else {
      p.z = nextZ;
    }

    if (collided) {
      // Reflect the world velocity off the arena wall, then map it back to kart space.
      p.speed = resolvedVelocityX * forwardX + resolvedVelocityZ * forwardZ;
      p.lateralSpeed = resolvedVelocityX * rightX + resolvedVelocityZ * rightZ;
    }

    p.distanceTraveled += Math.hypot(p.x - startX, p.z - startZ);

    return {
      collided,
      impactSpeed,
      startX,
      startZ,
      endX: p.x,
      endZ: p.z
    };
  }
}
