import * as THREE from 'three';
import type { FlingData } from '../../../shared/protocol';
import type { Crowd } from './circuit';

// Personas del público que se pueden coger de las gradas y lanzar por la pista.
// Es puramente decorativo: no toca el estado de la partida.

export type { FlingData };

export interface FlingHooks {
  ground(x: number, z: number): number;
  dust(p: THREE.Vector3, n: number): void;
  text(p: THREE.Vector3, s: string, color: string): void;
  stars(p: THREE.Vector3): void;
  /** Camellos con los que se puede chocar (solo efecto visual). */
  obstacles(): { pos: THREE.Vector3; radius: number; top: number; hit(): void }[];
}

type Phase = 'held' | 'approach' | 'flying' | 'down' | 'standup' | 'dizzy' | 'walk' | 'climb';

const GRAVITY = 15;
const SIZE = 1.5; // al cogerlas se ven más grandes; vuelven a su tamaño al sentarse
const HALF = 0.3 * SIZE; // media altura del cuerpo de pie
const LYING = 0.16 * SIZE; // altura del cuerpo tumbado
const TUMBLE = 0.18 * SIZE; // radio al rodar por el suelo
const MAX_FLYING = 14;
const sphere = new THREE.SphereGeometry(1, 14, 10);

class Ragdoll {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private arms: THREE.Group[] = [];
  private legs: THREE.Group[] = [];
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  spin = new THREE.Vector3();
  target = new THREE.Vector3();
  phase: Phase = 'held';
  t = 0;
  yaw = Math.random() * Math.PI * 2;
  private walk = 0;
  private bounces = 0;
  private lastHit = 0;
  private approachFrom = new THREE.Vector3();
  private climbFrom = new THREE.Vector3();
  private starT = 0;

  constructor(
    readonly seat: number,
    readonly home: THREE.Vector3,
    robe: string,
    skin: string,
  ) {
    const robeMat = new THREE.MeshStandardMaterial({ color: robe, roughness: 0.85 });
    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#111' });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.2, 4, 10), robeMat);
    const head = new THREE.Mesh(sphere, skinMat);
    head.scale.setScalar(0.12);
    head.position.y = 0.3;
    this.body.add(torso, head);
    for (const z of [-0.045, 0.045]) {
      const eye = new THREE.Mesh(sphere, eyeMat);
      eye.scale.setScalar(0.022);
      eye.position.set(0.105, 0.33, z);
      this.body.add(eye);
    }
    const limb = (r: number, len: number, mat: THREE.Material) => {
      const g = new THREE.CapsuleGeometry(r, len, 4, 8);
      g.translate(0, -len / 2 - r * 0.5, 0);
      return new THREE.Mesh(g, mat);
    };
    for (const z of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(0, 0.12, z * 0.17);
      arm.add(limb(0.045, 0.16, robeMat));
      this.body.add(arm);
      this.arms.push(arm);
      const leg = new THREE.Group();
      leg.position.set(0, -0.2, z * 0.07);
      leg.add(limb(0.05, 0.14, robeMat));
      this.body.add(leg);
      this.legs.push(leg);
    }
    this.group.add(this.body);
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.pos.copy(home);
    this.target.copy(home);
  }

  setPhase(p: Phase) {
    this.phase = p;
    this.t = 0;
  }

  /** Lanzamiento recibido de otro jugador: sale del asiento hasta el punto de lanzamiento. */
  approach(from: THREE.Vector3, to: THREE.Vector3, vel: THREE.Vector3, spin: THREE.Vector3) {
    this.approachFrom.copy(from);
    this.target.copy(to);
    this.vel.copy(vel);
    this.spin.copy(spin);
    this.setPhase('approach');
  }

