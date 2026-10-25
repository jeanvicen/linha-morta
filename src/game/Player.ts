/**
 * First-person character: walking/running with smoothed acceleration, ground following,
 * circle colliders (trees, poles, signs), an oriented box for the car and soft world bounds.
 */
import { Vector2, Vector3, type PerspectiveCamera } from 'three';
import { clamp, damp } from '../core/math';
import { lateralOffset, roadCenterX, terrainHeight } from '../world/layout';

export interface CircleCollider {
  x: number;
  z: number;
  r: number;
}

export interface BoxCollider {
  /** Center in world space. */
  x: number;
  z: number;
  /** Rotation around Y (world). */
  yaw: number;
  halfX: number;
  halfZ: number;
}

export type Surface = 'asphalt' | 'gravel' | 'grass';

export const PLAYER = {
  radius: 0.32,
  eye: 1.66,
  walk: 1.9,
  run: 4.1,
  /** Allowed lateral distance from the road centerline. */
  maxLateral: 11.5,
  zMin: -140,
  zMax: 22,
} as const;

export class Player {
  readonly position = new Vector3();
  yaw = 0;
  pitch = 0;
  private readonly velocity = new Vector2();
  private bobPhase = 0;
  private groundY = 0;
  private distanceSinceStep = 0;
  /** Set when the player pushes against the forest boundary (for a hint). */
  blockedByForest = false;

  place(x: number, z: number, yaw: number): void {
    this.position.set(x, 0, z);
    this.groundY = groundHeight(x, z);
    this.position.y = this.groundY;
    this.yaw = yaw;
    this.pitch = -0.05;
    this.velocity.set(0, 0);
  }

  get surface(): Surface {
    const lat = Math.abs(lateralOffset(this.position.x, this.position.z));
    return lat < 3.75 ? 'asphalt' : lat < 5.7 ? 'gravel' : 'grass';
  }

  get speed(): number {
    return this.velocity.length();
  }

  /**
   * Advances the simulation. Returns true when a footstep should be played.
   */
  update(
    dt: number,
    move: Vector2,
    run: boolean,
    look: Vector2,
    sensitivity: number,
    invertY: boolean,
    circles: readonly CircleCollider[],
    boxes: readonly BoxCollider[],
  ): boolean {
    const k = 0.0022 * sensitivity;
    this.yaw -= look.x * k;
    this.pitch -= look.y * k * (invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.45, 1.45);

    const speed = run && move.y > 0.2 ? PLAYER.run : PLAYER.walk;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Forward is -Z rotated by yaw; right is +X rotated by yaw.
    const wishX = (-sin * move.y + cos * move.x) * speed;
    const wishZ = (-cos * move.y - sin * move.x) * speed;
    const accel = move.lengthSq() > 0 ? 9 : 12;
    this.velocity.x = damp(this.velocity.x, wishX, accel, dt);
    this.velocity.y = damp(this.velocity.y, wishZ, accel, dt);

    let x = this.position.x + this.velocity.x * dt;
    let z = this.position.z + this.velocity.y * dt;

    for (let iteration = 0; iteration < 2; iteration++) {
      for (const c of circles) {
        const dx = x - c.x;
        const dz = z - c.z;
        const min = c.r + PLAYER.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          x = c.x + (dx / d) * min;
          z = c.z + (dz / d) * min;
        }
      }
      for (const b of boxes) {
        // Transform into box space, push out to the closest face.
        // Inverse of three's Y rotation: local = R(-yaw) * (world - center).
        const s = Math.sin(b.yaw);
        const co = Math.cos(b.yaw);
        const lx = (x - b.x) * co - (z - b.z) * s;
        const lz = (x - b.x) * s + (z - b.z) * co;
        const hx = b.halfX + PLAYER.radius;
        const hz = b.halfZ + PLAYER.radius;
        if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
          const px = hx - Math.abs(lx);
          const pz = hz - Math.abs(lz);
          let nx = lx;
          let nz = lz;
          if (px < pz) nx = Math.sign(lx || 1) * hx;
          else nz = Math.sign(lz || 1) * hz;
          x = b.x + nx * co + nz * s;
          z = b.z - nx * s + nz * co;
        }
      }
    }

    // World bounds: the forest is too dense to enter; the road continues beyond the playable area.
    this.blockedByForest = false;
    const lat = lateralOffset(x, z);
    if (Math.abs(lat) > PLAYER.maxLateral) {
      const center = roadCenterX(z);
      x = center + Math.sign(lat) * PLAYER.maxLateral;
      this.blockedByForest = true;
    }
    z = clamp(z, PLAYER.zMin, PLAYER.zMax);

    const moved = Math.hypot(x - this.position.x, z - this.position.z);
    this.position.x = x;
    this.position.z = z;
    this.groundY = damp(this.groundY, groundHeight(x, z), 14, dt);
    this.position.y = this.groundY;

    this.distanceSinceStep += moved;
    const stride = run ? 0.95 : 0.68;
    if (moved > 0) this.bobPhase += (moved / stride) * Math.PI;
    if (this.distanceSinceStep > stride) {
      this.distanceSinceStep = 0;
      return true;
    }
    return false;
  }

  applyCamera(camera: PerspectiveCamera, bob: boolean): void {
    const amount = bob ? Math.min(1, this.speed / PLAYER.walk) : 0;
    const bobY = Math.sin(this.bobPhase) * 0.035 * amount;
    const bobX = Math.cos(this.bobPhase * 0.5) * 0.02 * amount;
    camera.position.set(this.position.x + Math.cos(this.yaw) * bobX, this.position.y + PLAYER.eye + bobY, this.position.z - Math.sin(this.yaw) * bobX);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
  }

  forward(out: Vector3): Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
}

/** Ground height under the player: flat road surface, terrain elsewhere. */
export function groundHeight(x: number, z: number): number {
  const lat = Math.abs(lateralOffset(x, z));
  if (lat < 5.6) return lat < 3.6 ? 0.01 : -0.01;
  return Math.max(-0.6, terrainHeight(x, z));
}
