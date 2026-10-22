import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CamelId, DieId, RevealedDie } from '../../../shared/game';
import {
  coinTexture,
  checkerFlagTexture,
  dieFaceTexture,
  fabricTexture,
  leafTexture,
  sandstoneTextures,
  spectatorTexture,
  waterNormal,
  woodTexture,
} from './textures';

export const CAMEL_COLORS: Record<CamelId, string> = {
  blue: '#2f78d0',
  green: '#3d9e4a',
  yellow: '#f0c02a',
  red: '#d23c33',
  purple: '#8547c0',
  white: '#efe9dc',
  black: '#2b2b2b',
};

export const PLAYER_COLORS = ['#e8833a', '#21a89a', '#d9468f', '#5b6fe0'];

/** Altura que ocupa cada camello en una pila. */
/** Escala de los camellos y altura que ocupa cada uno en una pila. */
export const CAMEL_SCALE = 1.15;
export const CAMEL_STACK = 0.64 * CAMEL_SCALE;

export function enableShadows(o: THREE.Object3D, cast = true) {
  o.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) {
      m.castShadow = cast;
      m.receiveShadow = true;
    }
  });
}

const sphere = new THREE.SphereGeometry(1, 28, 18);
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------- Dados ----------

export const DIE_SIZE = 0.5;
const dieGeometry = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 4, 0.07);
const FACE_VALUES = [1, 1, 2, 2, 3, 3]; // +x, -x, +y, -y, +z, -z
const faceCache = new Map<string, THREE.Texture>();
const axisQ = (x: number, y: number, z: number, a: number) => new THREE.Quaternion().setFromAxisAngle(v3(x, y, z), a);
// Rotación que deja cada cara mirando hacia arriba (+y)
const FACE_UP = [
  axisQ(0, 0, 1, Math.PI / 2),
  axisQ(0, 0, 1, -Math.PI / 2),
  new THREE.Quaternion(),
  axisQ(1, 0, 0, Math.PI),
  axisQ(1, 0, 0, -Math.PI / 2),
  axisQ(1, 0, 0, Math.PI / 2),
];

export function createDie(die: DieId): THREE.Mesh {
  const mats = FACE_VALUES.map((v, i) => {
    const bg = die === 'grey' ? '#9a9a9a' : CAMEL_COLORS[die];
    // un único dado gris: 1, 2 y 3 en blanco (+x, +y, +z) y 1, 2 y 3 en negro (-x, -y, -z)
    const fg = die === 'grey' ? (i % 2 ? '#151515' : '#ffffff') : die === 'yellow' ? '#4a3200' : '#ffffff';
    const key = `${bg}|${fg}|${v}`;
    if (!faceCache.has(key)) faceCache.set(key, dieFaceTexture(bg, fg, v, die === 'grey'));
    return new THREE.MeshStandardMaterial({ map: faceCache.get(key), roughness: 0.28, metalness: 0.05 });
  });
  const mesh = new THREE.Mesh(dieGeometry, mats);
  mesh.castShadow = true;
  return mesh;
}

// Dirección "arriba" de la textura de cada cara, en coordenadas locales del dado
// (según cómo BoxGeometry asigna las UV).
const FACE_TEXTURE_UP = [v3(0, 1, 0), v3(0, 1, 0), v3(0, 0, -1), v3(0, 0, 1), v3(0, 1, 0), v3(0, 1, 0)];

/** Cara del dado (0-5) que muestra el resultado. */
export function dieFaceIndex(r: RevealedDie): number {
  if (r.die === 'grey') return (r.value - 1) * 2 + (r.crazy === 'black' ? 1 : 0);
  return (r.value - 1) * 2 + (Math.random() < 0.5 ? 0 : 1);
}

/** Orientación final del dado para que muestre el resultado arriba. */
export function dieQuaternion(r: RevealedDie, face = dieFaceIndex(r)): THREE.Quaternion {
  return axisQ(0, 1, 0, Math.random() * Math.PI * 2).multiply(FACE_UP[face]);
}

