import * as THREE from 'three';
import { TRACK_LENGTH } from '../../../shared/game';
import { Flag, enableShadows } from './models';
import {
  bannerTexture,
  finishLineTexture,
  numberDecalTexture,
  sandTextures,
  sandstoneTextures,
  trackTextures,
  woodTexture,
} from './textures';

// Circuito ovalado ("estadio": dos rectas y dos curvas) sobre el desierto.
// Las 16 casillas se reparten a lo largo de la línea central; la meta está
// en el centro de la recta del fondo (z negativa) y se corre en sentido horario.

export const TRACK = {
  R: 4.0, // radio de las curvas (línea central)
  L: 5.05, // longitud de cada recta
  W: 2.3, // anchura de la pista
  Y: 0.03, // altura de la superficie
};
export const PERIMETER = 2 * TRACK.L + 2 * Math.PI * TRACK.R;
export const SPACE_LENGTH = PERIMETER / TRACK_LENGTH;

export interface TrackPoint {
  p: THREE.Vector3; // punto en la línea central
  t: THREE.Vector3; // tangente (sentido de la carrera)
  n: THREE.Vector3; // normal hacia fuera del óvalo
}

/** Punto a una distancia `d` de la meta, recorriendo la pista en sentido horario. */
export function trackPoint(d: number, offset = 0, y = TRACK.Y): TrackPoint {
  const { R, L } = TRACK;
  d = ((d % PERIMETER) + PERIMETER) % PERIMETER;
  const curve = Math.PI * R;
  let p: THREE.Vector3;
  let t: THREE.Vector3;
  if (d < L / 2) {
    p = new THREE.Vector3(d, y, -R);
    t = new THREE.Vector3(1, 0, 0);
  } else if (d < L / 2 + curve) {
    const a = (d - L / 2) / R;
    p = new THREE.Vector3(L / 2 + R * Math.sin(a), y, -R * Math.cos(a));
    t = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  } else if (d < (3 * L) / 2 + curve) {
    p = new THREE.Vector3(L / 2 - (d - L / 2 - curve), y, R);
    t = new THREE.Vector3(-1, 0, 0);
  } else if (d < (3 * L) / 2 + 2 * curve) {
    const a = (d - (3 * L) / 2 - curve) / R;
    p = new THREE.Vector3(-L / 2 - R * Math.sin(a), y, R * Math.cos(a));
    t = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a));
  } else {
    p = new THREE.Vector3(-L / 2 + (d - (3 * L) / 2 - 2 * curve), y, -R);
    t = new THREE.Vector3(1, 0, 0);
  }
  const n = new THREE.Vector3(t.z, 0, -t.x);
  if (offset) p.addScaledVector(n, offset);
  return { p, t, n };
}

