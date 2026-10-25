/**
 * Roadside props that give the scene a sense of place: dead power lines (with a snapped cable),
 * a guardrail, Brazilian road signs, a km marker, a rural bus shelter, a distant farmhouse with a
 * flickering window and a radio tower with a blinking aviation light.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  Sprite,
  SpriteMaterial,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, randRange } from '../core/math';
import { ROAD, roadCenterX, roadHeading, roadSlope, terrainHeight } from './layout';
import { ctx2d, makeCanvas, toTexture } from './procedural/textures';

/** Point at a lateral offset from the road centerline (positive = +X side). */
export function roadPoint(z: number, lateral: number, out = new Vector3()): Vector3 {
  const s = roadSlope(z);
  const len = Math.hypot(1, s);
  const x = roadCenterX(z) + lateral / len;
  const zz = z - (lateral * s) / len;
  return out.set(x, terrainHeight(x, zz), zz);
}

export function createGlow(texture: Texture, color: string, intensity: number, size: number): Sprite {
  const mat = new SpriteMaterial({
    map: texture,
    color: new Color(color).multiplyScalar(intensity),
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: true,
  });
  const sprite = new Sprite(mat);
  sprite.scale.setScalar(size);
  return sprite;
}

function signTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): Texture {
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  draw(ctx, w, h);
  // Weathering: grime and streaks.
  const rng = createRng(w * 7 + h);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(30,25,20,${rng() * 0.12})`;
    ctx.fillRect(rng() * w, rng() * h, 2 + rng() * 6, 10 + rng() * 60);
  }
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, 'rgba(40,32,24,0.35)');
  g.addColorStop(0.4, 'rgba(40,32,24,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return toTexture(c, { repeat: false });
}

export class Props {
  readonly group = new Group();
  private readonly materials: Material[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly textures: Texture[] = [];
  private readonly towerLight: Sprite;
  private readonly windowGlow: Sprite;
  private readonly windowMat: MeshStandardMaterial;
  /** Simple circle colliders for first-person movement. */
  readonly colliders: { x: number; z: number; r: number }[] = [];
  /** World position of the note left on the bus shelter bench (prologue). */
  readonly busNote = new Vector3();
  /** World position of the "KM 112" marker (prologue destination). */
  readonly km112 = new Vector3();
  private noteMesh: Mesh | null = null;

  constructor(glow: Texture) {
    const concrete = this.mat(new MeshStandardMaterial({ color: '#8d8a84', roughness: 0.85 }));
    const metal = this.mat(new MeshStandardMaterial({ color: '#8b9095', roughness: 0.42, metalness: 0.85 }));
    const darkMetal = this.mat(new MeshStandardMaterial({ color: '#3d4044', roughness: 0.6, metalness: 0.7 }));
    const cable = this.mat(new MeshStandardMaterial({ color: '#0e0e0e', roughness: 0.5 }));
    const ceramic = this.mat(new MeshStandardMaterial({ color: '#5d6d64', roughness: 0.25 }));

    this.buildPowerLines(concrete, cable, ceramic, darkMetal);
    this.buildGuardrail(metal, darkMetal);
    this.buildSigns(darkMetal, concrete);
    this.buildBusShelter(concrete);

    // Distant farmhouse with a flickering window (someone lit a lamp despite the blackout).
    const house = new Group();
    const wall = this.mat(new MeshStandardMaterial({ color: '#6f675d', roughness: 0.9 }));
    const roof = this.mat(new MeshStandardMaterial({ color: '#3b2620', roughness: 0.8 }));
    const body = new Mesh(this.geo(new BoxGeometry(9, 3.4, 6)), wall);
    body.position.y = 1.7;
    const roofShape = new Shape();
    roofShape.moveTo(-3.4, 0);
    roofShape.lineTo(0, 2.0);
    roofShape.lineTo(3.4, 0);
    roofShape.lineTo(-3.4, 0);
    const roofGeo = this.geo(new ExtrudeGeometry(roofShape, { depth: 9.6, bevelEnabled: false }));
    roofGeo.rotateY(Math.PI / 2);
    roofGeo.translate(-4.8, 3.4, 0);
    const roofMesh = new Mesh(roofGeo, roof);
    this.windowMat = this.mat(new MeshStandardMaterial({ color: '#000000', emissive: '#ffb35c', emissiveIntensity: 3 })) as MeshStandardMaterial;
    const win = new Mesh(this.geo(new PlaneGeometry(1.0, 0.9)), this.windowMat);
    win.position.set(1.8, 1.9, 3.01);
    house.add(body, roofMesh, win);
    const hp = roadPoint(-175, 64);
    house.position.copy(hp);
    house.position.y -= 0.3;
    house.rotation.y = -0.5;
    this.windowGlow = createGlow(glow, '#ffb35c', 2.2, 5);
    this.windowGlow.position.set(1.8, 1.9, 3.3);
    house.add(this.windowGlow);
    this.group.add(house);

    // Radio tower far away: only its red light pierces the fog.
    const tp = roadPoint(-300, -150);
    const tower = new Mesh(this.geo(new CylinderGeometry(0.15, 1.6, 46, 4, 1, true)), darkMetal);
    tower.position.set(tp.x, tp.y + 23, tp.z);
    this.towerLight = createGlow(glow, '#ff2a1a', 5, 6);
    this.towerLight.position.set(tp.x, tp.y + 46.5, tp.z);
    this.group.add(tower, this.towerLight);
  }

  private mat<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private buildPowerLines(concrete: Material, cable: Material, ceramic: Material, metal: Material): void {
    const poleGeo = this.geo(new BoxGeometry(0.26, 10.5, 0.2));
    poleGeo.translate(0, 5.25, 0);
    // Taper the pole toward the top.
    const pos = poleGeo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / 10.5;
      pos.setX(i, pos.getX(i) * (1 - t * 0.45));
      pos.setZ(i, pos.getZ(i) * (1 - t * 0.35));
    }
    poleGeo.computeVertexNormals();
    const armGeo = this.geo(new BoxGeometry(2.3, 0.11, 0.11));
    const insGeo = this.geo(new CylinderGeometry(0.05, 0.07, 0.18, 8));
    const trafoGeo = this.geo(new CylinderGeometry(0.35, 0.35, 0.9, 12));
    const attach: Vector3[][] = [];
    const lateral = -9.8;
    let index = 0;
    for (let z = ROAD.zStart + 30; z < ROAD.zEnd - 20; z += 38) {
      const p = roadPoint(z, lateral);
      const heading = roadHeading(z);
      const pole = new Group();
      pole.position.copy(p);
      pole.position.y -= 0.2;
      pole.rotation.y = heading;
      const shaft = new Mesh(poleGeo, concrete);
      shaft.castShadow = true;
      const arm = new Mesh(armGeo, metal);
      arm.position.y = 9.9;
      pole.add(shaft, arm);
      const points: Vector3[] = [];
      for (const ox of [-1.0, 0, 1.0]) {
        const ins = new Mesh(insGeo, ceramic);
        ins.position.set(ox, 10.05, 0);
        pole.add(ins);
        points.push(new Vector3(ox, 10.15, 0));
      }
      if (index % 4 === 2) {
        const trafo = new Mesh(trafoGeo, metal);
        trafo.position.set(0, 8.2, 0.3);
        pole.add(trafo);
      }
      pole.updateMatrixWorld(true);
      attach.push(points.map((pt) => pt.applyMatrix4(pole.matrixWorld)));
      this.group.add(pole);
      this.colliders.push({ x: p.x, z: p.z, r: 0.3 });
      index++;
    }
    const cables: BufferGeometry[] = [];
    for (let i = 0; i < attach.length - 1; i++) {
      for (let c = 0; c < 3; c++) {
        const a = attach[i]![c]!;
        const b = attach[i + 1]![c]!;
        // The middle wire between two poles near the car snapped and hangs to the ground.
        const snapped = c === 2 && a.z > -30 && a.z < 12;
        const pts: Vector3[] = [];
        if (snapped) {
          for (let k = 0; k <= 12; k++) {
            const t = k / 12;
            const x = a.x + (2.2 + t * 1.4) * t;
            const z = a.z - t * 6.5;
            const y = a.y * (1 - t) * (1 - t * 0.2) + terrainHeight(x, z) * t + 0.03;
            pts.push(new Vector3(x, y, z));
          }
        } else {
          for (let k = 0; k <= 16; k++) {
            const t = k / 16;
            const p = a.clone().lerp(b, t);
            p.y -= Math.sin(t * Math.PI) * 1.1;
            pts.push(p);
          }
        }
        cables.push(new TubeGeometry(new CatmullRomCurve3(pts), snapped ? 24 : 16, 0.014, 4, false));
      }
    }
    const merged = this.geo(mergeGeometries(cables)!);
    for (const g of cables) g.dispose();
    this.group.add(new Mesh(merged, cable));
  }

  private buildGuardrail(metal: Material, postMat: Material): void {
    const profile = new Shape();
    // W-beam cross-section (meters).
    profile.moveTo(0, 0);
    profile.lineTo(0.04, 0.05);
    profile.lineTo(0.0, 0.1);
    profile.lineTo(0.04, 0.15);
    profile.lineTo(0.0, 0.2);
    profile.lineTo(0.006, 0.2);
    profile.lineTo(0.046, 0.15);
    profile.lineTo(0.006, 0.1);
    profile.lineTo(0.046, 0.05);
    profile.lineTo(0.006, 0);
    profile.lineTo(0, 0);
    const beams: BufferGeometry[] = [];
    const posts: BufferGeometry[] = [];
    const postBase = new BoxGeometry(0.12, 0.8, 0.08);
    postBase.translate(0, 0.4, 0);
    const ranges: [number, number][] = [
      [-95, -22],
      [24, 70],
    ];
    const rng = createRng(8);
    for (const [z0, z1] of ranges) {
      for (let z = z0; z < z1; z += 4) {
        const a = roadPoint(z, 6.15);
        const b = roadPoint(z + 4, 6.15);
        a.y = Math.max(a.y, -0.05);
        b.y = Math.max(b.y, -0.05);
        const len = a.distanceTo(b);
        const seg = new ExtrudeGeometry(profile, { depth: len + 0.05, bevelEnabled: false, curveSegments: 1 });
        const yaw = Math.atan2(b.x - a.x, b.z - a.z);
        seg.rotateY(yaw);
        seg.translate(a.x, a.y + 0.48, a.z);
        beams.push(seg);
        const post = postBase.clone();
        post.rotateY(yaw);
        post.rotateZ((rng() - 0.5) * 0.06);
        post.translate(a.x + 0.06, a.y - 0.05, a.z);
        posts.push(post);
      }
    }
    const beamGeo = this.geo(mergeGeometries(beams)!);
    const postGeo = this.geo(mergeGeometries(posts)!);
    for (const g of [...beams, ...posts, postBase]) g.dispose();
    const beamMesh = new Mesh(beamGeo, metal);
    beamMesh.castShadow = true;
    beamMesh.receiveShadow = true;
    this.group.add(beamMesh, new Mesh(postGeo, postMat));
  }

  private buildSigns(postMat: Material, concrete: Material): void {
    const addSign = (tex: Texture, w: number, h: number, z: number, lateral: number, height: number, posts: number, shape?: 'circle' | 'diamond'): void => {
      this.textures.push(tex);
      const group = new Group();
      const p = roadPoint(z, lateral);
      group.position.copy(p);
      group.rotation.y = roadHeading(z);
      const face = this.mat(new MeshStandardMaterial({ map: tex, roughness: 0.38, metalness: 0.15, side: DoubleSide, alphaTest: shape ? 0.5 : 0 }));
      const plane = new Mesh(this.geo(new PlaneGeometry(w, h)), face);
      plane.position.y = height + h / 2;
      if (shape === 'diamond') plane.rotation.z = Math.PI / 4;
      const back = new Mesh(plane.geometry, postMat);
      back.position.copy(plane.position);
      back.position.z -= 0.012;
      back.rotation.copy(plane.rotation);
      back.rotation.y = Math.PI;
      group.add(plane, back);
      const postGeo = this.geo(new CylinderGeometry(0.04, 0.04, height + h * 0.7, 8));
      const offsets = posts === 2 ? [-w * 0.35, w * 0.35] : [0];
      for (const ox of offsets) {
        const post = new Mesh(postGeo, postMat);
        post.position.set(ox, (height + h * 0.7) / 2 - 0.2, -0.03);
        post.castShadow = true;
        group.add(post);
      }
      group.traverse((o) => {
        if (o instanceof Mesh) o.castShadow = true;
      });
      this.group.add(group);
      this.colliders.push({ x: p.x, z: p.z, r: 0.25 });
    };

    // Green directional sign (fictional destinations).
    const dir = signTexture(
      (ctx, w, h) => {
        ctx.fillStyle = '#0f5a35';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#e8e8e2';
        ctx.lineWidth = 10;
        ctx.strokeRect(14, 14, w - 28, h - 28);
        ctx.fillStyle = '#ecebe4';
        ctx.font = 'bold 64px sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText('SÃO TOMÉ DAS ÁGUAS', 50, h * 0.33);
        ctx.fillText('VILA DO CARMO', 50, h * 0.68);
        ctx.textAlign = 'right';
        ctx.fillText('31 km', w - 50, h * 0.33);
        ctx.fillText('58 km', w - 50, h * 0.68);
      },
      1024,
      400,
    );
    addSign(dir, 3.4, 1.33, -42, 7.4, 1.9, 2);

    const speed = signTexture(
      (ctx, w) => {
        ctx.clearRect(0, 0, w, w);
        ctx.beginPath();
        ctx.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2);
        ctx.fillStyle = '#c81e1e';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(w / 2, w / 2, w * 0.38, 0, Math.PI * 2);
        ctx.fillStyle = '#efefe9';
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.font = `bold ${w * 0.36}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('80', w / 2, w / 2 + 4);
      },
      256,
      256,
    );
    addSign(speed, 0.8, 0.8, -78, -7.0, 1.8, 1, 'circle');

    const curve = signTexture(
      (ctx, w) => {
        ctx.clearRect(0, 0, w, w);
        ctx.fillStyle = '#e8b416';
        ctx.fillRect(10, 10, w - 20, w - 20);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 10;
        ctx.strokeRect(22, 22, w - 44, w - 44);
        ctx.save();
        ctx.translate(w / 2, w / 2);
        ctx.rotate(-Math.PI / 4);
        ctx.lineWidth = 22;
        ctx.beginPath();
        ctx.moveTo(-10, 70);
        ctx.quadraticCurveTo(-10, -10, 40, -40);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(30, -75);
        ctx.lineTo(70, -45);
        ctx.lineTo(25, -15);
        ctx.fillStyle = '#111';
        ctx.fill();
        ctx.restore();
      },
      256,
      256,
    );
    addSign(curve, 0.85, 0.85, -128, 7.0, 1.8, 1, 'diamond');

    // Km markers ("marco quilométrico"): km 113 beside the car, km 112 further down the road.
    const marker = (km: string, z: number, lateral: number): Vector3 => {
      const tex = signTexture(
        (ctx, w, h) => {
          ctx.fillStyle = '#f0efe9';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#111';
          ctx.font = 'bold 54px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('KM', w / 2, h * 0.38);
          ctx.font = 'bold 84px sans-serif';
          ctx.fillText(km, w / 2, h * 0.78);
        },
        256,
        256,
      );
      this.textures.push(tex);
      const group = new Group();
      const p = roadPoint(z, lateral);
      group.position.copy(p);
      group.rotation.y = roadHeading(z);
      const post = new Mesh(this.geo(new BoxGeometry(0.25, 0.9, 0.12)), concrete);
      post.position.y = 0.4;
      post.castShadow = true;
      const plate = new Mesh(this.geo(new PlaneGeometry(0.22, 0.22)), this.mat(new MeshStandardMaterial({ map: tex, roughness: 0.5 })));
      plate.position.set(0, 0.62, 0.061);
      group.add(post, plate);
      this.group.add(group);
      this.colliders.push({ x: p.x, z: p.z, r: 0.25 });
      return p;
    };
    marker('113', 6, -6.5);
    this.km112.copy(marker('112', -122, -6.4));
  }

  private buildBusShelter(concrete: Material): void {
    const shelter = new Group();
    // Beyond the drainage ditch, open side facing the road.
    const p = roadPoint(-30, 10.6);
    shelter.position.copy(p);
    shelter.position.y = p.y - 0.02;
    shelter.rotation.y = roadHeading(-30) + Math.PI / 2;
    const slab = new Mesh(this.geo(new BoxGeometry(3.4, 0.12, 2.0)), concrete);
    slab.position.y = 2.4;
    const back = new Mesh(this.geo(new BoxGeometry(3.2, 2.4, 0.12)), concrete);
    back.position.set(0, 1.2, 0.9);
    const sideGeo = this.geo(new BoxGeometry(0.12, 2.4, 1.8));
    const s1 = new Mesh(sideGeo, concrete);
    s1.position.set(-1.55, 1.2, 0.05);
    const s2 = new Mesh(sideGeo, concrete);
    s2.position.set(1.55, 1.2, 0.05);
    const bench = new Mesh(this.geo(new BoxGeometry(2.6, 0.08, 0.4)), concrete);
    bench.position.set(0, 0.48, 0.6);
    // Concrete base sunk into the slope so the shelter never floats over uneven ground.
    const floor = new Mesh(this.geo(new BoxGeometry(3.6, 1.4, 2.4)), concrete);
    floor.position.y = -0.62;
    for (const m of [slab, back, s1, s2, bench, floor]) {
      m.castShadow = true;
      m.receiveShadow = true;
      shelter.add(m);
    }
    // A folded note on the bench, held down by a stone.
    const paper = new Mesh(this.geo(new PlaneGeometry(0.22, 0.16)), this.mat(new MeshStandardMaterial({ color: '#d9d3c4', roughness: 0.9, side: DoubleSide })));
    paper.rotation.set(-Math.PI / 2, 0, 0.3);
    paper.position.set(0.4, 0.525, 0.55);
    const stone = new Mesh(this.geo(new BoxGeometry(0.07, 0.05, 0.06)), concrete);
    stone.position.set(0.45, 0.55, 0.57);
    shelter.add(paper, stone);
    this.noteMesh = paper;
    this.group.add(shelter);
    shelter.updateMatrixWorld(true);
    paper.getWorldPosition(this.busNote);
    // Collide with the back wall only, so the bench stays reachable.
    const backWall = new Vector3(0, 0, 0.9).applyMatrix4(shelter.matrixWorld);
    this.colliders.push({ x: backWall.x, z: backWall.z, r: 1.0 });
    for (const sx of [-1.55, 1.55]) {
      const side = new Vector3(sx, 0, 0.2).applyMatrix4(shelter.matrixWorld);
      this.colliders.push({ x: side.x, z: side.z, r: 0.45 });
    }
  }

  setNoteVisible(visible: boolean): void {
    if (this.noteMesh) this.noteMesh.visible = visible;
  }

  /** Animates the distant lights. */
  update(time: number, reduceFlashes: boolean): void {
    const blink = reduceFlashes ? 0.6 : Math.sin(time * Math.PI) > 0.55 ? 1 : 0.04;
    (this.towerLight.material as SpriteMaterial).opacity = blink;
    const rng = Math.sin(time * 13.1) * Math.sin(time * 7.7 + 1.3) * Math.sin(time * 2.3);
    const flicker = reduceFlashes ? 0.85 : 0.75 + 0.25 * rng + (Math.sin(time * 0.31) > 0.97 ? -0.6 : 0);
    this.windowMat.emissiveIntensity = 3 * Math.max(0.15, flicker);
    (this.windowGlow.material as SpriteMaterial).opacity = Math.max(0.1, flicker);
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    for (const t of this.textures) t.dispose();
  }
}