/** Orientación para que la cara `face` mire hacia `toward` con su número derecho según `screenUp`. */
export function dieFacingQuaternion(face: number, toward: THREE.Vector3, screenUp: THREE.Vector3): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), toward).multiply(FACE_UP[face]);
  // girar alrededor de `toward` hasta que el "arriba" de la textura coincida con el de la pantalla
  const w = FACE_TEXTURE_UP[face].clone().applyQuaternion(q);
  const angle = Math.atan2(toward.dot(new THREE.Vector3().crossVectors(w, screenUp)), w.dot(screenUp));
  return new THREE.Quaternion().setFromAxisAngle(toward, angle).multiply(q);
}

// ---------- Mano que agita la pirámide ----------

export class Hand {
  readonly group = new THREE.Group();
  private sleeve: THREE.MeshStandardMaterial;
  private fingers: { a: THREE.Group; b: THREE.Group }[] = [];
  private thumb: { a: THREE.Group; b: THREE.Group };

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: '#d99a6c', roughness: 0.55 });
    this.sleeve = new THREE.MeshStandardMaterial({ color: '#e8833a', roughness: 0.8 });
    const gold = new THREE.MeshStandardMaterial({ color: '#e9b44c', metalness: 0.8, roughness: 0.3 });

    const palm = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.3, 0.9, 3, 0.12), skin);
    this.group.add(palm);
    // antebrazo inclinado hacia la cámara (como si entrara desde el lado del jugador), con manga y puño dorado
    const arm = new THREE.Group();
    arm.position.set(0, 0.12, -0.25);
    arm.rotation.x = -0.42; // poco inclinado: si apuntara a la cámara se vería como un disco
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.31, 0.6, 16), skin);
    wrist.position.y = 0.25;
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 10, 24), gold);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = 0.6;
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 7, 20), this.sleeve);
    sleeve.position.y = 4.1;
    arm.add(wrist, cuff, sleeve);
    this.group.add(arm);

    const segment = (len: number, r: number) => {
      const g = new THREE.CapsuleGeometry(r, len, 4, 10);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0, len / 2 + r * 0.5);
      return g;
    };
    const seg1 = segment(0.26, 0.085);
    const seg2 = segment(0.22, 0.08);
    for (const x of [-0.33, -0.11, 0.11, 0.33]) {
      const a = new THREE.Group();
      a.position.set(x, -0.02, 0.4);
      a.add(new THREE.Mesh(seg1, skin));
      const b = new THREE.Group();
      b.position.z = 0.32;
      b.add(new THREE.Mesh(seg2, skin));
      a.add(b);
      this.group.add(a);
      this.fingers.push({ a, b });
    }
    // pulgar en el lado opuesto, para pinzar la pirámide
    const ta = new THREE.Group();
    ta.position.set(0.25, -0.02, -0.4);
    ta.rotation.order = 'YXZ'; // primero se dobla (X) y luego se gira hacia atrás (Y)
    ta.rotation.y = Math.PI;
    ta.add(new THREE.Mesh(seg1, skin));
    const tb = new THREE.Group();
    tb.position.z = 0.32;
    tb.add(new THREE.Mesh(seg2, skin));
    ta.add(tb);
    this.group.add(ta);
    this.thumb = { a: ta, b: tb };

    this.group.scale.setScalar(1.25);
    enableShadows(this.group);
    this.group.visible = false;
  }

  setSleeve(color: string) {
    this.sleeve.color.set(color);
  }

  /** 0 = mano abierta, 1 = agarrando. */
  setGrip(c: number) {
    this.fingers.forEach(({ a, b }, i) => {
      a.rotation.x = 0.15 + c * (1.05 + i * 0.03);
      b.rotation.x = 0.1 + c * 1.0;
    });
    this.thumb.a.rotation.x = 0.15 + c * 0.95;
    this.thumb.b.rotation.x = 0.1 + c * 0.8;
  }
}

// ---------- Pirámide escalonada ----------

export class Pyramid {
  readonly group = new THREE.Group();
  readonly capMaterial: THREE.MeshStandardMaterial;
  /** Punto (local) por el que salen los dados. */
  readonly door = v3(0, 0.35, 1.65);
  readonly apex: THREE.Vector3;