  /** Devuelve true cuando ya ha vuelto a sentarse. */
  update(t: number, dt: number, hooks: FlingHooks): boolean {
    this.t += dt;
    const b = this.body;
    const flail = Math.sin(t * 22);
    switch (this.phase) {
      case 'held': {
        const prev = this.pos.clone();
        this.pos.lerp(this.target, Math.min(1, dt * 14));
        const inst = this.pos.clone().sub(prev).divideScalar(Math.max(dt, 1e-3));
        this.vel.lerp(inst, 0.3);
        // se balancea colgando según hacia dónde lo arrastras
        b.rotation.set(THREE.MathUtils.clamp(this.vel.z * 0.05, -0.8, 0.8), 0, THREE.MathUtils.clamp(-this.vel.x * 0.05, -0.8, 0.8));
        this.limbs(1.3 * flail, 0.9 * Math.sin(t * 18));
        break;
      }
      case 'approach': {
        const k = Math.min(1, this.t / 0.25);
        this.pos.lerpVectors(this.approachFrom, this.target, k);
        this.pos.y += Math.sin(k * Math.PI) * 0.6;
        this.limbs(1.3 * flail, 0.9 * Math.sin(t * 18));
        if (k >= 1) {
          this.setPhase('flying');
          hooks.text(this.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), '¡Aaah!', '#ffffff');
        }
        break;
      }
      case 'flying': {
        this.vel.y -= GRAVITY * dt;
        this.pos.addScaledVector(this.vel, dt);
        b.rotation.x += this.spin.x * dt;
        b.rotation.y += this.spin.y * dt;
        b.rotation.z += this.spin.z * dt;
        this.limbs(2.2 + 0.6 * flail, 1.2 + 0.5 * Math.sin(t * 19));
        // choque con camellos: rebota y el camello se lleva un susto
        for (const o of hooks.obstacles()) {
          const dx = this.pos.x - o.pos.x;
          const dz = this.pos.z - o.pos.z;
          const d = Math.hypot(dx, dz);
          if (d < o.radius + 0.18 && this.pos.y < o.top && t - this.lastHit > 0.3) {
            this.lastHit = t;
            const nx = dx / (d || 1);
            const nz = dz / (d || 1);
            const along = this.vel.x * nx + this.vel.z * nz;
            if (along < 0) {
              this.vel.x -= 1.6 * along * nx;
              this.vel.z -= 1.6 * along * nz;
            }
            this.vel.y = Math.max(this.vel.y, 3);
            o.hit();
            hooks.text(this.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), '¡Bonk!', '#ffd35a');
          }
        }
        const g = hooks.ground(this.pos.x, this.pos.z);
        if (this.pos.y - TUMBLE <= g) {
          this.pos.y = g + TUMBLE;
          if (this.vel.y < -2.5 && this.bounces < 4) {
            this.bounces++;
            this.vel.y *= -0.42;
            this.vel.x *= 0.65;
            this.vel.z *= 0.65;
            this.spin.multiplyScalar(0.6);
            hooks.dust(this.pos.clone().setY(g), 8);
            if (this.bounces === 1) hooks.text(this.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), '¡Ay!', '#ff9a8a');
          } else {
            hooks.dust(this.pos.clone().setY(g), 12);
            this.vel.set(0, 0, 0);
            // normaliza los ángulos acumulados al girar en el aire antes de tumbarse
            const w = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
            b.rotation.set(w(b.rotation.x), w(b.rotation.y), w(b.rotation.z));
            this.setPhase('down');
          }
        }
        if (Math.abs(this.pos.x) > 45 || Math.abs(this.pos.z) > 45) {
          // se ha ido muy lejos: vuelve directamente a su sitio
          this.pos.copy(this.home);
          return true;
        }
        break;
      }
      case 'down': {
        // tumbado boca arriba, con brazos y piernas abiertos
        const g = hooks.ground(this.pos.x, this.pos.z);
        this.pos.y += (g + LYING - this.pos.y) * Math.min(1, dt * 10);
        b.rotation.x += (0 - b.rotation.x) * Math.min(1, dt * 10);
        b.rotation.y = this.yaw;
        b.rotation.z += (Math.PI / 2 - b.rotation.z) * Math.min(1, dt * 10);
        this.limbs(1.6, 0.7);
        if (this.t > 0.8) this.setPhase('standup');
        break;
      }
      case 'standup': {
        const k = Math.min(1, this.t / 0.35);
        const g = hooks.ground(this.pos.x, this.pos.z);
        this.pos.y = g + LYING + (HALF - LYING) * k + Math.sin(k * Math.PI) * 0.15;
        b.rotation.set(0, this.yaw, (Math.PI / 2) * (1 - k));
        this.limbs(0.4 * (1 - k), 0);
        if (k >= 1) this.setPhase('dizzy');
        break;
      }
      case 'dizzy': {
        b.rotation.set(0.18 * Math.sin(t * 7), this.yaw + 0.4 * Math.sin(t * 3), 0.2 * Math.cos(t * 7));
        this.limbs(0.3 + 0.2 * Math.sin(t * 6), 0.1 * Math.sin(t * 7));
        this.starT -= dt;
        if (this.starT <= 0) {
          this.starT = 0.08;
          const a = t * 9;
          hooks.stars(this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.22, 0.52, Math.sin(a) * 0.22)));
        }
        if (this.t > 1.2) this.setPhase('walk');
        break;
      }
      case 'walk': {
        const dx = this.home.x - this.pos.x;
        const dz = this.home.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.45) {
          this.climbFrom.copy(this.pos);
          this.setPhase('climb');
          break;
        }
        const step = Math.min(d, 2.6 * dt);
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
        this.walk += dt * 11;
        const g = hooks.ground(this.pos.x, this.pos.z);
        this.pos.y = g + HALF + Math.abs(Math.sin(this.walk)) * 0.28;
        const yaw = Math.atan2(-dz, dx);
        this.yaw = yaw;
        b.rotation.set(0, yaw, -0.12);
        this.limbs(0.9 * Math.sin(this.walk), 0.8 * Math.sin(this.walk));
        break;
      }
      case 'climb': {
        const k = Math.min(1, this.t / 0.35);
        this.pos.lerpVectors(this.climbFrom, this.home, k);
        this.pos.y += Math.sin(k * Math.PI) * 0.5;
        b.rotation.set(0, this.yaw, 0);
        this.limbs(0.6, 0);
        if (k >= 1) return true;
        break;
      }
    }
    this.group.position.copy(this.pos);
    // crece al cogerla (con un pequeño rebote) y recupera su tamaño al volver a sentarse
    const target = this.phase === 'climb' ? SIZE - (SIZE - 1) * Math.min(1, this.t / 0.35) : SIZE;
    const s = this.group.scale.x + (target - this.group.scale.x) * Math.min(1, dt * (this.phase === 'climb' ? 30 : 12));
    this.group.scale.setScalar(s);
    return false;
  }

  private limbs(arms: number, legs: number) {
    this.arms[0].rotation.x = -arms;
    this.arms[1].rotation.x = arms;
    this.legs[0].rotation.z = legs;
    this.legs[1].rotation.z = -legs;
  }
}

