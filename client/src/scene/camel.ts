import * as THREE from 'three';
import type { CamelId } from '../../../shared/game';
import { CAMEL_COLORS, CAMEL_SCALE, enableShadows } from './models';
import { canvas, fabricTexture } from './textures';

// Camello de dibujos animados: sombreado toon por bandas, contorno negro,
// cara expresiva y animaciones exageradas (anticipación, estirar y aplastar).

export type Mood = 'idle' | 'run' | 'scared' | 'happy';

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const sphere = new THREE.SphereGeometry(1, 24, 16);

function toonGradient(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([120, 200, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
const gradient = toonGradient();
const toon = (color: THREE.ColorRepresentation, map?: THREE.Texture) =>
  new THREE.MeshToonMaterial({ color, gradientMap: gradient, map: map ?? null });

// Contorno por "casco invertido": se dibuja la cara trasera inflada a lo largo de la normal.
const outlineMaterial = new THREE.ShaderMaterial({
  uniforms: { thickness: { value: 0.022 }, color: { value: new THREE.Color('#24130a') } },
  vertexShader: /* glsl */ `
    uniform float thickness;
    void main() {
      vec3 n = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      mv.xyz += n * thickness;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    void main() {
      gl_FragColor = vec4(color, 1.0);
      #include <colorspace_fragment>
    }`,
  side: THREE.BackSide,
});

/** Textura del morro: fondo claro, orificios nasales y boca (sonrisa o "O" de susto). */
function muzzleTexture(base: string, open: boolean): THREE.Texture {
  const [c, ctx] = canvas(256, 128);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 128);
  const dark = '#3a1a10';
  // orificios nasales (parte superior delantera; u=0.5 es el frente)
  ctx.fillStyle = dark;
  for (const u of [0.43, 0.57]) {
    ctx.beginPath();
    ctx.ellipse(u * 256, 44, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (open) {
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(128, 86, 16, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e06a6a';
    ctx.beginPath();
    ctx.ellipse(128, 92, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // sonrisa que rodea el morro y se curva en las comisuras
    ctx.strokeStyle = dark;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(70, 66);
    ctx.quadraticCurveTo(80, 76, 92, 74);
    ctx.quadraticCurveTo(128, 96, 164, 74);
    ctx.quadraticCurveTo(176, 76, 186, 66);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
  front: boolean;
  phase: number;
}

const MOOD_LID: Record<Mood, number> = { idle: 0.38, run: 0.12, scared: 0, happy: 0.85 };

export class Camel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private legs: Leg[] = [];
  private lids: { g: THREE.Group; sign: number }[] = [];
  private pupils: { m: THREE.Object3D; base: THREE.Vector3; sign: number }[] = [];
  private brows: { g: THREE.Group; sign: number }[] = [];
  private ears: { g: THREE.Group; sign: number }[] = [];
  private tail = new THREE.Group();
  private tailTip = new THREE.Group();
  private tongue: THREE.Group | null = null;
  private muzzleMat: THREE.MeshToonMaterial;
  private smileTex: THREE.Texture;
  private openTex: THREE.Texture;
  private crazy: boolean;
  private browBase = 0.15;

  private phase = Math.random() * 10;
  private runV = 0;
  private crouchV = 0;
  private lidV = 0.4;
  private landT = -1;
  private blinkT = 0;
  private nextBlink = 1 + Math.random() * 3;
  private googly = [v3(0, 0, 0), v3(0, 0, 0)];
  private googlyVel = [v3(0, 0, 0), v3(0, 0, 0)];

  /** Estado que fija la escena. */
  mood: Mood = 'idle';
  running = false;
  celebrate = false;
  /** Progreso del salto actual (0-1) o -1 si está en el suelo. */
  hop = -1;
  /** 0-1: agachado para coger impulso. */
  crouch = 0;
  /** Posición en la pila (0 = abajo). */
  stackIndex = 0;

  constructor(readonly id: CamelId) {
    this.crazy = id === 'white' || id === 'black';
    const baseHex = id === 'black' ? '#3b3b46' : CAMEL_COLORS[id];
    const base = new THREE.Color(baseHex);
    const light = base.clone().lerp(new THREE.Color('#fff4dc'), id === 'white' ? 0.6 : 0.55);
    const skin = toon(base);
    const pale = toon(light);
    const hoof = toon('#5a3a22');
    const white = toon('#ffffff');
    const black = new THREE.MeshBasicMaterial({ color: '#141414' });
    const gold = toon('#f2c14e');
    const hair = toon(id === 'black' ? '#15151a' : base.clone().multiplyScalar(0.55));
    const blanket = toon(
      '#ffffff',
      this.crazy ? fabricTexture('#5b2a86', '#2fa36b', '#ffd34d') : fabricTexture('#c73a2f', '#f6dc96', '#2a4c8a'),
    );
    this.smileTex = muzzleTexture(`#${light.getHexString()}`, false);
    this.openTex = muzzleTexture(`#${light.getHexString()}`, true);
    this.muzzleMat = toon('#ffffff', this.smileTex);

    const part = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      p: THREE.Vector3,
      s: THREE.Vector3 | number,
      parent: THREE.Object3D,
      outline = true,
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(p);
      if (typeof s === 'number') m.scale.setScalar(s);
      else m.scale.copy(s);
      if (outline) {
        const o = new THREE.Mesh(geo, outlineMaterial);
        o.castShadow = false;
        o.userData.outline = true;
        m.add(o);
      }
      parent.add(m);
      return m;
    };
    const B = this.body;

    // ---------- cuerpo ----------
    part(sphere, skin, v3(0, 0.52, 0), v3(0.4, 0.25, 0.23), B);
    part(sphere, pale, v3(0.02, 0.43, 0), v3(0.33, 0.17, 0.19), B, false);
    part(sphere, skin, v3(0.25, 0.57, 0), v3(0.2, 0.22, 0.2), B);
    part(sphere, skin, v3(-0.05, 0.7, 0), v3(0.21, 0.2, 0.17), B);
    const cap = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, 1.0);
    part(cap, blanket, v3(-0.05, 0.705, 0), v3(0.218, 0.208, 0.18), B, false);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      part(sphere, gold, v3(-0.05 + Math.cos(a) * 0.19, 0.8, Math.sin(a) * 0.16), 0.03, B, false);
    }

    // ---------- cuello ----------
    const neck = new THREE.CatmullRomCurve3([v3(0.26, 0.62, 0), v3(0.4, 0.72, 0), v3(0.48, 0.86, 0), v3(0.52, 0.97, 0)]);
    part(new THREE.TubeGeometry(neck, 16, 0.088, 12, false), skin, v3(0, 0, 0), 1, B);

    // ---------- cabeza ----------
    const H = this.head;
    H.position.set(0.52, 0.99, 0);
    B.add(H);
    part(sphere, skin, v3(0, 0, 0), v3(0.17, 0.15, 0.15), H);
    part(sphere, this.muzzleMat, v3(0.15, -0.05, 0), v3(0.15, 0.105, 0.125), H);
    // dientes de conejo
    const tooth = new THREE.BoxGeometry(0.022, 0.035, 0.028);
    for (const z of [-0.016, 0.016]) part(tooth, white, v3(0.27, -0.12, z), 1, H, false);
    // flequillo
    const spike = new THREE.ConeGeometry(0.035, 0.12, 6);
    const spikes = this.crazy ? 7 : 3;
    for (let i = 0; i < spikes; i++) {
      const z = (i - (spikes - 1) / 2) * (this.crazy ? 0.04 : 0.045);
      const s = part(spike, hair, v3(-0.02 + (this.crazy ? Math.random() * 0.06 - 0.03 : 0), 0.15, z), this.crazy ? 1.4 : 1, H, false);
      s.rotation.set(z * (this.crazy ? 6 : 3), 0, this.crazy ? Math.random() * 1.2 - 0.6 : 0.3);
    }
    // orejas
    for (const sign of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(-0.08, 0.11, sign * 0.1);
      g.rotation.x = sign * 0.55;
      part(sphere, skin, v3(0, 0.06, 0), v3(0.035, 0.075, 0.05), g);
      H.add(g);
      this.ears.push({ g, sign });
    }
    // ojos grandes con párpado, pupila y brillo
    const eyeR = this.crazy ? 0.075 : 0.066;
    const lidGeo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    for (const sign of [-1, 1]) {
      const center = v3(0.07, 0.05, sign * 0.112);
      part(sphere, white, center, eyeR, H);
      const look = v3(0.5, 0.05, sign * 0.86).normalize();
      const pg = new THREE.Group();
      const pupilBase = center.clone().addScaledVector(look, eyeR * 0.62);
      pg.position.copy(pupilBase);
      part(sphere, black, v3(0, 0, 0), eyeR * 0.52, pg, false);
      part(sphere, white, v3(0.012, 0.016, sign * 0.022), eyeR * 0.17, pg, false);
      H.add(pg);
      this.pupils.push({ m: pg, base: pupilBase, sign });
      const lid = new THREE.Group();
      lid.position.copy(center);
      part(lidGeo, skin, v3(0, 0, 0), eyeR * 1.1, lid, false);
      H.add(lid);
      this.lids.push({ g: lid, sign });
      // ceja
      const brow = new THREE.Group();
      this.browBase = 0.05 + eyeR + 0.035;
      brow.position.set(0.07, this.browBase, sign * 0.115);
      const bm = part(new THREE.CapsuleGeometry(0.013, 0.06, 4, 8), black, v3(0, 0, 0), 1, brow, false);
      bm.rotation.z = Math.PI / 2;
      H.add(brow);
      this.brows.push({ g: brow, sign });
    }
    // lengua de los camellos locos
    if (this.crazy) {
      const tg = new THREE.Group();
      tg.position.set(0.25, -0.12, 0.05);
      part(new THREE.CapsuleGeometry(0.028, 0.07, 4, 8), toon('#ff7b8a'), v3(0, -0.05, 0), 1, tg);
      H.add(tg);
      this.tongue = tg;
    }

    // ---------- patas rechonchas con rodilla ----------
    // cápsulas (normales suaves) para que el contorno no haga picos en los bordes
    const upper = new THREE.CapsuleGeometry(0.072, 0.12, 4, 12);
    const lower = new THREE.CapsuleGeometry(0.058, 0.09, 4, 12);
    for (const [x, z, front] of [
      [0.24, 0.16, true],
      [0.24, -0.16, true],
      [-0.24, 0.16, false],
      [-0.24, -0.16, false],
    ] as const) {
      const hip = new THREE.Group();
      hip.position.set(x, 0.42, z);
      part(upper, skin, v3(0, -0.1, 0), 1, hip);
      const knee = new THREE.Group();
      knee.position.y = -0.2;
      part(sphere, skin, v3(0, 0, 0), 0.068, knee, false);
      part(lower, skin, v3(0, -0.08, 0), 1, knee);
      part(sphere, hoof, v3(0.015, -0.17, 0), v3(0.085, 0.05, 0.075), knee);
      hip.add(knee);
      B.add(hip);
      this.legs.push({ hip, knee, front, phase: (front ? 0 : Math.PI) + (z > 0 ? 0 : 0.6) });
    }

    // ---------- cola en dos tramos con borla ----------
    this.tail.position.set(-0.4, 0.62, 0);
    B.add(this.tail);
    const tailSeg = new THREE.CapsuleGeometry(0.024, 0.09, 4, 8);
    part(tailSeg, skin, v3(0, -0.06, 0), 1, this.tail);
    this.tailTip.position.y = -0.12;
    this.tail.add(this.tailTip);
    part(tailSeg, skin, v3(0, -0.06, 0), 1, this.tailTip);
    part(sphere, hair, v3(0, -0.14, 0), v3(0.05, 0.07, 0.05), this.tailTip);

    this.root.scale.setScalar(CAMEL_SCALE);
    this.root.add(this.body);
    this.root.userData.camel = id;
    enableShadows(this.root);
    this.root.traverse((o) => {
      if (o.userData.outline) o.castShadow = false;
    });
  }

  /** Aplastamiento elástico (y apretar los ojos) al aterrizar. */
  land() {
    this.landT = 0;
  }

  update(t: number, dt: number) {
    const k = Math.min(1, dt * 10);
    this.runV += ((this.running ? 1 : 0) - this.runV) * k;
    this.crouchV += (this.crouch - this.crouchV) * Math.min(1, dt * 25);
    const w = t * 15 + this.phase;
    const air = this.hop >= 0 ? Math.sin(this.hop * Math.PI) : 0;
    const mood: Mood = this.celebrate ? 'happy' : this.mood;

    // ---------- patas: galope, y en el aire postura de "superhéroe" ----------
    for (const l of this.legs) {
      const s = Math.sin(w + l.phase);
      const swing = this.runV * 0.8 * s * (1 - air);
      const fold = this.runV * Math.max(0, Math.cos(w + l.phase)) * (1 - air);
      l.hip.rotation.z = swing + air * (l.front ? 0.85 : -0.85) - this.crouchV * (l.front ? 0.25 : -0.25);
      l.knee.rotation.z = (l.front ? -1 : 1) * (fold * 1.1 + air * 0.9 + this.crouchV * 0.5);
    }

    // ---------- estirar y aplastar ----------
    let sq = 0;
    if (this.landT >= 0) {
      this.landT += dt;
      sq = 0.3 * Math.exp(-6 * this.landT) * Math.cos(14 * this.landT);
      if (this.landT > 1.2) this.landT = -1;
    }
    const breath = 0.02 * Math.sin(t * 2.4 + this.phase) * (1 - this.runV);
    const sy = Math.max(0.55, (1 + breath + air * 0.18 - this.crouchV * 0.24) * (1 - sq));
    const sxz = 1 / Math.sqrt(sy);
    this.body.scale.set(sxz, sy, sxz);

    let y = this.runV * (1 - air) * 0.07 * Math.abs(Math.sin(w));
    if (this.celebrate) y += Math.abs(Math.sin(t * 4.5 + this.phase)) * 0.55;
    this.body.position.y = y;
    this.body.rotation.z = this.hop >= 0 ? 0.28 * Math.cos(this.hop * Math.PI) : -0.07 * this.runV + 0.05 * this.runV * Math.sin(w * 2);
    this.body.rotation.x = 0.045 * this.stackIndex * Math.sin(t * 2.2 + this.phase) + (this.celebrate ? 0.15 * Math.sin(t * 9) : 0);

    // ---------- cabeza ----------
    const H = this.head;
    if (mood === 'run') {
      H.rotation.z = -0.15 + 0.1 * Math.sin(w * 2);
      H.rotation.y *= 0.9;
    } else if (mood === 'scared') {
      H.rotation.z = 0.22 + 0.05 * Math.sin(t * 30);
      H.rotation.y = 0.1 * Math.sin(t * 20);
    } else if (mood === 'happy') {
      H.rotation.z = 0.25 + 0.15 * Math.sin(t * 9);
      H.rotation.y = 0.25 * Math.sin(t * 4.5);
    } else {
      H.rotation.z = 0.06 * Math.sin(t * 1.3 + this.phase);
      H.rotation.y = 0.3 * Math.sin(t * 0.45 + this.phase * 2) * Math.max(0, Math.sin(t * 0.21 + this.phase));
    }

    // ---------- párpados: estado de ánimo + parpadeo ----------
    if (t > this.nextBlink) {
      this.blinkT = 0.13;
      this.nextBlink = t + 1.8 + Math.random() * 3.5;
    }
    let lid = MOOD_LID[mood];
    if (this.blinkT > 0) {
      this.blinkT -= dt;
      lid = 1;
    }
    if (this.landT >= 0 && this.landT < 0.14) lid = 0.92;
    this.lidV += (lid - this.lidV) * Math.min(1, dt * 30);
    for (const { g, sign } of this.lids) g.rotation.x = sign * (-1.05 + this.lidV * (Math.PI / 2 + 1.05));

    // ---------- pupilas (los locos, bailonas) ----------
    const pupilScale = mood === 'scared' ? 0.6 : 1;
    this.pupils.forEach((p, i) => {
      if (this.crazy) {
        const target = v3(Math.sin(t * (3 + i) + i * 2) * 0.02, Math.cos(t * (2.3 + i * 1.7)) * 0.02, 0);
        const vel = this.googlyVel[i];
        vel.addScaledVector(target.sub(this.googly[i]), dt * 120).multiplyScalar(Math.exp(-dt * 6));
        this.googly[i].addScaledVector(vel, dt);
        this.googly[i].clampLength(0, 0.03);
      }
      p.m.position.copy(p.base).add(this.googly[i]);
      p.m.scale.setScalar(p.m.scale.x + (pupilScale - p.m.scale.x) * Math.min(1, dt * 15));
    });

    // ---------- cejas ----------
    const browY = mood === 'scared' ? 0.035 : mood === 'happy' ? 0.02 : mood === 'run' ? -0.012 : 0;
    const browTilt = mood === 'run' ? -0.45 : mood === 'scared' ? 0.35 : mood === 'happy' ? 0.15 : 0.05;
    for (const { g } of this.brows) {
      g.position.y += (this.browBase + browY - g.position.y) * Math.min(1, dt * 15);
      g.rotation.z += (browTilt - g.rotation.z) * Math.min(1, dt * 15);
    }

    // ---------- boca ----------
    const tex = mood === 'scared' ? this.openTex : this.smileTex;
    if (this.muzzleMat.map !== tex) {
      this.muzzleMat.map = tex;
      this.muzzleMat.needsUpdate = true;
    }

    // ---------- orejas ----------
    for (const { g, sign } of this.ears) {
      let z: number;
      if (mood === 'run') z = -0.8 + 0.25 * Math.sin(w * 2 + sign);
      else if (mood === 'scared') z = 0.2 + 0.1 * Math.sin(t * 25);
      else if (mood === 'happy') z = 0.25 * Math.sin(t * 9 + sign);
      else z = 0.15 * Math.max(0, Math.sin(t * 3 + this.phase * sign)) ** 8; // tic ocasional
      g.rotation.z = z;
    }

    // ---------- cola y lengua ----------
    if (this.runV > 0.3) {
      this.tail.rotation.z = -0.9 * this.runV;
      this.tail.rotation.x = 0.2 * Math.sin(w * 2);
    } else {
      this.tail.rotation.z = -0.15;
      this.tail.rotation.x = 0.45 * Math.sin(t * 3 + this.phase);
    }
    this.tailTip.rotation.x = 0.5 * Math.sin(t * 3 + this.phase - 0.8);
    if (this.tongue) {
      this.tongue.rotation.x = 0.4 * Math.sin(t * 7 + this.phase);
      this.tongue.rotation.z = -0.3 + 0.3 * Math.sin(t * 5) - this.runV * 0.6;
    }
  }
}