  constructor() {
    const { map, normalMap } = sandstoneTextures();
    const layers = 7;
    const base = 3.0;
    const h = 0.3;
    for (let i = 0; i < layers; i++) {
      const size = base - i * 0.38;
      const m = map.clone();
      const n = normalMap.clone();
      for (const t of [m, n]) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(size / 1.4, h / 0.35);
        t.needsUpdate = true;
      }
      const layer = new THREE.Mesh(
        new RoundedBoxGeometry(size, h, size, 2, 0.035),
        new THREE.MeshStandardMaterial({ map: m, normalMap: n, roughness: 0.9 }),
      );
      layer.position.y = h / 2 + i * h;
      this.group.add(layer);
    }
    const top = layers * h;
    this.capMaterial = new THREE.MeshStandardMaterial({
      color: '#f2c14e',
      metalness: 0.85,
      roughness: 0.22,
      emissive: '#ffb02e',
      emissiveIntensity: 0.5,
    });
    const capGeo = new THREE.ConeGeometry(0.42, 0.55, 4);
    capGeo.rotateY(Math.PI / 4);
    const cap = new THREE.Mesh(capGeo, this.capMaterial);
    cap.position.y = top + 0.27;
    this.group.add(cap);
    this.apex = v3(0, top + 0.6, 0);

    // entrada frontal con marco dorado
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.08),
      new THREE.MeshStandardMaterial({ color: '#2a170a', roughness: 1 }),
    );
    door.position.set(0, 0.28, base / 2 + 0.01);
    this.group.add(door);
    const frameMat = new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.7, roughness: 0.3 });
    for (const [w, hh, x, y] of [
      [0.62, 0.07, 0, 0.56],
      [0.07, 0.55, -0.28, 0.28],
      [0.07, 0.55, 0.28, 0.28],
    ]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, hh, 0.1), frameMat);
      f.position.set(x, y, base / 2 + 0.02);
      this.group.add(f);
    }
    enableShadows(this.group);
    this.group.traverse((o) => (o.userData.pyramid = true));
  }
}

// ---------- Palmera ----------

export class Palm {
  readonly group = new THREE.Group();
  private fronds: { leaf: THREE.Object3D; droop: number; phase: number }[] = [];
  private phase = Math.random() * 10;

  constructor(scale = 1) {
    const bark = woodTexture('#7b5530');
    const barkMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 0.95 });
    const ringMat = new THREE.MeshStandardMaterial({ color: '#5e3f22', roughness: 1 });
    let y = 0;
    let x = 0;
    const segs = 11;
    for (let i = 0; i < segs; i++) {
      const r = 0.2 - i * 0.008;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, 0.42, 10), barkMat);
      x += i * 0.014;
      seg.position.set(x, y + 0.21, 0);
      seg.rotation.z = -i * 0.03;
      this.group.add(seg);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.92, 0.025, 6, 14), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, y + 0.02, 0);
      this.group.add(ring);
      y += 0.4;
    }
    const leafMat = new THREE.MeshStandardMaterial({
      map: leafTexture(),
      side: THREE.DoubleSide,
      alphaTest: 0.5,
      roughness: 0.75,
    });
    const n = 11;
    for (let i = 0; i < n; i++) {
      const geo = new THREE.PlaneGeometry(0.8, 2.8, 1, 10);
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        const t = (pos.getY(v) + 1.4) / 2.8;
        pos.setZ(v, -t * t * 1.4 + Math.abs(pos.getX(v)) * 0.25);
      }
      geo.translate(0, 1.4, 0);
      geo.computeVertexNormals();
      const leaf = new THREE.Mesh(geo, leafMat);
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      pivot.rotation.y = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const droop = -0.95 - Math.random() * 0.45;
      leaf.rotation.x = droop;
      pivot.add(leaf);
      this.group.add(pivot);
      this.fronds.push({ leaf, droop, phase: Math.random() * 6 });
    }
    const coco = new THREE.MeshStandardMaterial({ color: '#5a3b1b', roughness: 0.6 });
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(sphere, coco);
      c.scale.setScalar(0.13);
      c.position.set(x + Math.cos(i * 1.3) * 0.17, y - 0.14, Math.sin(i * 1.3) * 0.17);
      this.group.add(c);
    }
    this.group.scale.setScalar(scale);
    enableShadows(this.group);
  }

  update(t: number) {
    for (const f of this.fronds) f.leaf.rotation.x = f.droop + 0.07 * Math.sin(t * 1.6 + f.phase);
    this.group.rotation.z = 0.015 * Math.sin(t * 0.7 + this.phase);
  }
}