const wrap = (space: number) => ((((space - 1) % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH) + 1;

/** Distancia desde la meta hasta el centro de una casilla. */
export const spaceDistance = (space: number) => (wrap(space) - 0.5) * SPACE_LENGTH;

/** Ángulo (rotación Y) que apunta en la dirección de la tangente. */
export const headingOf = (t: THREE.Vector3) => Math.atan2(-t.z, t.x);

// ---------- Construcción de cintas a lo largo del óvalo ----------

const SAMPLES = 200;

/** Cinta horizontal entre dos desplazamientos laterales (con u a lo largo de la pista). */
function ribbon(inner: number, outer: number, y: number, uPerUnit: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const d = (i / SAMPLES) * PERIMETER;
    const a = trackPoint(d, inner, y).p;
    const b = trackPoint(d, outer, y).p;
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uv.push(d * uPerUnit, 0, d * uPerUnit, 1);
    if (i < SAMPLES) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); // orden para que la cara mire hacia arriba
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Bordillo: bloque bajo a lo largo del óvalo, con franjas alternas rojas y blancas. */
function curb(inner: number, outer: number, height: number, stripe: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const red = new THREE.Color('#c8432f');
  const cream = new THREE.Color('#f3e6c8');
  let v = 0;
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3, color: THREE.Color) => {
    for (const p of [a, b, c, d]) {
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      col.push(color.r, color.g, color.b);
    }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  };
  const steps = Math.round(PERIMETER / (stripe / 2));
  for (let i = 0; i < steps; i++) {
    const d0 = (i / steps) * PERIMETER;
    const d1 = ((i + 1) / steps) * PERIMETER;
    const color = Math.floor((d0 + 0.001) / stripe) % 2 ? red : cream;
    const i0 = trackPoint(d0, inner, 0);
    const i1 = trackPoint(d1, inner, 0);
    const o0 = trackPoint(d0, outer, 0);
    const o1 = trackPoint(d1, outer, 0);
    const up = (p: THREE.Vector3) => p.clone().setY(height);
    quad(up(i0.p), up(i1.p), up(o1.p), up(o0.p), new THREE.Vector3(0, 1, 0), color);
    quad(i0.p, i1.p, up(i1.p), up(i0.p), i0.n.clone().negate(), color);
    quad(up(o0.p), up(o1.p), o1.p, o0.p, o0.n, color);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// ---------- Gradas con público ----------

const ROBES = ['#f1ead8', '#c9b38a', '#3f6fb0', '#b54a3a', '#e3c15a', '#6a8f4e', '#8a4fc4', '#e8833a', '#21a89a'];
const SKINS = ['#8d5a36', '#c68b5a', '#e2b48a', '#5c3a22', '#a8704a'];

/** RNG con semilla fija: el público es idéntico en todos los navegadores (para sincronizar lanzamientos). */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Seat {
  x: number;
  y: number;
  z: number;
  phase: number;
  robe: string;
  skin: string;
  hidden: boolean;
}

export class Crowd {
  readonly group = new THREE.Group();
  readonly bodies: THREE.InstancedMesh;
  readonly heads: THREE.InstancedMesh;
  readonly seats: Seat[] = [];
  private dummy = new THREE.Object3D();

  constructor(rows: { y: number; z: number }[], x0: number, x1: number) {
    const rnd = seeded(20261022);
    const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
    for (const r of rows)
      for (let x = x0; x <= x1; x += 0.52) {
        const present = rnd() < 0.88;
        const seat: Seat = { x: x + (rnd() - 0.5) * 0.15, y: r.y, z: r.z, phase: rnd() * 10, robe: pick(ROBES), skin: pick(SKINS), hidden: false };
        if (present) this.seats.push(seat);
      }
    const n = this.seats.length;
    this.bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.15, 0.2, 4, 10), new THREE.MeshStandardMaterial({ roughness: 0.85 }), n);
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 14, 10), new THREE.MeshStandardMaterial({ roughness: 0.7 }), n);
    const c = new THREE.Color();
    this.seats.forEach((s, i) => {
      this.bodies.setColorAt(i, c.set(s.robe));
      this.heads.setColorAt(i, c.set(s.skin));
    });
    for (const m of [this.bodies, this.heads]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.group.add(this.bodies, this.heads);
    this.update(0, 0);
    this.bodies.computeBoundingSphere();
    this.heads.computeBoundingSphere();
  }

  /** Persona bajo el rayo (índice de asiento) o null. */
  pick(raycaster: THREE.Raycaster): number | null {
    const hit = raycaster.intersectObjects([this.bodies, this.heads], false)[0];
    if (hit?.instanceId === undefined) return null;
    return this.seats[hit.instanceId].hidden ? null : hit.instanceId;
  }

  /** Posición del cuerpo (centro) de una persona sentada, en coordenadas del mundo. */
  seatPosition(i: number): THREE.Vector3 {
    const s = this.seats[i];
    return this.group.localToWorld(new THREE.Vector3(s.x, s.y + 0.25, s.z));
  }

  /** excite: 0 = sentados charlando, 1 = saltando de emoción. */
  update(t: number, excite: number) {
    const d = this.dummy;
    this.seats.forEach((s, i) => {
      const calm = 0.02 * Math.sin(t * 2 + s.phase);
      const jump = excite * Math.abs(Math.sin(t * 9 + s.phase)) * 0.3;
      const y = s.y + calm + jump;
      // los que están volando por la pista se ocultan de las gradas
      const k = s.hidden ? 0 : 1;
      d.scale.setScalar(k);
      d.position.set(s.x, y + 0.25, s.z);
      d.rotation.set(0, 0, excite * 0.15 * Math.sin(t * 7 + s.phase));
      d.updateMatrix();
      this.bodies.setMatrixAt(i, d.matrix);
      d.position.set(s.x + excite * 0.04 * Math.sin(t * 7 + s.phase), y + 0.55, s.z);
      d.updateMatrix();
      this.heads.setMatrixAt(i, d.matrix);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}

// ---------- Circuito ----------

export class Circuit {
  readonly group = new THREE.Group();
  readonly crowd: Crowd;
  private stand = { x0: 0, x1: 0, front: 0, tiers: 0 };
  private flags: Flag[] = [];
  private pennants: THREE.Mesh[] = [];
  private exciteUntil = 0;
  private excite = 0;

  constructor() {
    const { W } = TRACK;
    const half = W / 2;

    // ---------- interior del óvalo ----------
    const sand = sandTextures(3);
    const inner = new THREE.Shape();
    for (let i = 0; i <= SAMPLES; i++) {
      const p = trackPoint((i / SAMPLES) * PERIMETER, -half - 0.12).p;
      if (i === 0) inner.moveTo(p.x, -p.z);
      else inner.lineTo(p.x, -p.z);
    }
    const infieldGeo = new THREE.ShapeGeometry(inner);
    infieldGeo.rotateX(-Math.PI / 2);
    const uv = infieldGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.12, uv.getY(i) * 0.12);
    const infield = new THREE.Mesh(
      infieldGeo,
      new THREE.MeshStandardMaterial({ map: sand.map, normalMap: sand.normalMap, color: '#f6dcae', roughness: 1 }),
    );
    infield.position.y = 0.004;
    infield.receiveShadow = true;
    this.group.add(infield);

    // ---------- superficie de la pista ----------
    const { map, normalMap } = trackTextures();
    const track = new THREE.Mesh(
      ribbon(-half, half, TRACK.Y, 1 / SPACE_LENGTH),
      new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.95 }),
    );
    track.receiveShadow = true;
    this.group.add(track);

    // bordillos interior y exterior
    const curbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    for (const [a, b] of [
      [-half - 0.22, -half],
      [half, half + 0.22],
    ]) {
      const m = new THREE.Mesh(curb(a, b, 0.14, 0.55), curbMat);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }

    // líneas de tiza entre casillas y números pintados
    const chalk = new THREE.MeshStandardMaterial({ color: '#fbf6ea', roughness: 0.9 });
    for (let s = 1; s <= TRACK_LENGTH; s++) {
      const start = (s - 1) * SPACE_LENGTH;
      if (s > 1) {
        const { p, t } = trackPoint(start, 0, TRACK.Y + 0.004);
        const line = new THREE.Mesh(new THREE.PlaneGeometry(0.09, W - 0.05), chalk);
        line.rotation.set(-Math.PI / 2, 0, Math.atan2(-t.z, t.x));
        line.position.copy(p);
        line.receiveShadow = true;
        this.group.add(line);
      }
      const { p, t } = trackPoint(start + SPACE_LENGTH / 2, half - 0.38, TRACK.Y + 0.006);
      const num = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.62),
        new THREE.MeshStandardMaterial({ map: numberDecalTexture(s), transparent: true, roughness: 0.9 }),
      );
      // el número se lee desde fuera de la pista
      num.rotation.set(-Math.PI / 2, 0, Math.atan2(-t.z, t.x) + Math.PI / 2);
      num.position.copy(p);
      num.receiveShadow = true;
      this.group.add(num);
    }

    // ---------- valla exterior de madera ----------
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture('#8a5a2e'), roughness: 0.8 });
    const fenceOff = half + 0.5;
    const postsCount = Math.round(PERIMETER / 1.1);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.9, 0.13), wood, postsCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < postsCount; i++) {
      const { p, t } = trackPoint((i / postsCount) * PERIMETER + 0.3, fenceOff, 0.45);
      dummy.position.copy(p);
      dummy.rotation.set(0, Math.atan2(-t.z, t.x), 0);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
    }
    posts.castShadow = posts.receiveShadow = true;
    this.group.add(posts);
    for (const y of [0.42, 0.78]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 120; i++) pts.push(trackPoint((i / 120) * PERIMETER, fenceOff, y).p);
      const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 240, 0.045, 6, true), wood);
      rail.castShadow = true;
      this.group.add(rail);
    }
    // banderines de colores colgando de la valla
    const pennantColors = ['#c8432f', '#f2c14e', '#2f78d0', '#3d9e4a', '#8547c0'];
    const pennantGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.14, 0, 0),
      new THREE.Vector3(0.14, 0, 0),
      new THREE.Vector3(0, -0.3, 0),
    ]);
    pennantGeo.computeVertexNormals();
    for (let i = 0; i < 64; i++) {
      const { p, t } = trackPoint((i / 64) * PERIMETER + 0.55, fenceOff + 0.03, 0.78);
      const m = new THREE.Mesh(
        pennantGeo,
        new THREE.MeshStandardMaterial({ color: pennantColors[i % pennantColors.length], side: THREE.DoubleSide, roughness: 0.8 }),
      );
      m.position.copy(p);
      m.rotation.y = Math.atan2(-t.z, t.x);
      m.userData.phase = Math.random() * 6;
      this.group.add(m);
      this.pennants.push(m);
    }

    // ---------- arco de meta ----------
    this.buildFinishGate();

    // ---------- gradas con público tras la recta de meta ----------
    const tiers = 4;
    const stand = new THREE.Group();
    const { map: stoneMap, normalMap: stoneNormal } = sandstoneTextures();
    const x0 = -7.2;
    const x1 = 7.2;
    const front = -TRACK.R - half - 1.25;
    const rows: { y: number; z: number }[] = [];
    for (let i = 0; i < tiers; i++) {
      const h = 0.45 * (i + 1);
      const depth = 0.95;
      const tier = new THREE.Mesh(
        new THREE.BoxGeometry(x1 - x0 + 0.8, h, depth),
        new THREE.MeshStandardMaterial({ map: stoneMap, normalMap: stoneNormal, roughness: 0.9 }),
      );
      const z = front - depth * (i + 0.5);
      tier.position.set(0, h / 2, z);
      tier.castShadow = tier.receiveShadow = true;
      stand.add(tier);
      // banco de madera sobre cada grada
      const bench = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.6, 0.08, 0.35), wood);
      bench.position.set(0, h + 0.04, z - 0.15);
      bench.castShadow = true;
      stand.add(bench);
      rows.push({ y: h + 0.02, z: z - 0.05 });
    }
    // mástiles con estandartes detrás de las gradas
    for (let i = 0; i < 5; i++) {
      const flag = new Flag();
      flag.group.position.set(x0 + (i / 4) * (x1 - x0), 0.45 * tiers, front - 0.95 * tiers - 0.2);
      flag.group.scale.setScalar(1.3);
      stand.add(flag.group);
      this.flags.push(flag);
    }
    this.crowd = new Crowd(rows, x0, x1);
    this.stand = { x0: x0 - 0.4, x1: x1 + 0.4, front, tiers };
    stand.add(this.crowd.group);
    this.group.add(stand);
  }

  private buildFinishGate() {
    const { W } = TRACK;
    const half = W / 2;
    // línea de meta a cuadros sobre la pista
    const { p } = trackPoint(0, 0, TRACK.Y + 0.006);
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, W),
      new THREE.MeshStandardMaterial({ map: finishLineTexture(), roughness: 0.7 }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.copy(p);
    line.receiveShadow = true;
    this.group.add(line);

    const { map, normalMap } = sandstoneTextures();
    const stone = new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.9 });
    const gold = new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 0.85, roughness: 0.25, emissive: '#ff9f1c', emissiveIntensity: 0.3 });
    const height = 4.6;
    const gate = new THREE.Group();
    for (const side of [-1, 1]) {
      const z = -TRACK.R + side * (half + 0.55);
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, height, 0.6), stone);
      pillar.position.set(0, height / 2, z);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.6, 4), gold);
      cap.rotation.y = Math.PI / 4;
      cap.position.set(0, height + 0.62, z);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.35, 0.85), stone);
      base.position.set(0, 0.17, z);
      gate.add(pillar, cap, base);
    }
    const span = W + 1.7;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, span), stone);
    beam.position.set(0, height + 0.12, -TRACK.R);
    gate.add(beam);
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(span - 0.8, 0.75),
      new THREE.MeshStandardMaterial({ map: bannerTexture('META'), side: THREE.DoubleSide, roughness: 0.8 }),
    );
    banner.rotation.y = Math.PI / 2;
    banner.position.set(0.26, height - 0.45, -TRACK.R);
    gate.add(banner);
    for (const side of [-1, 1]) {
      const flag = new Flag();
      flag.group.position.set(0, height + 0.3, -TRACK.R + side * (half + 0.55));
      flag.group.scale.setScalar(0.8);
      flag.group.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      gate.add(flag.group);
      this.flags.push(flag);
    }
    enableShadows(gate);
    this.group.add(gate);
  }

  /** Altura del suelo en (x, z): 0 en el desierto y la pista; la de cada escalón en las gradas. */
  groundHeight(x: number, z: number): number {
    const { x0, x1, front, tiers } = this.stand;
    if (x < x0 || x > x1 || z > front) return 0;
    const tier = Math.floor((front - z) / 0.95);
    return tier < tiers ? 0.45 * (tier + 1) : 0;
  }

  /** El público se emociona durante unos segundos. */
  cheer(seconds: number, now: number) {
    this.exciteUntil = Math.max(this.exciteUntil, now + seconds);
  }

  update(t: number, dt: number) {
    const target = t < this.exciteUntil ? 1 : 0;
    this.excite += (target - this.excite) * Math.min(1, dt * 4);
    this.crowd.update(t, this.excite);
    for (const f of this.flags) f.update(t);
    for (const m of this.pennants) m.rotation.x = 0.25 * Math.sin(t * 3 + m.userData.phase);
  }
}