/** Dense forest silhouettes in the distance (cheap layered cards that dissolve into the fog). */
export function createTreeline(): { mesh: Group; dispose: () => void } {
  const W = 1024;
  const H = 512;
  const c = makeCanvas(W, H);
  const ctx = ctx2d(c);
  ctx.clearRect(0, 0, W, H);
  const rng = createRng(73);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 70; i++) {
    const x = rng() * W;
    const top = H * (0.08 + rng() * 0.45);
    const r = 30 + rng() * 70;
    for (let k = 0; k < 9; k++) {
      ctx.beginPath();
      ctx.arc(x + (rng() - 0.5) * r * 1.4, top + rng() * r * 1.4, r * (0.35 + rng() * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillRect(x - 3, top + r, 6, H);
  }
  ctx.fillRect(0, H * 0.7, W, H * 0.3);
  const tex = toTexture(c, { srgb: false, repeat: false });
  const mat = new MeshStandardMaterial({ color: '#0d120f', alphaMap: tex, alphaTest: 0.5, side: DoubleSide, roughness: 1 });
  const group = new Group();
  const geo = new PlaneGeometry(46, 23);
  geo.translate(0, 11.5 - 1.5, 0);
  const rng2 = createRng(5);
  for (const side of [-1, 1]) {
    for (let z = ROAD.zStart + 30; z < ROAD.zEnd; z += 26) {
      for (let row = 0; row < 2; row++) {
        const lat = side * randRange(rng2, 58, 75) + side * row * 22;
        const p = roadPoint(z + rng2() * 12, lat);
        const m = new Mesh(geo, mat);
        m.position.copy(p);
        m.rotation.y = roadHeading(z) + Math.PI / 2 + (rng2() - 0.5) * 0.3;
        m.scale.setScalar(randRange(rng2, 0.85, 1.3));
        group.add(m);
      }
    }
  }
  return {
    mesh: group,
    dispose: () => {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