// ---------- Antorcha ----------

export class Torch {
  readonly group = new THREE.Group();
  readonly flameLocal = v3(0, 1.72, 0);
  private outer: THREE.Mesh;
  private inner: THREE.Mesh;
  private light: THREE.PointLight;
  private phase = Math.random() * 10;

  constructor() {
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture('#6b4422'), roughness: 0.9 });
    const bronze = new THREE.MeshStandardMaterial({ color: '#a8742e', metalness: 0.8, roughness: 0.35 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.5, 10), wood);
    pole.position.y = 0.75;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.12, 14), bronze);
    base.position.y = 0.06;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.12, 0.2, 14, 1, true), bronze);
    bowl.position.y = 1.58;
    bowl.material = bronze.clone();
    (bowl.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    const coals = new THREE.Mesh(
      new THREE.CircleGeometry(0.22, 14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a1a').multiplyScalar(3) }),
    );
    coals.rotation.x = -Math.PI / 2;
    coals.position.y = 1.62;
    this.group.add(pole, base, bowl, coals);
    enableShadows(this.group);

    const flameMat = (c: string, k: number) =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(c).multiplyScalar(k),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    this.outer = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.55, 12), flameMat('#ff6a10', 2.5));
    this.inner = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.33, 12), flameMat('#ffd36a', 4));
    this.outer.position.y = 1.9;
    this.inner.position.y = 1.83;
    this.group.add(this.outer, this.inner);

    this.light = new THREE.PointLight('#ff9a40', 5, 7, 1.6);
    this.light.position.y = 2.1;
    this.group.add(this.light);
  }

  update(t: number) {
    const f = 1 + 0.18 * Math.sin(t * 13 + this.phase) + 0.1 * Math.sin(t * 29 + this.phase * 2);
    this.outer.scale.set(1 / Math.sqrt(f), f, 1 / Math.sqrt(f));
    this.inner.scale.set(1, 0.9 + 0.2 * Math.sin(t * 17 + this.phase), 1);
    this.outer.rotation.y = t * 2;
    this.light.intensity = 4 + 1.5 * f;
  }
}

// ---------- Bandera de meta ----------

export class Flag {
  readonly group = new THREE.Group();
  private cloth: THREE.Mesh;
  private base: Float32Array;

  constructor() {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 2.4, 10),
      new THREE.MeshStandardMaterial({ color: '#f3e7cf', roughness: 0.6 }),
    );
    pole.position.y = 1.2;
    const ball = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: '#e9b44c', metalness: 0.8, roughness: 0.25 }));
    ball.scale.setScalar(0.08);
    ball.position.y = 2.44;
    const geo = new THREE.PlaneGeometry(1.0, 0.65, 14, 6);
    geo.translate(0.5, 0, 0);
    this.base = Float32Array.from(geo.attributes.position.array);
    this.cloth = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: checkerFlagTexture(), side: THREE.DoubleSide, roughness: 0.8 }),
    );
    this.cloth.position.y = 2.05;
    this.group.add(pole, ball, this.cloth);
    enableShadows(this.group);
  }

  update(t: number) {
    const pos = this.cloth.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = this.base[i * 3];
      const y = this.base[i * 3 + 1];
      pos.setZ(i, Math.sin(x * 6 - t * 7 + y * 2) * 0.09 * x);
      pos.setY(i, y - x * 0.06 + Math.sin(x * 4 - t * 5) * 0.02 * x);
    }
    pos.needsUpdate = true;
    this.cloth.geometry.computeVertexNormals();
  }
}

// ---------- Ficha de público con espectadores ----------

const ROBES = ['#f1ead8', '#c9b38a', '#3f6fb0', '#b54a3a', '#e3c15a', '#6a8f4e'];
const SKINS = ['#8d5a36', '#c68b5a', '#e2b48a', '#5c3a22'];

export class SpectatorTile {
  readonly group = new THREE.Group();
  private figures: { g: THREE.Group; arms: THREE.Group[]; phase: number }[] = [];
  private exciteT = -1;