export class Flinger {
  private dolls = new Map<number, Ragdoll>();
  private held: Ragdoll | null = null;

  constructor(
    private parent: THREE.Object3D,
    private crowd: Crowd,
    private hooks: FlingHooks,
  ) {}

  get holding() {
    return this.held !== null;
  }

  /** Coge a una persona de las gradas. */
  grab(seat: number): boolean {
    if (this.dolls.has(seat) || this.dolls.size >= MAX_FLYING) return false;
    const doll = this.spawn(seat);
    doll.setPhase('held');
    this.held = doll;
    return true;
  }

  dragTo(p: THREE.Vector3) {
    this.held?.target.copy(p);
  }

  /** Suelta a la persona: sale despedida con la velocidad del arrastre. */
  release(): FlingData | null {
    const d = this.held;
    if (!d) return null;
    this.held = null;
    const v = d.vel.clone();
    const speed = Math.hypot(v.x, v.z);
    if (speed < 1.2) v.set(0, 0, 0);
    else {
      v.y = Math.max(v.y, 0) + 3 + speed * 0.3;
      v.clampLength(0, 22);
      this.hooks.text(d.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), '¡Aaah!', '#ffffff');
    }
    const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4 + speed);
    d.vel.copy(v);
    d.spin.copy(spin);
    d.setPhase('flying');
    return { seat: d.seat, pos: d.pos.toArray(), vel: v.toArray(), spin: spin.toArray() };
  }

  /** Lanzamiento hecho por otro jugador. */
  remote(data: FlingData) {
    if (this.dolls.has(data.seat) || !this.crowd.seats[data.seat] || this.dolls.size >= MAX_FLYING) return;
    const doll = this.spawn(data.seat);
    doll.approach(doll.home.clone(), new THREE.Vector3(...data.pos), new THREE.Vector3(...data.vel), new THREE.Vector3(...data.spin));
  }

  private spawn(seat: number): Ragdoll {
    const s = this.crowd.seats[seat];
    const doll = new Ragdoll(seat, this.crowd.seatPosition(seat), s.robe, s.skin);
    s.hidden = true;
    this.parent.add(doll.group);
    this.dolls.set(seat, doll);
    doll.group.position.copy(doll.pos);
    return doll;
  }

  update(t: number, dt: number) {
    for (const [seat, doll] of this.dolls) {
      if (doll.update(t, dt, this.hooks)) {
        this.parent.remove(doll.group);
        this.dolls.delete(seat);
        this.crowd.seats[seat].hidden = false;
        if (this.held === doll) this.held = null;
      }
    }
  }
}
