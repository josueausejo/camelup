import * as THREE from 'three';
import { textTexture } from './textures';

// Partículas por CPU dibujadas como puntos (polvo, chispas, fuego, fuegos artificiales),
// restos instanciados con física simple (confeti, monedas) y textos flotantes.

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform float uIntensity;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  float a = vColor.a * t.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * t.rgb * uIntensity, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Uniform compartido: píxeles por unidad de mundo (cámara ortográfica). */
export const pointScale = { value: 40 };

function pointsMaterial(map: THREE.Texture, blending: THREE.Blending, intensity: number) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { map: { value: map }, uScale: pointScale, uIntensity: { value: intensity } },
    transparent: true,
    depthWrite: false,
    blending,
  });
}

export interface Emit {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  color: THREE.Color;
  alpha?: number;
  size: number;
  sizeEnd?: number;
  life: number;
  gravity?: number;
  drag?: number;
}

export class Particles {
  readonly points: THREE.Points;
  private n = 0;
  private p: Float32Array;
  private v: Float32Array;
  private c: Float32Array;
  private s: Float32Array;
  private a0: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private geo = new THREE.BufferGeometry();

  constructor(private max: number, map: THREE.Texture, blending: THREE.Blending, intensity = 1) {
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 4);
    this.s = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.c, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.points = new THREE.Points(this.geo, pointsMaterial(map, blending, intensity));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(e: Emit) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.p.set([e.pos.x, e.pos.y, e.pos.z], i * 3);
    this.v.set([e.vel.x, e.vel.y, e.vel.z], i * 3);
    this.c.set([e.color.r, e.color.g, e.color.b, 0], i * 4);
    this.a0[i] = e.alpha ?? 1;
    this.s0[i] = e.size;
    this.s1[i] = e.sizeEnd ?? e.size;
    this.life[i] = this.maxLife[i] = e.life;
    this.grav[i] = e.gravity ?? 0;
    this.drag[i] = e.drag ?? 0;
  }

  private kill(i: number) {
    const last = --this.n;
    if (i === last) return;
    for (let k = 0; k < 3; k++) {
      this.p[i * 3 + k] = this.p[last * 3 + k];
      this.v[i * 3 + k] = this.v[last * 3 + k];
    }
    for (let k = 0; k < 4; k++) this.c[i * 4 + k] = this.c[last * 4 + k];
    this.a0[i] = this.a0[last];
    this.s0[i] = this.s0[last];
    this.s1[i] = this.s1[last];
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.grav[i] = this.grav[last];
    this.drag[i] = this.drag[last];
  }

  update(dt: number) {
    for (let i = this.n - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i * 3] *= d;
      this.v[i * 3 + 1] = this.v[i * 3 + 1] * d - this.grav[i] * dt;
      this.v[i * 3 + 2] *= d;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const r = this.life[i] / this.maxLife[i]; // 1 -> 0
      this.c[i * 4 + 3] = this.a0[i] * Math.min(1, (1 - r) * 12) * Math.min(1, r * 2.5);
      this.s[i] = this.s1[i] + (this.s0[i] - this.s1[i]) * r;
    }
    this.geo.setDrawRange(0, this.n);
    for (const name of ['position', 'aColor', 'aSize']) this.geo.attributes[name].needsUpdate = true;
  }
}

// ---------- Restos instanciados (confeti, monedas) ----------

interface Piece {
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: THREE.Euler;
  w: THREE.Vector3;
  life: number;
  max: number;
  scale: number;
  color: THREE.Color;
  flutter: number;
  bounce: number;
}

export interface DebrisEmit {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin?: number;
  life: number;
  scale?: number;
  color?: THREE.Color;
  flutter?: number;
  bounce?: number;
}

const dummy = new THREE.Object3D();
const white = new THREE.Color('#ffffff');