  constructor(playerColor: string, readonly side: 'cheer' | 'boo') {
    const tile = new THREE.Mesh(
      new RoundedBoxGeometry(1.85, 0.08, 1.85, 2, 0.03),
      new THREE.MeshStandardMaterial({ map: spectatorTexture(playerColor, side), roughness: 0.7 }),
    );
    tile.position.y = 0.04;
    this.group.add(tile);

    const capsule = new THREE.CapsuleGeometry(0.075, 0.14, 4, 10);
    const arm = new THREE.CapsuleGeometry(0.022, 0.12, 4, 6);
    const hat = new THREE.MeshStandardMaterial({ color: playerColor, roughness: 0.7 });
    [
      [-0.65, -0.65],
      [0.65, -0.65],
      [-0.65, 0.65],
      [0.65, 0.65],
      [0, -0.72],
    ].forEach(([x, z], i) => {
      const g = new THREE.Group();
      g.position.set(x, 0.08, z);
      const robe = new THREE.MeshStandardMaterial({ color: ROBES[(i * 3 + 1) % ROBES.length], roughness: 0.85 });
      const skin = new THREE.MeshStandardMaterial({ color: SKINS[i % SKINS.length], roughness: 0.7 });
      const body = new THREE.Mesh(capsule, robe);
      body.position.y = 0.15;
      const head = new THREE.Mesh(sphere, skin);
      head.scale.setScalar(0.065);
      head.position.y = 0.36;
      const turban = new THREE.Mesh(sphere, hat);
      turban.scale.set(0.072, 0.045, 0.072);
      turban.position.y = 0.405;
      g.add(body, head, turban);
      const arms: THREE.Group[] = [];
      for (const s of [-1, 1]) {
        const p = new THREE.Group();
        p.position.set(0, 0.25, s * 0.085);
        const a = new THREE.Mesh(arm, robe);
        a.position.y = -0.07;
        p.add(a);
        g.add(p);
        arms.push(p);
      }
      g.rotation.y = Math.atan2(x, z) + Math.PI;
      this.group.add(g);
      this.figures.push({ g, arms, phase: Math.random() * 6 });
    });
    enableShadows(this.group);
  }

  excite() {
    this.exciteT = 0;
  }

  update(t: number, dt: number) {
    let e = 0;
    if (this.exciteT >= 0) {
      this.exciteT += dt;
      e = Math.max(0, 1 - this.exciteT / 2.2);
      if (this.exciteT > 2.2) this.exciteT = -1;
    }
    for (const f of this.figures) {
      const jump = e * Math.abs(Math.sin(t * 11 + f.phase)) * 0.22 + 0.015 * Math.abs(Math.sin(t * 2.5 + f.phase));
      f.g.position.y = 0.08 + jump;
      const cheer = this.side === 'cheer';
      const raise = cheer ? 0.3 + e * 2.4 + 0.15 * Math.sin(t * 3 + f.phase) : 0.3 + e * (1.4 + 0.6 * Math.sin(t * 20 + f.phase));
      f.arms[0].rotation.x = raise;
      f.arms[1].rotation.x = -raise;
      f.g.rotation.z = cheer ? 0 : e * 0.15 * Math.sin(t * 18 + f.phase);
    }
  }
}

// ---------- Oasis y decorado ----------

export class Oasis {
  readonly group = new THREE.Group();
  private normal: THREE.Texture;

  constructor(radius = 2.6) {
    this.normal = waterNormal();
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 48),
      new THREE.MeshStandardMaterial({
        color: '#2c9fb3',
        roughness: 0.08,
        metalness: 0.25,
        normalMap: this.normal,
        normalScale: new THREE.Vector2(0.6, 0.6),
        transparent: true,
        opacity: 0.92,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.04;
    water.receiveShadow = true;
    const shore = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.05, radius + 0.9, 48),
      new THREE.MeshStandardMaterial({ color: '#b98d55', roughness: 1 }),
    );
    shore.rotation.x = -Math.PI / 2;
    shore.position.y = 0.02;
    shore.receiveShadow = true;
    this.group.add(water, shore);
    const reedMat = new THREE.MeshStandardMaterial({ color: '#5f8f3a', roughness: 0.8 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius + 0.1 + Math.random() * 0.6;
      const reed = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.5 + Math.random() * 0.5, 5), reedMat);
      reed.position.set(Math.cos(a) * r, 0.3, Math.sin(a) * r);
      reed.rotation.set((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4);
      this.group.add(reed);
    }
    enableShadows(this.group);
  }

  update(t: number) {
    this.normal.offset.set(t * 0.02, t * 0.013);
  }
}

