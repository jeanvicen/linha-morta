/**
 * Cinematic camera: named shots per screen, slow critically damped transitions, gentle drift and
 * handheld micro-motion, plus composition offsets so the subject never sits behind the menu
 * (right third in landscape, upper area in portrait). Respects reduced motion.
 */
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { damp, fbm1D } from '../core/math';

export type ShotName = 'intro' | 'menu' | 'settings' | 'credits' | 'focus' | 'newgame';

interface Shot {
  position: Vector3;
  target: Vector3;
  fov: number;
  /** Horizontal subject shift in landscape (fraction of width, + = right). */
  shiftX: number;
  /** Vertical subject shift in portrait (fraction of height, + = up). */
  shiftY: number;
  drift: number;
  /** Optional camera placement for portrait screens (narrow horizontal field of view). */
  portrait?: { position: Vector3; target: Vector3 };
}

const SHOTS: Record<ShotName, Shot> = {
  intro: {
    position: new Vector3(-0.4, 0.32, 6.2),
    target: new Vector3(1.2, 0.45, -3.5),
    fov: 40,
    shiftX: 0.14,
    shiftY: 0.12,
    drift: 0.2,
    portrait: { position: new Vector3(0.2, 0.4, 8.5), target: new Vector3(1.4, 0.6, -2.4) },
  },
  menu: {
    position: new Vector3(-3.3, 1.22, 7.9),
    target: new Vector3(0.9, 0.92, -5.2),
    fov: 42,
    shiftX: 0.16,
    shiftY: 0.18,
    drift: 1,
    portrait: { position: new Vector3(-1.6, 1.45, 10.5), target: new Vector3(1.3, 0.8, -2.6) },
  },
  settings: {
    position: new Vector3(-1.4, 0.85, 2.6),
    target: new Vector3(-2.6, 0.75, -9.5),
    fov: 46,
    shiftX: 0.18,
    shiftY: 0.2,
    drift: 0.6,
    portrait: { position: new Vector3(0.6, 1.0, 4.5), target: new Vector3(-1.4, 0.7, -8) },
  },
  credits: { position: new Vector3(-2.2, 1.5, 5.2), target: new Vector3(-6.0, 6.5, -48), fov: 50, shiftX: 0, shiftY: 0.05, drift: 0.8 },
  focus: {
    position: new Vector3(-2.7, 1.0, 5.4),
    target: new Vector3(1.4, 0.82, -2.4),
    fov: 38,
    shiftX: -0.12,
    shiftY: 0.2,
    drift: 0.5,
    portrait: { position: new Vector3(-1.2, 1.2, 8.2), target: new Vector3(1.5, 0.8, -2.3) },
  },
  newgame: { position: new Vector3(0.0, 1.05, 1.6), target: new Vector3(1.6, 0.85, -2.3), fov: 36, shiftX: 0, shiftY: 0.05, drift: 0.2 },
};

export class CameraRig {
  private readonly pos = new Vector3();
  private readonly target = new Vector3();
  private fov = 42;
  private shiftX = 0;
  private shiftY = 0;
  private drift = 1;
  private shot: Shot = SHOTS.intro;
  private speed = 1.2;
  private readonly tmp = new Vector3();
  private viewW = 1;
  private viewH = 1;
  reducedMotion = false;
  /** When false (first-person gameplay) the rig does not touch the camera. */
  active = true;

  constructor(private readonly camera: PerspectiveCamera) {
    this.cut('intro');
  }

  /** Immediately places the camera on a shot. */
  cut(name: ShotName): void {
    this.shot = SHOTS[name];
    const place = this.placement(this.shot);
    this.pos.copy(place.position);
    this.target.copy(place.target);
    this.fov = this.shot.fov;
    this.shiftX = this.shot.shiftX;
    this.shiftY = this.shot.shiftY;
    this.drift = this.shot.drift;
  }

  /** Smoothly moves to a shot. `speed` is the damping rate (higher = faster). */
  go(name: ShotName, speed = 1.1): void {
    this.shot = SHOTS[name];
    this.speed = speed;
    if (this.reducedMotion) this.cut(name);
  }

  setViewport(width: number, height: number): void {
    this.viewW = Math.max(1, width);
    this.viewH = Math.max(1, height);
  }

  private get portrait(): boolean {
    return this.viewW / this.viewH < 0.9;
  }

  private placement(shot: Shot): { position: Vector3; target: Vector3 } {
    return this.portrait && shot.portrait ? shot.portrait : shot;
  }

  update(dt: number, time: number): void {
    if (!this.active) return;
    const s = this.shot;
    const place = this.placement(s);
    const k = this.reducedMotion ? 50 : this.speed;
    this.pos.x = damp(this.pos.x, place.position.x, k, dt);
    this.pos.y = damp(this.pos.y, place.position.y, k, dt);
    this.pos.z = damp(this.pos.z, place.position.z, k, dt);
    this.target.x = damp(this.target.x, place.target.x, k, dt);
    this.target.y = damp(this.target.y, place.target.y, k, dt);
    this.target.z = damp(this.target.z, place.target.z, k, dt);
    this.fov = damp(this.fov, s.fov, k, dt);
    this.shiftX = damp(this.shiftX, s.shiftX, k, dt);
    this.shiftY = damp(this.shiftY, s.shiftY, k, dt);
    this.drift = damp(this.drift, s.drift, k, dt);

    const cam = this.camera;
    cam.position.copy(this.pos);
    this.tmp.copy(this.target);
    if (!this.reducedMotion) {
      // Slow dolly drift + handheld micro-motion.
      const d = this.drift;
      cam.position.x += Math.sin(time * 0.045) * 0.55 * d;
      cam.position.y += Math.sin(time * 0.07 + 1.2) * 0.07 * d;
      cam.position.z += Math.sin(time * 0.033 + 0.4) * 0.35 * d;
      cam.position.x += fbm1D(time * 0.35, 1) * 0.018;
      cam.position.y += fbm1D(time * 0.4, 2) * 0.014;
      this.tmp.x += fbm1D(time * 0.25, 3) * 0.05;
      this.tmp.y += fbm1D(time * 0.3, 4) * 0.035;
    }
    cam.lookAt(this.tmp);
    if (!this.reducedMotion) cam.rotateZ(fbm1D(time * 0.2, 5) * 0.004);
    this.applyFraming(this.fov, this.shiftX, this.shiftY);
  }

  /** Applies composition offsets via a view offset on a larger virtual frame. */
  applyFraming(fov: number, shiftX: number, shiftY: number): void {
    const cam = this.camera;
    const w = this.viewW;
    const h = this.viewH;
    const aspect = w / h;
    const portrait = aspect < 0.9;
    const sx = portrait ? 0 : shiftX * Math.min(1, (aspect - 0.9) / 0.6);
    const sy = portrait ? shiftY : 0;
    const winFov = portrait ? Math.min(75, fov * (1.1 + (0.9 - aspect) * 0.9)) : fov;
    const fullW = w * (1 + 2 * Math.abs(sx));
    const fullH = h * (1 + 2 * Math.abs(sy));
    const offX = sx >= 0 ? 0 : fullW - w;
    const offY = sy >= 0 ? fullH - h : 0;
    const tanHalf = Math.tan(MathUtils.degToRad(winFov / 2)) * (fullH / h);
    cam.fov = MathUtils.radToDeg(2 * Math.atan(tanHalf));
    cam.aspect = fullW / fullH;
    cam.setViewOffset(fullW, fullH, offX, offY, w, h);
    cam.updateProjectionMatrix();
  }
}
