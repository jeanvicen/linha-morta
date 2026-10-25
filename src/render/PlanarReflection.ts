/**
 * Planar reflection for the wet road (y = 0 plane). Renders the scene mirrored into a
 * reduced-resolution render target with an oblique clip plane, based on three's Reflector.
 * Objects on layer `NO_REFLECT_LAYER` (rain, the road itself) are skipped.
 */
import {
  HalfFloatType,
  LinearFilter,
  Matrix4,
  PerspectiveCamera,
  Plane,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';

export const NO_REFLECT_LAYER = 2;

export class PlanarReflection {
  readonly target: WebGLRenderTarget;
  readonly textureMatrix = new Matrix4();
  private readonly camera = new PerspectiveCamera();
  private readonly plane = new Plane();
  private readonly clipPlane = new Vector4();
  private readonly q = new Vector4();
  private readonly normal = new Vector3(0, 1, 0);
  private readonly origin = new Vector3(0, 0, 0);
  private readonly view = new Vector3();
  private readonly lookAt = new Vector3();
  private readonly tmp = new Vector3();
  private readonly camPos = new Vector3();
  private readonly rot = new Matrix4();
  scale: number;
  enabled = true;

  constructor(scale = 0.5) {
    this.scale = scale;
    this.target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true });
    this.target.texture.name = 'PlanarReflection';
    this.target.texture.generateMipmaps = false;
    this.camera.layers.enableAll();
    this.camera.layers.disable(NO_REFLECT_LAYER);
  }

  setSize(drawingWidth: number, drawingHeight: number): void {
    const w = Math.max(64, Math.round(drawingWidth * this.scale));
    const h = Math.max(64, Math.round(drawingHeight * this.scale));
    if (w !== this.target.width || h !== this.target.height) this.target.setSize(w, h);
  }

  render(renderer: WebGLRenderer, scene: Scene, source: Camera & { far: number }, hide: { visible: boolean }[]): void {
    if (!this.enabled) return;
    this.camPos.setFromMatrixPosition(source.matrixWorld);
    if (this.camPos.y <= 0.02) return;

    // Mirror the camera position across the y = 0 plane.
    this.view.set(this.camPos.x, -this.camPos.y, this.camPos.z);

    this.rot.extractRotation(source.matrixWorld);
    this.lookAt.set(0, 0, -1).applyMatrix4(this.rot).add(this.camPos);
    this.tmp.copy(this.lookAt);
    this.tmp.y = -this.tmp.y;

    const cam = this.camera;
    cam.position.copy(this.view);
    cam.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.normal);
    cam.lookAt(this.tmp);
    cam.far = source.far;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy((source as PerspectiveCamera).projectionMatrix);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    // Oblique near plane so nothing below the road surface is rendered.
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.origin).applyMatrix4(cam.matrixWorldInverse);
    this.clipPlane.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const pm = cam.projectionMatrix.elements;
    this.q.x = (Math.sign(this.clipPlane.x) + pm[8]!) / pm[0]!;
    this.q.y = (Math.sign(this.clipPlane.y) + pm[9]!) / pm[5]!;
    this.q.z = -1;
    this.q.w = (1 + pm[10]!) / pm[14]!;
    this.clipPlane.multiplyScalar(2 / this.clipPlane.dot(this.q));
    pm[2] = this.clipPlane.x;
    pm[6] = this.clipPlane.y;
    pm[10] = this.clipPlane.z + 1 - 0.003;
    pm[14] = this.clipPlane.w;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

    const previous = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const currentTarget = renderer.getRenderTarget();
    const autoUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(currentTarget);
    renderer.shadowMap.autoUpdate = autoUpdate;
    hide.forEach((o, i) => (o.visible = previous[i]!));
  }

  dispose(): void {
    this.target.dispose();
  }
}