export function createRock(size: number): THREE.Mesh {
  const geo = new THREE.DodecahedronGeometry(size, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = 0.8 + Math.random() * 0.35;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.6, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const rock = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#b88a58').offsetHSL(0, 0, (Math.random() - 0.5) * 0.1), roughness: 0.95, flatShading: true }),
  );
  rock.castShadow = rock.receiveShadow = true;
  return rock;
}

export function createShrub(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#7a8a3e', roughness: 0.9, flatShading: true });
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 + Math.random() * 0.15, 0), mat);
    b.position.set((Math.random() - 0.5) * 0.5, 0.15, (Math.random() - 0.5) * 0.5);
    b.scale.y = 0.7;
    g.add(b);
  }
  enableShadows(g);
  return g;
}

export function createObelisk(): THREE.Group {
  const g = new THREE.Group();
  const { map, normalMap } = sandstoneTextures();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.48, 4.4, 4),
    new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.9 }),
  );
  shaft.rotation.y = Math.PI / 4;
  shaft.position.y = 2.2;
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 0.6, 4),
    new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 0.85, roughness: 0.25, emissive: '#ff9f1c', emissiveIntensity: 0.3 }),
  );
  tip.rotation.y = Math.PI / 4;
  tip.position.y = 4.7;
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.3, 1.2),
    new THREE.MeshStandardMaterial({ map, roughness: 0.95 }),
  );
  plinth.position.y = 0.15;
  g.add(shaft, tip, plinth);
  enableShadows(g);
  return g;
}

export function createBigPyramid(size: number): THREE.Mesh {
  const { map, normalMap } = sandstoneTextures();
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(size / 2, size / 2);
  }
  const geo = new THREE.ConeGeometry(size, size * 0.95, 4);
  geo.rotateY(Math.PI / 4);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, normalMap, roughness: 1, flatShading: true }));
  m.position.y = size * 0.475;
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function createTent(): THREE.Group {
  const g = new THREE.Group();
  const fabric = new THREE.MeshStandardMaterial({ map: fabricTexture('#efe2c4', '#b5302a', '#2a4c8a'), roughness: 0.9, side: THREE.DoubleSide });
  const geo = new THREE.ConeGeometry(1.6, 1.6, 6, 1, true);
  const roof = new THREE.Mesh(geo, fabric);
  roof.position.y = 0.8;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), new THREE.MeshStandardMaterial({ color: '#2a170a' }));
  door.position.set(0, 0.4, 1.25);
  door.rotation.x = -0.25;
  g.add(roof, door);
  enableShadows(g);
  return g;
}

// ---------- Piezas planas ----------

export function flatPiece(w: number, d: number, h: number, top: THREE.Texture, side = '#e9dcbc'): THREE.Mesh {
  const sideMat = new THREE.MeshStandardMaterial({ color: side, roughness: 0.75 });
  const topMat = new THREE.MeshStandardMaterial({ map: top, roughness: 0.6 });
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(h / 2.2, 0.04)), [
    sideMat,
    sideMat,
    topMat,
    sideMat,
    sideMat,
    sideMat,
  ]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createPyramidToken(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.09, 6),
    new THREE.MeshStandardMaterial({ color: '#cfe3ef', roughness: 0.25, metalness: 0.35 }),
  );
  const coin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.1, 24),
    new THREE.MeshStandardMaterial({ color: '#d39a35', roughness: 0.3, metalness: 0.7 }),
  );
  coin.position.y = 0.01;
  mesh.add(coin);
  mesh.castShadow = true;
  return mesh;
}

export const coinGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.035, 20);
export function coinMaterials(): THREE.Material[] {
  const face = new THREE.MeshStandardMaterial({ map: coinTexture(), metalness: 0.75, roughness: 0.3 });
  const edge = new THREE.MeshStandardMaterial({ color: '#d39a35', metalness: 0.8, roughness: 0.3 });
  return [edge, face, face];
}