export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private items: Piece[] = [];
  private t = 0;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], private max: number, private floor = 0.05) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, white);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }

  emit(e: DebrisEmit) {
    if (this.items.length >= this.max) this.items.shift();
    const spin = e.spin ?? 10;
    this.items.push({
      p: e.pos.clone(),
      v: e.vel.clone(),
      r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      w: new THREE.Vector3((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin),
      life: e.life,
      max: e.life,
      scale: e.scale ?? 1,
      color: e.color ?? white,
      flutter: e.flutter ?? 0,
      bounce: e.bounce ?? 0,
    });
  }

  update(dt: number) {
    this.t += dt;
    this.items = this.items.filter((it) => (it.life -= dt) > 0);
    this.items.forEach((it, i) => {
      if (it.flutter) {
        // el confeti cae planeando
        it.v.x += Math.sin(this.t * 6 + i) * it.flutter * dt;
        it.v.z += Math.cos(this.t * 5 + i * 1.3) * it.flutter * dt;
        it.v.multiplyScalar(1 - 1.8 * dt);
        it.v.y -= 3 * dt;
      } else {
        it.v.y -= 9.8 * dt;
      }
      it.p.addScaledVector(it.v, dt);
      if (it.p.y < this.floor) {
        it.p.y = this.floor;
        if (it.bounce) {
          it.v.y = Math.abs(it.v.y) * it.bounce;
          it.v.x *= 0.6;
          it.v.z *= 0.6;
          it.w.multiplyScalar(0.6);
        } else {
          it.v.set(0, 0, 0);
          it.w.multiplyScalar(0.9);
        }
      }
      it.r.x += it.w.x * dt;
      it.r.y += it.w.y * dt;
      it.r.z += it.w.z * dt;
      const fade = Math.min(1, (it.life / it.max) * 4);
      dummy.position.copy(it.p);
      dummy.rotation.copy(it.r);
      dummy.scale.setScalar(it.scale * fade);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      this.mesh.setColorAt(i, it.color);
    });
    this.mesh.count = this.items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------- Textos flotantes ----------

export class FloatingTexts {
  readonly group = new THREE.Group();
  private items: { sprite: THREE.Sprite; life: number; max: number; vy: number; base: number }[] = [];

  spawn(text: string, color: string, pos: THREE.Vector3, scale = 1, life = 1.8) {
    const mat = new THREE.SpriteMaterial({ map: textTexture(text, color), transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    sprite.renderOrder = 20;
    this.group.add(sprite);
    this.items.push({ sprite, life, max: life, vy: 1.1, base: scale });
  }

  update(dt: number) {
    this.items = this.items.filter((it) => {
      it.life -= dt;
      if (it.life <= 0) {
        this.group.remove(it.sprite);
        it.sprite.material.map?.dispose();
        it.sprite.material.dispose();
        return false;
      }
      const age = it.max - it.life;
      const pop = age < 0.25 ? 0.4 + (age / 0.25) * 0.75 : 1.15 - Math.min(0.15, (age - 0.25) * 0.6);
      it.sprite.position.y += it.vy * dt;
      it.vy *= 1 - 1.5 * dt;
      it.sprite.scale.set(3.2 * it.base * pop, 0.8 * it.base * pop, 1);
      it.sprite.material.opacity = Math.min(1, it.life * 2.5);
      return true;
    });
  }
}

// ---------- Motas de arena flotando en el aire ----------

export class Motes {
  readonly points: THREE.Points;
  private vel: Float32Array;
  private geo = new THREE.BufferGeometry();

  constructor(map: THREE.Texture, private count = 220, private range = 18) {
    const p = new Float32Array(count * 3);
    const c = new Float32Array(count * 4);
    const s = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    const col = new THREE.Color('#fff0c8');
    for (let i = 0; i < count; i++) {
      p.set([(Math.random() - 0.5) * range * 2, Math.random() * 7, (Math.random() - 0.5) * range * 2], i * 3);
      this.vel.set([0.3 + Math.random() * 0.5, (Math.random() - 0.5) * 0.1, 0.15 + Math.random() * 0.3], i * 3);
      c.set([col.r, col.g, col.b, 0.25 + Math.random() * 0.35], i * 4);
      s[i] = 0.05 + Math.random() * 0.1;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(p, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(c, 4));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(s, 1));
    this.points = new THREE.Points(this.geo, pointsMaterial(map, THREE.AdditiveBlending, 1.2));
    this.points.frustumCulled = false;
  }

  update(t: number, dt: number) {
    const p = this.geo.attributes.position.array as Float32Array;
    const r = this.range;
    for (let i = 0; i < this.count; i++) {
      p[i * 3] += (this.vel[i * 3] + Math.sin(t * 0.5 + i) * 0.15) * dt;
      p[i * 3 + 1] += (this.vel[i * 3 + 1] + Math.sin(t + i * 0.7) * 0.05) * dt;
      p[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (p[i * 3] > r) p[i * 3] -= r * 2;
      if (p[i * 3 + 2] > r) p[i * 3 + 2] -= r * 2;
      if (p[i * 3 + 1] > 7 || p[i * 3 + 1] < 0) p[i * 3 + 1] = Math.random() * 7;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
