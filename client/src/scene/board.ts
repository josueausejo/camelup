import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  CRAZY,
  RACING,
  TRACK_LENGTH,
  isRacing,
  type CamelId,
  type FinalPile,
  type GameState,
  type MoveStep,
  type Player,
  type RacingColor,
  type RevealedDie,
  type SetupRoll,
} from '../../../shared/game';
import { sfx } from '../audio/sfx';
import { Camel } from './camel';
import { Circuit, SPACE_LENGTH, TRACK, headingOf, spaceDistance, trackPoint } from './circuit';
import { buildEnvironment, type Environment } from './environment';
import {
  CAMEL_COLORS,
  CAMEL_SCALE,
  CAMEL_STACK,
  DIE_SIZE,
  PLAYER_COLORS,
  Palm,
  Pyramid,
  SpectatorTile,
  Torch,
  coinGeometry,
  coinMaterials,
  createDie,
  createPyramidToken,
  dieFaceIndex,
  dieFacingQuaternion,
  dieQuaternion,
  Hand,
  flatPiece,
} from './models';
import { Flinger, type FlingData } from './fling';
import { Debris, FloatingTexts, Motes, Particles, pointScale } from './particles';
import { Post } from './post';
import {
  betTicketTexture,
  cardBackTexture,
  labelTexture,
  rugTexture,
  smokeTexture,
  softDotTexture,
  sparkleTexture,
  woodTexture,
} from './textures';

export type Pick = { kind: 'space'; space: number } | { kind: 'bet'; color: RacingColor } | { kind: 'pyramid' };
export type Quality = 'high' | 'low';

export interface Interaction {
  spaces: number[]; // casillas válidas para el público
  bets: boolean;
  pyramid: boolean;
  color: string; // color del jugador para resaltar
}

// ---------- Geometría del circuito ----------

const CELL = SPACE_LENGTH;
const TILE_TOP = TRACK.Y;

const wrap = (space: number) => ((((space - 1) % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH) + 1;

export function cellPosition(space: number): THREE.Vector3 {
  return trackPoint(spaceDistance(space)).p;
}

function facing(space: number, camel: CamelId): number {
  const { t } = trackPoint(spaceDistance(space));
  return headingOf(isRacing(camel) ? t : t.clone().negate());
}

// La cámara mira al centro del conjunto circuito + gradas
const VIEW_TARGET = new THREE.Vector3(0, 0, -1.6);
const VIEW_OFFSET = new THREE.Vector3(30, 30, 30);

const DRAG_HEIGHT = 1.6; // altura a la que se lleva a una persona del público al arrastrarla
const TABLE_H = 0.55; // altura de los mostradores de fichas y cartas
const BET_POS = (i: number) => new THREE.Vector3(-9.5, TABLE_H + 0.02, -4.2 + i * 2.1);
const DICE_SLOT = (i: number) => new THREE.Vector3(-2.4 + i * 0.96, 0.02 + DIE_SIZE / 2, 2.1);
const PYRAMID_POS = new THREE.Vector3(-0.6, 0, -0.25);
const TOKENS_POS = new THREE.Vector3(3.7, 0, -0.9);
const GRIP_Y = 2.86; // altura de la palma al agarrar la punta de la pirámide
// Montones de apuesta final en mesas a la derecha del circuito
const PILE_POS = { winner: new THREE.Vector3(9.5, TABLE_H, -3.0), loser: new THREE.Vector3(9.5, TABLE_H, 1.9) };
/**
 * Altura de los objetos sobre los que puede caer o caminar una persona lanzada:
 * los escalones de la pirámide y los mostradores de fichas y cartas.
 */
function propHeight(x: number, z: number): number {
  const dx = Math.abs(x - PYRAMID_POS.x);
  const dz = Math.abs(z - PYRAMID_POS.z);
  let h = 0;
  for (let i = 0; i < 7; i++) if (Math.max(dx, dz) < (3.0 - i * 0.38) / 2) h = (i + 1) * 0.3;
  const onCounter = (cx: number, cz: number, w: number, d: number) => Math.abs(x - cx) < w / 2 && Math.abs(z - cz) < d / 2;
  if (onCounter(-9.5, 0, 1.9, 11.2)) h = Math.max(h, TABLE_H);
  for (const p of Object.values(PILE_POS)) if (onCounter(p.x, p.z + 1.05, 1.7, 4.6)) h = Math.max(h, TABLE_H);
  return h;
}

const TICKET_POS = (i: number) => new THREE.Vector3(i * 0.03, 0.045 + i * 0.075, -i * 0.03);

// ---------- Animaciones ----------

type Tween = { t0: number; dur: number; update: (k: number) => void; done: () => void };
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
function easeOutBounce(t: number) {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const col = (c: string) => new THREE.Color(c);

export class BoardScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private world = new THREE.Group(); // todo lo que tiembla
  private camera: THREE.OrthographicCamera;
  private controls: OrbitControls;
  private env: Environment;
  private post: Post | null = null;
  private quality: Quality;
  private fx = 1; // multiplicador de partículas según calidad

  private tweens: Tween[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private time = 0;
  private lastFrame = 0;
  private shakeAmt = 0;

  private camels = new Map<CamelId, Camel>();
  private display: Record<number, CamelId[]> = {};
  private highlights = new Map<number, THREE.Mesh>();
  private pyramid!: Pyramid;
  private circuit!: Circuit;
  private inIntro = false;
  private skipping = false;
  private flinger!: Flinger;
  private hand = new Hand();
  private carrier = new THREE.Group(); // pivote en la mano mientras agita la pirámide
  private dice: THREE.Mesh[] = [];
  private bets = new Map<RacingColor, { group: THREE.Group; tickets: THREE.Mesh[] }>();
  private tokens: THREE.Mesh[] = [];
  private spectators = new Map<string, { tile: SpectatorTile; space: number; side: string }>();
  private piles: Record<FinalPile, THREE.Mesh[]> = { winner: [], loser: [] };
  private animated: { update(t: number, dt: number): void }[] = [];
  private torches: Torch[] = [];

  private dust: Particles;
  private glow: Particles;
  private confetti: Debris;
  private coins: Debris;
  private texts = new FloatingTexts();
  private motes: Motes;
  private rockets: { p: THREE.Vector3; v: THREE.Vector3; color: THREE.Color; fuse: number }[] = [];
  private fireworksUntil = 0;
  private nextRocket = 0;
  private confettiRainUntil = 0;

  private interaction: Interaction | null = null;
  private hover: Pick | null = null;
  private players: Player[] = [];
  private prev: GameState | null = null;
  private lastSeq = -1;

  onPick: (p: Pick) => void = () => {};
  /** Se llama al lanzar a alguien del público (para avisar a los demás jugadores). */
  onFling: (d: FlingData) => void = () => {};

  constructor(private container: HTMLElement, quality: Quality = 'high') {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
    this.camera.position.copy(VIEW_TARGET).add(VIEW_OFFSET); // isométrica
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(VIEW_TARGET);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minZoom = 0.7;
    this.controls.maxZoom = 2.8;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = 1.2;

    this.env = buildEnvironment(this.scene, this.renderer);
    this.scene.add(this.world);

    // sistemas de partículas
    this.dust = new Particles(900, smokeTexture(), THREE.NormalBlending, 1);
    this.glow = new Particles(3500, sparkleTexture(), THREE.AdditiveBlending, 1.6);
    this.confetti = new Debris(
      new THREE.PlaneGeometry(0.16, 0.09),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.5, metalness: 0.2 }),
      900,
      0.04,
    );
    this.coins = new Debris(coinGeometry, coinMaterials(), 120, 0.06);
    this.motes = new Motes(softDotTexture());
    this.scene.add(this.dust.points, this.glow.points, this.confetti.mesh, this.coins.mesh, this.texts.group, this.motes.points);

    this.buildBoard();
    this.flinger = new Flinger(this.world, this.circuit.crowd, {
      ground: (x, z) => Math.max(this.circuit.groundHeight(x, z), propHeight(x, z)),
      dust: (p, n) => this.dustPuff(p, n, '#d9b27a', 1.2),
      text: (p, s, color) => this.texts.spawn(s, color, p, 0.75, 1.1),
      stars: (p) =>
        this.glow.emit({ pos: p, vel: new THREE.Vector3(0, 0.15, 0), color: col('#ffe066'), size: 0.22, sizeEnd: 0.02, life: 0.5 }),
      obstacles: () =>
        [...this.camels.values()]
          .filter((c) => c.root.visible)
          .map((c) => ({
            pos: c.root.position,
            radius: 0.5 * CAMEL_SCALE,
            top: c.root.position.y + 1.2 * CAMEL_SCALE,
            hit: () => {
              // solo un susto visual: no afecta a la partida
              c.land();
              if (c.running) return;
              c.mood = 'scared';
              setTimeout(() => !c.running && c.mood === 'scared' && (c.mood = 'idle'), 900);
            },
          })),
    });
    this.applyQuality();

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      for (const tw of this.tweens.splice(0)) {
        tw.update(1);
        tw.done();
      }
    });
    this.resize();
    this.bindPointer();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // ---------- Calidad y vista ----------

  setQuality(q: Quality) {
    this.quality = q;
    this.applyQuality();
    this.resize();
  }

  private applyQuality() {
    const high = this.quality === 'high';
    this.fx = high ? 1 : 0.45;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : 1));
    this.env.setShadowQuality(high ? 2048 : 1024);
    this.post = high ? new Post(this.renderer, this.scene, this.camera) : null;
    this.motes.points.visible = high;
  }

  resetView() {
    const p = this.camera.position.clone();
    const z0 = this.camera.zoom;
    this.tween(500, (k) => {
      const e = easeInOut(k);
      this.camera.position.lerpVectors(p, VIEW_TARGET.clone().add(VIEW_OFFSET), e);
      this.camera.zoom = z0 + (1 - z0) * e;
      this.camera.updateProjectionMatrix();
    });
    this.controls.target.copy(VIEW_TARGET);
  }

  rotateView(dir: 1 | -1) {
    const p = this.camera.position;
    const c = this.controls.target;
    const angle = (dir * Math.PI) / 2;
    const from = Math.atan2(p.z - c.z, p.x - c.x);
    const r = Math.hypot(p.x - c.x, p.z - c.z);
    this.tween(550, (k) => {
      const a = from + angle * easeInOut(k);
      p.set(c.x + Math.cos(a) * r, p.y, c.z + Math.sin(a) * r);
    });
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const aspect = w / h;
    const view = aspect < 1 ? 24 / aspect : 22;
    this.camera.left = (-view * aspect) / 2;
    this.camera.right = (view * aspect) / 2;
    this.camera.top = view / 2;
    this.camera.bottom = -view / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h, this.renderer.getPixelRatio());
  }

  // ---------- Bucle principal ----------

  private frame(now: number) {
    const t = now / 1000;
    const dt = Math.min(0.05, this.lastFrame ? t - this.lastFrame : 0.016);
    this.lastFrame = t;
    this.time = t;

    for (const tw of [...this.tweens]) {
      const k = Math.min(1, (now - tw.t0) / tw.dur);
      tw.update(k);
      if (k >= 1) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        tw.done();
      }
    }

    for (const c of this.camels.values()) c.update(t, dt);
    for (const a of this.animated) a.update(t, dt);
    this.circuit.update(t, dt);
    this.flinger.update(t, dt);
    for (const s of this.spectators.values()) s.tile.update(t, dt);
    this.env.update(t);
    this.updateTorches();
    this.updateHighlights(t);
    this.updateHover(dt);
    this.updateFireworks(t, dt);

    this.dust.update(dt);
    this.glow.update(dt);
    this.confetti.update(dt);
    this.coins.update(dt);
    this.texts.update(dt);
    if (this.motes.points.visible) this.motes.update(t, dt);

    // temblor de cámara aplicado al mundo
    if (this.shakeAmt > 0.002) {
      this.world.position.set(rand(-1, 1) * this.shakeAmt, rand(-0.5, 0.5) * this.shakeAmt, rand(-1, 1) * this.shakeAmt);
      this.shakeAmt *= Math.exp(-dt * 9);
    } else this.world.position.set(0, 0, 0);

    this.controls.update();
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    pointScale.value = buffer.y / ((this.camera.top - this.camera.bottom) / this.camera.zoom);

    if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Salta lo que quede de la secuencia de salida (las animaciones se completan al instante). */
  skipIntro() {
    if (!this.skipping && this.inIntro) {
      this.skipping = true;
      for (const tw of this.tweens.splice(0)) {
        tw.update(1);
        tw.done();
      }
    }
  }

  private tween(dur: number, update: (k: number) => void): Promise<void> {
    if (document.hidden || this.skipping) {
      update(1);
      return Promise.resolve();
    }
    return new Promise((done) => {
      const tw: Tween = { t0: performance.now(), dur, update, done };
      this.tweens.push(tw);
      // Seguridad: si el navegador deja de dar fotogramas (pestaña en segundo plano sin marcarse
      // como oculta), la animación se completa igualmente y la partida no se queda bloqueada.
      setTimeout(() => {
        const i = this.tweens.indexOf(tw);
        if (i < 0) return;
        this.tweens.splice(i, 1);
        tw.update(1);
        tw.done();
      }, dur + 500);
    });
  }

  private wait(ms: number) {
    return this.tween(ms, () => {});
  }

  /** Reproduce un efecto salvo que se esté saltando la animación. */
  private sound(play: () => void) {
    if (!this.skipping) play();
  }

  private shake(amount: number) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  // ---------- Efectos ----------

  private dustPuff(at: THREE.Vector3, n = 14, color = '#d9b27a', spread = 1.6) {
    const c = col(color);
    for (let i = 0; i < Math.ceil(n * this.fx); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.4, 1) * spread;
      this.dust.emit({
        pos: at.clone().add(new THREE.Vector3(Math.cos(a) * 0.3, rand(0.02, 0.15), Math.sin(a) * 0.3)),
        vel: new THREE.Vector3(Math.cos(a) * s, rand(0.3, 0.9), Math.sin(a) * s),
        color: c,
        alpha: 0.75,
        size: rand(0.35, 0.6),
        sizeEnd: rand(0.9, 1.5),
        life: rand(0.6, 1.1),
        drag: 2.5,
        gravity: -0.15,
      });
    }
  }

  private sparks(at: THREE.Vector3, color: string | THREE.Color, n = 30, speed = 3, opts: Partial<{ up: number; gravity: number; size: number; life: number }> = {}) {
    const c = typeof color === 'string' ? col(color) : color;
    for (let i = 0; i < Math.ceil(n * this.fx); i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize();
      this.glow.emit({
        pos: at.clone(),
        vel: dir.multiplyScalar(speed * rand(0.4, 1)).add(new THREE.Vector3(0, opts.up ?? 1.5, 0)),
        color: c.clone().offsetHSL(rand(-0.03, 0.03), 0, rand(-0.05, 0.1)),
        size: (opts.size ?? 0.35) * rand(0.6, 1.2),
        sizeEnd: 0.02,
        life: (opts.life ?? 0.9) * rand(0.6, 1.2),
        gravity: opts.gravity ?? 4,
        drag: 1.2,
      });
    }
  }

  private confettiBurst(at: THREE.Vector3, colors: string[], n = 60, speed = 5) {
    for (let i = 0; i < Math.ceil(n * this.fx); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.3, 1) * speed;
      this.confetti.emit({
        pos: at.clone(),
        vel: new THREE.Vector3(Math.cos(a) * s * 0.5, rand(0.6, 1.2) * speed, Math.sin(a) * s * 0.5),
        life: rand(2.5, 4),
        color: col(colors[i % colors.length]),
        flutter: 5,
        spin: 14,
      });
    }
  }

  private coinBurst(at: THREE.Vector3, n = 4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.coins.emit({
        pos: at.clone().add(new THREE.Vector3(0, 0.3, 0)),
        vel: new THREE.Vector3(Math.cos(a) * 1.2, rand(4, 6), Math.sin(a) * 1.2),
        life: 2.2,
        spin: 16,
        bounce: 0.45,
      });
    }
  }

  private updateTorches() {
    for (const torch of this.torches) {
      const p = torch.group.localToWorld(torch.flameLocal.clone());
      const n = Math.random() < this.fx ? 2 : 0;
      for (let i = 0; i < n; i++)
        this.glow.emit({
          pos: p.clone().add(new THREE.Vector3(rand(-0.1, 0.1), rand(0, 0.15), rand(-0.1, 0.1))),
          vel: new THREE.Vector3(rand(-0.15, 0.15), rand(0.9, 1.6), rand(-0.15, 0.15)),
          color: col(Math.random() < 0.3 ? '#ffd27a' : '#ff7a24'),
          size: rand(0.25, 0.45),
          sizeEnd: 0.03,
          life: rand(0.35, 0.75),
        });
      if (Math.random() < 0.04 * this.fx)
        this.dust.emit({
          pos: p.clone().add(new THREE.Vector3(0, 0.5, 0)),
          vel: new THREE.Vector3(rand(-0.1, 0.1), 0.6, rand(-0.1, 0.1)),
          color: col('#5a4636'),
          alpha: 0.25,
          size: 0.4,
          sizeEnd: 1.2,
          life: 2,
        });
    }
  }

  private updateFireworks(t: number, dt: number) {
    if (t < this.fireworksUntil && t > this.nextRocket) {
      this.nextRocket = t + rand(0.25, 0.6);
      const palette = ['#ff5a5a', '#ffd35a', '#5ad1ff', '#9b5aff', '#5aff8a', '#ff8af0'];
      this.sound(() => sfx.fireworkLaunch());
      this.rockets.push({
        p: new THREE.Vector3(rand(-7, 7), 0.5, rand(-7, 7)),
        v: new THREE.Vector3(rand(-0.6, 0.6), rand(9, 12), rand(-0.6, 0.6)),
        color: col(palette[Math.floor(Math.random() * palette.length)]),
        fuse: rand(0.7, 1.0),
      });
    }
    this.rockets = this.rockets.filter((r) => {
      r.fuse -= dt;
      r.v.y -= 6 * dt;
      r.p.addScaledVector(r.v, dt);
      this.glow.emit({ pos: r.p.clone(), vel: new THREE.Vector3(0, -0.5, 0), color: col('#ffcf8a'), size: 0.25, sizeEnd: 0, life: 0.4 });
      if (r.fuse > 0) return true;
      const n = Math.ceil(90 * this.fx);
      for (let i = 0; i < n; i++) {
        const dir = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3.5, 5.5));
        this.glow.emit({
          pos: r.p.clone(),
          vel: dir,
          color: r.color.clone().offsetHSL(rand(-0.04, 0.04), 0, rand(0, 0.15)),
          size: 0.45,
          sizeEnd: 0.05,
          life: rand(1.1, 1.7),
          gravity: 2.2,
          drag: 1.4,
        });
      }
      this.sound(() => sfx.fireworkPop());
      this.shake(0.05);
      return false;
    });
    if (t < this.confettiRainUntil && Math.random() < 0.8 * this.fx) {
      const palette = ['#ff5a5a', '#ffd35a', '#5ad1ff', '#9b5aff', '#5aff8a', '#ffffff'];
      for (let i = 0; i < 3; i++)
        this.confetti.emit({
          pos: new THREE.Vector3(rand(-10, 10), 12, rand(-10, 10)),
          vel: new THREE.Vector3(rand(-0.5, 0.5), -1, rand(-0.5, 0.5)),
          life: 6,
          color: col(palette[Math.floor(Math.random() * palette.length)]),
          flutter: 5,
          spin: 12,
        });
    }
  }

  // ---------- Construcción estática ----------

  private buildBoard() {
    // circuito: pista, bordillos, valla, meta y gradas
    this.circuit = new Circuit();
    this.world.add(this.circuit.group);

    // pirámide
    this.pyramid = new Pyramid();
    this.pyramid.group.position.copy(PYRAMID_POS);
    this.world.add(this.pyramid.group);

    // alfombra de dados
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.1), new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.012, 2.1);
    rug.receiveShadow = true;
    this.world.add(rug);

    // palmera en el interior del óvalo y antorchas en las esquinas
    const palm = new Palm(0.85);
    palm.group.position.set(-4.0, 0, -0.6);
    this.world.add(palm.group);
    this.animated.push({ update: (t) => palm.update(t) });
    for (const [x, z] of [
      [-9.5, -6.6],
      [-9.5, 6.6],
      [9.5, -6.6],
      [9.5, 6.6],
    ]) {
      const torch = new Torch();
      torch.group.position.set(x, 0, z);
      this.world.add(torch.group);
      this.torches.push(torch);
      this.animated.push({ update: (t) => torch.update(t) });
    }

    // mostradores de madera para fichas y cartas
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture('#8a5a2e'), roughness: 0.75 });
    const counter = (x: number, z: number, w: number, d: number) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, TABLE_H, d, 2, 0.06), wood);
      m.position.set(x, TABLE_H / 2, z);
      m.castShadow = m.receiveShadow = true;
      this.world.add(m);
    };
    counter(-9.5, 0, 1.9, 11.2);

    // zonas de fichas de etapa
    RACING.forEach((c, idx) => {
      const p = BET_POS(idx);
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 2.0),
        new THREE.MeshStandardMaterial({ color: CAMEL_COLORS[c], roughness: 1, transparent: true, opacity: 0.45 }),
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(p.x, TABLE_H + 0.006, p.z);
      pad.receiveShadow = true;
      this.world.add(pad);
      const group = new THREE.Group();
      group.position.copy(p);
      group.userData.betColor = c;
      this.world.add(group);
      this.bets.set(c, { group, tickets: [] });
    });

    // montones de apuesta final
    for (const [pile, text] of [['winner', 'GANADOR'], ['loser', 'PERDEDOR']] as const) {
      const p = PILE_POS[pile];
      counter(p.x, p.z + 1.05, 1.7, 4.6);
      const labelGeo = new THREE.PlaneGeometry(2.6, 0.65).rotateX(-Math.PI / 2).rotateY(Math.PI / 2);
      const label = new THREE.Mesh(labelGeo, new THREE.MeshStandardMaterial({ map: labelTexture(text), transparent: true }));
      label.position.set(p.x, TABLE_H + 0.01, p.z + 2.15);
      label.receiveShadow = true;
      this.world.add(label);
      const spot = new THREE.Mesh(
        new THREE.PlaneGeometry(1.25, 1.7).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: pile === 'winner' ? '#e5b84a' : '#9c6b4a', roughness: 1 }),
      );
      spot.position.set(p.x, TABLE_H + 0.006, p.z);
      spot.receiveShadow = true;
      this.world.add(spot);
    }

    // camellos
    for (const id of [...RACING, ...CRAZY]) {
      const c = new Camel(id);
      c.root.visible = false;
      this.world.add(c.root);
      this.camels.set(id, c);
    }
    this.world.add(this.hand.group, this.carrier);
  }

  // ---------- Interacción ----------

  setInteraction(i: Interaction | null) {
    this.interaction = i;
    for (const h of this.highlights.values()) this.world.remove(h);
    this.highlights.clear();
    if (!i) {
      this.hover = null;
      return;
    }
    for (const s of i.spaces) {
      const p = cellPosition(s);
      const h = new THREE.Mesh(
        new THREE.PlaneGeometry(CELL - 0.5, CELL - 0.5),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(i.color).lerp(new THREE.Color('#fff6dc'), 0.45), transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }),
      );
      h.rotation.set(-Math.PI / 2, 0, facing(s, 'blue')); // alineado con la curva de la pista
      h.position.set(p.x, TILE_TOP + 0.03, p.z);
      const border = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.06, 4, 1, Math.PI / 4),
        new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      );
      // el anillo de 4 lados es un cuadrado de semilado r·√½; lo ajustamos al de la casilla
      border.scale.setScalar((CELL - 0.3) / 2 / (1.06 * Math.SQRT1_2));
      border.position.z = 0.005;
      h.add(border);
      h.userData.space = s;
      this.world.add(h);
      this.highlights.set(s, h);
    }
  }

  private updateHighlights(t: number) {
    const pulse = 0.65 + Math.sin(t * 4) * 0.2;
    for (const [s, h] of this.highlights) {
      (h.material as THREE.MeshBasicMaterial).opacity = this.hover?.kind === 'space' && this.hover.space === s ? 0.95 : pulse;
    }
    if (this.highlights.size && Math.random() < 0.5 * this.fx) {
      const list = [...this.highlights.values()];
      const h = list[Math.floor(Math.random() * list.length)];
      const c = (h.material as THREE.MeshBasicMaterial).color;
      this.glow.emit({
        pos: h.position.clone().add(new THREE.Vector3(rand(-0.8, 0.8), 0.05, rand(-0.8, 0.8))),
        vel: new THREE.Vector3(0, rand(0.6, 1.2), 0),
        color: c.clone().lerp(col('#ffffff'), 0.4),
        size: 0.22,
        sizeEnd: 0.02,
        life: 1,
      });
    }
  }

  private updateHover(dt: number) {
    const k = Math.min(1, dt * 10);
    const capTarget = this.hover?.kind === 'pyramid' ? 4 : 0.5;
    const cap = this.pyramid.capMaterial;
    cap.emissiveIntensity += (capTarget - cap.emissiveIntensity) * k;
    const s = this.hover?.kind === 'pyramid' ? 1.04 : 1;
    this.pyramid.group.scale.x += (s - this.pyramid.group.scale.x) * k;
    this.pyramid.group.scale.z = this.pyramid.group.scale.x;
    for (const [c, { tickets }] of this.bets) {
      const top = tickets[tickets.length - 1];
      if (!top || top.userData.flying) continue;
      const base = TICKET_POS(tickets.length - 1).y;
      const target = this.hover?.kind === 'bet' && this.hover.color === c ? base + 0.35 : base;
      top.position.y += (target - top.position.y) * k;
      top.rotation.x = (top.position.y - base) * -0.4;
    }
  }

  private pickAt(ev: PointerEvent): Pick | null {
    const i = this.interaction;
    if (!i) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets: THREE.Object3D[] = [];
    if (i.spaces.length) targets.push(...this.highlights.values());
    if (i.bets) targets.push(...[...this.bets.values()].map((b) => b.group));
    if (i.pyramid) targets.push(this.pyramid.group);
    for (const hit of this.raycaster.intersectObjects(targets, true)) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (o.userData.space && i.spaces.includes(o.userData.space)) return { kind: 'space', space: o.userData.space };
        if (o.userData.betColor && o.children.length) return { kind: 'bet', color: o.userData.betColor };
        if (o.userData.pyramid) return { kind: 'pyramid' };
        o = o.parent;
      }
    }
    return null;
  }

  private setRay(ev: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  /** Punto del plano de arrastre (a cierta altura sobre el suelo) bajo el puntero. */
  private dragPoint(ev: PointerEvent): THREE.Vector3 | null {
    this.setRay(ev);
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -DRAG_HEIGHT), new THREE.Vector3());
  }

  private bindPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    let grabbing = false;

    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
      // ¿hay una persona del público bajo el puntero? -> la cogemos (y la cámara no gira)
      if (e.button !== 0 || this.flinger.holding) return;
      this.setRay(e);
      const seat = this.circuit.crowd.pick(this.raycaster);
      if (seat === null || !this.flinger.grab(seat)) return;
      grabbing = true;
      down = null;
      this.controls.enabled = false;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* puntero sin captura posible: el arrastre funciona igual */
      }
      el.style.cursor = 'grabbing';
      const p = this.dragPoint(e);
      if (p) this.flinger.dragTo(p);
    });

    const release = (e: PointerEvent) => {
      if (!grabbing) return false;
      grabbing = false;
      this.controls.enabled = true;
      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        /* ya liberado */
      }
      el.style.cursor = '';
      const data = this.flinger.release();
      if (data) this.onFling(data);
      return true;
    };

    el.addEventListener('pointerup', (e) => {
      if (release(e)) return;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) {
        const p = this.pickAt(e);
        if (p) this.onPick(p);
      }
      down = null;
    });
    el.addEventListener('pointercancel', (e) => release(e));

    el.addEventListener('pointermove', (e) => {
      if (grabbing) {
        const p = this.dragPoint(e);
        if (p) this.flinger.dragTo(p);
        return;
      }
      this.hover = this.pickAt(e);
      if (this.hover) {
        el.style.cursor = 'pointer';
        return;
      }
      this.setRay(e);
      el.style.cursor = this.circuit.crowd.pick(this.raycaster) !== null ? 'grab' : '';
    });
    el.addEventListener('pointerleave', () => (this.hover = null));
  }

  /** Lanzamiento de una persona del público hecho por otro jugador. */
  remoteFling(data: FlingData) {
    this.flinger.remote(data);
  }

  // ---------- Sincronización con el estado ----------

  /** Aplica un nuevo estado, animando la última acción si es la siguiente a la mostrada. */
  async apply(state: GameState, opts: { intro?: boolean } = {}) {
    const prev = this.prev;
    const ev = state.event;
    const animate = !!prev && !document.hidden && this.lastSeq >= 0 && state.eventSeq === this.lastSeq + 1;
    this.lastSeq = state.eventSeq;
    this.prev = state;
    this.players = state.players;

    // Partida nueva: primero el sorteo de salida con los dados de todos los camellos
    if (opts.intro && state.setup?.length) {
      await this.sync(state, false);
      await this.playSetup(state);
      return;
    }

    if (animate && ev) {
      if (ev.type === 'pyramid') await this.playPyramid(state, prev!, ev.playerId, ev.die, ev.moves);
      else if (ev.type === 'bet') await this.playBet(ev.bet.color);
      else if (ev.type === 'final') await this.playFinalCard(ev.pile, ev.playerId);
    }
    await this.sync(state, animate);
  }

  private async sync(state: GameState, animated: boolean) {
    const jobs = [
      this.syncSpectators(state, animated),
      this.syncDice(state, animated),
      this.syncBets(state, animated),
      this.syncTokens(state, animated),
    ];
    this.syncPiles(state);
    this.display = structuredClone(state.track);
    await this.layoutCamels(0);
    const winner = state.final?.winner;
    for (const [id, c] of this.camels) c.celebrate = state.phase === 'finished' && id === winner;
    await Promise.all(jobs);
  }

  private seatColor(playerId: string) {
    return PLAYER_COLORS[this.players.find((p) => p.id === playerId)?.seat ?? 0];
  }

  // ---------- Camellos ----------

  private spectatorLift(space: number) {
    for (const s of this.spectators.values()) if (s.space === wrap(space)) return 0.085;
    return 0;
  }

  private camelTarget(space: number, index: number, id: CamelId) {
    const p = cellPosition(space);
    return {
      pos: new THREE.Vector3(p.x, p.y + this.spectatorLift(space) + index * CAMEL_STACK, p.z),
      rot: facing(space, id),
    };
  }

  private async layoutCamels(dur: number) {
    const jobs: Promise<void>[] = [];
    for (const [k, stack] of Object.entries(this.display)) {
      stack.forEach((id, index) => {
        const camel = this.camels.get(id)!;
        camel.stackIndex = index;
        const mesh = camel.root;
        const { pos, rot } = this.camelTarget(Number(k), index, id);
        if (!mesh.visible || dur === 0) {
          mesh.visible = true;
          mesh.position.copy(pos);
          mesh.rotation.y = rot;
          return;
        }
        const from = mesh.position.clone();
        const r0 = mesh.rotation.y;
        const dr = Math.atan2(Math.sin(rot - r0), Math.cos(rot - r0));
        if (from.distanceTo(pos) < 0.001 && Math.abs(dr) < 0.001) return;
        jobs.push(
          this.tween(dur, (k) => {
            mesh.position.lerpVectors(from, pos, easeInOut(k));
            mesh.rotation.y = r0 + dr * easeInOut(k);
          }),
        );
      });
    }
    await Promise.all(jobs);
  }

  private async playPyramid(state: GameState, prev: GameState, playerId: string, die: RevealedDie, moves: MoveStep[]) {
    const token = this.tokens.pop();
    if (token) this.flyToPlayer(token, '#cfe3ef');
    const door = await this.grabAndShake(playerId);
    const putBack = this.returnPyramid();
    await this.presentDie(die, door);
    await putBack;
    for (const step of moves) await this.animateStep(step);
    this.display = structuredClone(state.track);
    await this.layoutCamels(250);
    if (state.phase === 'finished') {
      this.celebrateRace(state);
      await this.wait(1500);
    } else if (state.stage !== prev.stage) await this.celebrateStage(state);
  }

  /** Anima un salto de una unidad casilla a casilla. */
  private async animateStep(step: MoveStep) {
    const dir = Math.sign(step.to - step.from);
    const camels = step.unit.map((id) => this.camels.get(id)!);
    const crazy = step.unit.some((id) => !isRacing(id));
    const fromStack = this.display[step.from] ?? [];
    this.display[step.from] = fromStack.filter((c) => !step.unit.includes(c));
    // expresiones: los camellos de carrera arrastrados hacia atrás se asustan; el resto corre decidido
    step.unit.forEach((id, i) => {
      const c = camels[i];
      c.mood = isRacing(id) && dir < 0 ? 'scared' : 'run';
      c.stackIndex = 0;
    });
    if (crazy) this.sound(() => sfx.crazy());
    else if (dir < 0) this.sound(() => sfx.scared());
    // anticipación: se agachan para coger impulso
    await this.tween(130, (k) => camels.forEach((c) => (c.crouch = Math.sin((k * Math.PI) / 2))));
    camels.forEach((c) => {
      c.crouch = 0;
      c.running = true;
    });

    for (let s = step.from + dir; dir > 0 ? s <= step.to : s >= step.to; s += dir) {
      const last = s === step.to;
      const below = this.display[s] ?? [];
      const under = last && step.under;
      const baseIndex = under ? 0 : below.length;
      const starts = camels.map((c) => c.root.position.clone());
      const targets = step.unit.map((id, i) => this.camelTarget(s, baseIndex + i, id));
      const r0 = camels.map((c) => c.root.rotation.y);
      const hop = 0.9 + (under ? below.length * CAMEL_STACK : 0);
      this.sound(() => sfx.hop());
      const jobs = [
        this.tween(under ? 420 : 300, (k) => {
          const e = easeInOut(k);
          camels.forEach((c, i) => {
            c.hop = k;
            c.root.position.lerpVectors(starts[i], targets[i].pos, e);
            c.root.position.y += Math.sin(k * Math.PI) * hop;
            const dr = Math.atan2(Math.sin(targets[i].rot - r0[i]), Math.cos(targets[i].rot - r0[i]));
            c.root.rotation.y = r0[i] + dr * e;
          });
          if (crazy && Math.random() < 0.6 * this.fx)
            this.glow.emit({
              pos: camels[0].root.position.clone().add(new THREE.Vector3(0, 0.5, 0)),
              vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.2, 0.6), rand(-0.3, 0.3)),
              color: col(Math.random() < 0.5 ? '#c08aff' : '#7affc4'),
              size: 0.3,
              sizeEnd: 0,
              life: 0.7,
            });
        }),
      ];
      if (under) {
        // abucheo: la unidad acaba debajo y todos se llevan un buen susto
        this.sound(() => sfx.scared());
        camels.forEach((c) => (c.mood = 'scared'));
        // los camellos de destino se elevan para dejar sitio debajo
        below.forEach((id, i) => {
          this.camels.get(id)!.mood = 'scared';
          const m = this.camels.get(id)!.root;
          const from = m.position.clone();
          const to = this.camelTarget(s, i + step.unit.length, id).pos;
          jobs.push(this.tween(460, (k) => m.position.lerpVectors(from, to, easeOutBack(k))));
        });
      }
      await Promise.all(jobs);
      camels.forEach((c) => {
        c.hop = -1;
        c.land();
      });
      if (under) below.forEach((id) => this.camels.get(id)!.land());
      this.sound(() => sfx.land(last ? step.unit.length : 0.5));
      this.dustPuff(cellPosition(s), last ? 14 : 7);
    }
    camels.forEach((c) => (c.running = false));
    // el susto dura un momento más; luego vuelven a su cara de siempre
    const startled = [...camels, ...(step.under ? (this.display[step.to] ?? []).map((id) => this.camels.get(id)!) : [])];
    setTimeout(() => startled.forEach((c) => !c.running && (c.mood = 'idle')), 700);
    const target = this.display[step.to] ?? [];
    this.display[step.to] = step.under ? [...step.unit, ...target] : [...target, ...step.unit];

    if (step.spectatorOwner) {
      const spec = this.spectators.get(step.spectatorOwner);
      const at = cellPosition(step.to).add(new THREE.Vector3(0, 0.3, 0));
      const color = this.seatColor(step.spectatorOwner);
      spec?.tile.excite();
      if (spec?.side === 'cheer') {
        this.sound(() => sfx.cheer());
        this.confettiBurst(at, ['#4caf50', '#ffeb3b', '#ffffff', color], 50, 5);
        this.sparks(at, '#8aff7a', 30, 3);
        this.texts.spawn('¡Ánimo!', '#b8ff9a', at.clone().add(new THREE.Vector3(0, 2.2, 0)), 0.8);
      } else {
        this.dustPuff(at, 22, '#8a4a3a', 2.2);
        this.sound(() => sfx.boo());
        this.sparks(at, '#ff5a3a', 20, 2.5);
        this.texts.spawn('¡Buuu!', '#ff9a8a', at.clone().add(new THREE.Vector3(0, 2.2, 0)), 0.8);
      }
      this.coinBurst(at, 3);
      this.sound(() => sfx.coin());
      this.texts.spawn('+1 LE', color, at.clone().add(new THREE.Vector3(0, 1.3, 0)), 0.7);
      await this.wait(500);
    }
  }

  // ---------- Pirámide y dados ----------

  private cameraAxes() {
    const m = this.camera.matrixWorld;
    return {
      right: new THREE.Vector3().setFromMatrixColumn(m, 0),
      up: new THREE.Vector3().setFromMatrixColumn(m, 1),
      back: new THREE.Vector3().setFromMatrixColumn(m, 2),
    };
  }

  /** Una mano baja, agarra la pirámide por la punta, la levanta y la agita. Devuelve por dónde sale el dado. */
  private async grabAndShake(playerId: string): Promise<THREE.Vector3> {
    const hand = this.hand;
    const pyr = this.pyramid.group;
    const c = this.carrier;
    const grip = PYRAMID_POS.clone().add(new THREE.Vector3(0, GRIP_Y, 0));
    const { up, back } = this.cameraAxes();
    // los dedos apuntan hacia el fondo y el pulgar hacia la cámara
    const away = new THREE.Vector3(-back.x, 0, -back.z).normalize();
    const start = grip.clone().addScaledVector(up, 14);
    hand.setSleeve(this.seatColor(playerId));
    hand.setGrip(0);
    hand.group.position.copy(start);
    hand.group.rotation.set(0, Math.atan2(away.x, away.z), 0);
    hand.group.visible = true;
    await this.tween(300, (k) => hand.group.position.lerpVectors(start, grip, easeOut(k)));
    await this.tween(120, (k) => hand.setGrip(easeOut(k)));

    // la mano y la pirámide se mueven juntas alrededor del punto de agarre
    c.position.copy(grip);
    c.rotation.set(0, 0, 0);
    c.attach(pyr);
    c.attach(hand.group);
    this.dustPuff(PYRAMID_POS.clone().setY(0.05), 16, '#dcb47a', 2);
    const lift = 2.4;
    this.sound(() => sfx.whoosh(true));
    await this.tween(250, (k) => {
      const e = easeOut(k);
      c.position.y = grip.y + e * lift;
      c.rotation.z = e * 0.2;
    });

    this.sound(() => sfx.pyramidShake(0.56));
    this.shake(0.06);
    await this.tween(560, (k) => {
      const w = k * Math.PI * 11;
      const amp = 1 - k * 0.35;
      c.rotation.z = 0.2 * (1 - k) + Math.sin(w) * 0.32 * amp;
      c.rotation.x = Math.cos(w * 1.3) * 0.2 * amp;
      c.position.x = grip.x + Math.sin(w * 0.5) * 0.4 * amp;
      c.position.y = grip.y + lift + Math.abs(Math.sin(w)) * 0.45 * amp;
      if (Math.random() < 0.7 * this.fx) {
        // arena cayendo de los escalones
        const p = pyr.localToWorld(new THREE.Vector3(rand(-1.3, 1.3), rand(0.1, 1.6), rand(-1.3, 1.3)));
        this.dust.emit({
          pos: p,
          vel: new THREE.Vector3(rand(-0.5, 0.5), -1, rand(-0.5, 0.5)),
          color: col('#e0b878'),
          alpha: 0.7,
          size: 0.22,
          sizeEnd: 0.5,
          life: 0.9,
          gravity: 3,
        });
      }
      if (Math.random() < 0.12) this.shake(0.035);
    });

    // se inclina hacia delante para que el dado salga por la puerta
    const z0 = c.rotation.z;
    const x0 = c.rotation.x;
    const px0 = c.position.x;
    await this.tween(170, (k) => {
      const e = easeOut(k);
      c.rotation.z = z0 * (1 - e);
      c.rotation.x = x0 + (0.55 - x0) * e;
      c.position.x = px0 + (grip.x - px0) * e;
    });
    c.updateMatrixWorld(true);
    return pyr.localToWorld(this.pyramid.door.clone());
  }

  // ---------- Sorteo de salida ----------

  /**
   * Inicio de partida: la pirámide se agita, salen los 5 dados de carrera (en grande, hacia la
   * pantalla) y cada camello corre desde la pirámide hasta su casilla; después, el dado gris
   * dos veces para los camellos locos.
   */
  private async playSetup(state: GameState) {
    this.inIntro = true;
    for (const c of this.camels.values()) c.root.visible = false;
    const placed = new Map<number, number>();
    const nextIndex = (space: number) => {
      const n = placed.get(space) ?? 0;
      placed.set(space, n + 1);
      return n;
    };
    const exit = PYRAMID_POS.clone().add(this.pyramid.door).setY(0);
    const racing = state.setup.filter((r) => r.die !== 'grey');
    const crazy = state.setup.filter((r) => r.die === 'grey');

    this.texts.spawn('¡SORTEO DE SALIDA!', '#ffd35a', PYRAMID_POS.clone().add(new THREE.Vector3(0, 1.2, 2.8)), 1.2, 2.6);
    this.circuit.cheer(4, this.time);
    const starter = state.players[state.startPlayer]?.id ?? '';
    const door = await this.grabAndShake(starter);
    const putBack = this.returnPyramid();

    this.sound(() => sfx.drumroll(1.1));
    let dice = await this.showSetupDice(racing, door);
    const back = this.returnSetupDice(dice);
    await putBack;
    await Promise.all(racing.map((r, i) => {
      const index = nextIndex(r.space);
      return this.wait(i * 320).then(() => this.camelEntrance(r.camel, r.space, index, exit));
    }));
    await back;

    this.texts.spawn('¡Y ahora los locos!', '#f1ede4', PYRAMID_POS.clone().add(new THREE.Vector3(0, 1.2, 2.8)), 1, 2.2);
    dice = await this.showSetupDice(crazy, exit.clone().setY(0.35));
    const backCrazy = this.returnSetupDice(dice);
    await Promise.all(crazy.map((r, i) => {
      const index = nextIndex(r.space);
      return this.wait(i * 380).then(() => this.camelEntrance(r.camel, r.space, index, exit));
    }));
    await backCrazy;
    this.circuit.cheer(2, this.time);

    // estado final exacto, se haya saltado o no
    this.skipping = false;
    this.inIntro = false;
    for (const c of this.camels.values()) {
      c.root.scale.setScalar(CAMEL_SCALE);
      c.hop = -1;
      c.running = false;
      c.mood = 'idle';
    }
    this.display = structuredClone(state.track);
    await this.layoutCamels(0);
  }

  /** Los dados salen de la pirámide y se quedan en fila, en grande, mostrando su resultado. */
  private async showSetupDice(rolls: SetupRoll[], from: THREE.Vector3): Promise<THREE.Mesh[]> {
    const { right, up, back } = this.cameraAxes();
    const viewH = (this.camera.top - this.camera.bottom) / this.camera.zoom;
    const big = (viewH * 0.12) / DIE_SIZE;
    const gap = DIE_SIZE * big * 1.35;
    const center = this.controls.target.clone().addScaledVector(back, 20).addScaledVector(up, viewH * 0.12);
    const dice = rolls.map((r, i) => {
      const d = createDie(r.die);
      d.castShadow = false;
      d.position.copy(from);
      d.scale.setScalar(0.3);
      this.world.add(d);
      const target = center.clone().addScaledVector(right, (i - (rolls.length - 1) / 2) * gap);
      const q = dieFacingQuaternion(dieFaceIndex({ die: r.die, value: r.value, crazy: r.crazy }), back, up);
      const spin = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      const color = col(r.die === 'grey' ? '#e6e6e6' : CAMEL_COLORS[r.die]);
      return { d, target, q, spin, color };
    });
    await Promise.all(
      dice.map(({ d, target, q, spin, color }, i) =>
        this.wait(i * 90)
          .then(() =>
            this.tween(520, (k) => {
              const e = easeOut(k);
              d.position.lerpVectors(from, target, e).addScaledVector(up, Math.sin(k * Math.PI) * viewH * 0.1);
              d.scale.setScalar(0.3 + (big - 0.3) * e);
              d.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(spin, (1 - e) * Math.PI * 6));
            }),
          )
          .then(() => {
            d.quaternion.copy(q);
            this.sound(() => sfx.reveal());
            this.sparks(target.clone().addScaledVector(back, -1.5), color, 18, 4, { up: 0, gravity: 0 });
          }),
      ),
    );
    this.shake(0.05);
    await this.tween(1150, (k) => {
      dice.forEach(({ d, q }, i) => {
        const wob = Math.sin(k * Math.PI * 3 + i) * 0.12 * (1 - k);
        d.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(up, wob)).multiply(q);
      });
    });
    return dice.map((x) => x.d);
  }

  /** Los dados del sorteo vuelven encogiéndose a la pirámide. */
  private async returnSetupDice(dice: THREE.Mesh[]) {
    const apex = PYRAMID_POS.clone().add(this.pyramid.apex);
    await Promise.all(
      dice.map((d, i) => {
        const from = d.position.clone();
        const s0 = d.scale.x;
        return this.wait(i * 70)
          .then(() =>
            this.tween(500, (k) => {
              const e = easeInOut(k);
              d.position.lerpVectors(from, apex, e);
              d.scale.setScalar(s0 * (1 - e) + 0.15 * e);
              d.rotateY(0.25);
            }),
          )
          .then(() => {
            this.world.remove(d);
            this.sparks(apex, '#ffd36a', 8, 1.6);
            this.sound(() => sfx.pop());
          });
      }),
    );
  }

  /** Un camello sale de la pirámide y va saltando hasta su casilla de salida. */
  private async camelEntrance(id: CamelId, space: number, index: number, from: THREE.Vector3) {
    const camel = this.camels.get(id)!;
    const root = camel.root;
    const target = this.camelTarget(space, index, id);
    root.visible = true;
    root.position.copy(from);
    root.scale.setScalar(0.01);
    root.rotation.y = Math.atan2(-(target.pos.z - from.z), target.pos.x - from.x);
    camel.mood = 'run';
    camel.stackIndex = 0;
    this.dustPuff(from, 10, '#dcb47a', 1.2);
    await this.tween(220, (k) => root.scale.setScalar(CAMEL_SCALE * Math.max(0.01, easeOutBack(k))));
    this.sound(() => (id === 'white' || id === 'black' ? sfx.crazy() : sfx.pop()));
    camel.running = true;
    const hops = Math.max(2, Math.ceil(Math.hypot(target.pos.x - from.x, target.pos.z - from.z) / 2.4));
    const r0 = root.rotation.y;
    const dr = Math.atan2(Math.sin(target.rot - r0), Math.cos(target.rot - r0));
    for (let h = 0; h < hops; h++) {
      const a = from.clone().lerp(target.pos, h / hops);
      const b = from.clone().lerp(target.pos, (h + 1) / hops);
      this.sound(() => sfx.hop());
      const last = h === hops - 1;
      await this.tween(280, (k) => {
        camel.hop = k;
        root.position.lerpVectors(a, b, easeInOut(k));
        root.position.y += Math.sin(k * Math.PI) * (last ? 1.1 + index * 0.3 : 0.8);
        if (last) root.rotation.y = r0 + dr * easeInOut(k);
      });
      camel.hop = -1;
      camel.land();
      this.dustPuff(b.clone().setY(TILE_TOP), last ? 12 : 5);
      this.sound(() => sfx.land(last ? 1 : 0.5));
    }
    camel.running = false;
    camel.mood = 'happy';
    setTimeout(() => camel.mood === 'happy' && !camel.celebrate && (camel.mood = 'idle'), 900);
  }

  /** La mano devuelve la pirámide a su sitio, la suelta y se va. */
  private async returnPyramid() {
    const c = this.carrier;
    const hand = this.hand;
    const grip = PYRAMID_POS.clone().add(new THREE.Vector3(0, GRIP_Y, 0));
    const p0 = c.position.clone();
    const r0 = c.rotation.clone();
    await this.tween(380, (k) => {
      const e = easeInOut(k);
      c.position.lerpVectors(p0, grip, e);
      c.rotation.set(r0.x * (1 - e), 0, r0.z * (1 - e));
    });
    c.position.copy(grip);
    c.rotation.set(0, 0, 0);
    c.updateMatrixWorld(true);
    this.world.attach(this.pyramid.group);
    this.world.attach(hand.group);
    this.pyramid.group.position.copy(PYRAMID_POS);
    this.pyramid.group.rotation.set(0, 0, 0);
    this.dustPuff(PYRAMID_POS.clone().setY(0.05), 22, '#dcb47a', 2.6);
    this.sound(() => sfx.thud());
    this.shake(0.1);
    await this.tween(120, (k) => hand.setGrip(1 - k));
    const from = hand.group.position.clone();
    const to = from.clone().addScaledVector(this.cameraAxes().up, 14);
    await this.tween(350, (k) => hand.group.position.lerpVectors(from, to, k * k));
    hand.group.visible = false;
  }

  /** El dado sale disparado hacia la pantalla, se muestra en grande y cae a su sitio del tablero. */
  private async presentDie(r: RevealedDie, start: THREE.Vector3) {
    const die = createDie(r.die);
    const slot = DICE_SLOT(this.dice.length);
    this.dice.push(die);
    this.world.add(die);
    die.castShadow = false; // en grande, cerca de la cámara, no debe ensombrecer el tablero

    const face = dieFaceIndex(r);
    const qFinal = dieQuaternion(r, face);
    const { right, up, back } = this.cameraAxes();
    const viewH = (this.camera.top - this.camera.bottom) / this.camera.zoom;
    const big = (viewH * 0.2) / DIE_SIZE;
    const show = this.controls.target.clone().addScaledVector(back, 20).addScaledVector(up, viewH * 0.06);
    const qShow = dieFacingQuaternion(face, back, up);
    const color = col(r.die === 'grey' ? '#e6e6e6' : CAMEL_COLORS[r.die]);
    const spin = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();

    // 1. sale disparado hacia la pantalla girando
    this.sound(() => sfx.whoosh(true));
    die.position.copy(start);
    die.scale.setScalar(0.4);
    await this.tween(450, (k) => {
      const e = easeOut(k);
      die.position.lerpVectors(start, show, e).addScaledVector(up, Math.sin(k * Math.PI) * viewH * 0.08);
      die.scale.setScalar(0.4 + (big - 0.4) * e);
      die.quaternion.copy(qShow).multiply(new THREE.Quaternion().setFromAxisAngle(spin, (1 - e) * Math.PI * 6));
      if (Math.random() < 0.9 * this.fx)
        this.glow.emit({
          pos: die.position.clone().addScaledVector(back, -1),
          vel: new THREE.Vector3(rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3)),
          color,
          size: 0.25 + e * viewH * 0.03,
          sizeEnd: 0,
          life: 0.5,
        });
    });

    // 2. destello y se queda en grande un momento
    this.sound(() => sfx.reveal());
    const behind = show.clone().addScaledVector(back, -2.5);
    this.glow.emit({ pos: behind, vel: new THREE.Vector3(), color, alpha: 0.55, size: viewH * 0.35, sizeEnd: viewH * 0.55, life: 1.1 });
    for (let i = 0; i < Math.ceil(48 * this.fx); i++) {
      const a = (i / 48) * Math.PI * 2;
      const dir = right.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
      this.glow.emit({
        pos: behind.clone(),
        vel: dir.multiplyScalar(rand(4, 8)),
        color: color.clone().lerp(col('#fff3c4'), 0.4),
        size: 0.5,
        sizeEnd: 0.05,
        life: rand(0.6, 1),
        drag: 2.2,
      });
    }
    this.shake(0.06);
    await this.tween(600, (k) => {
      const wob = Math.sin(k * Math.PI * 3) * 0.12 * (1 - k);
      die.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(up, wob)).multiply(qShow);
      die.scale.setScalar(big * (1 + 0.1 * Math.sin(Math.min(1, k * 4) * Math.PI)));
    });

    // 3. cae a su sitio en el tablero
    this.sound(() => sfx.whoosh(false));
    const qStart = die.quaternion.clone();
    const fallSpin = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    await this.tween(480, (k) => {
      const e = easeInOut(k);
      die.position.lerpVectors(show, slot, k * k);
      die.position.y += Math.sin(k * Math.PI) * 1.2;
      die.scale.setScalar(big + (1 - big) * e);
      die.quaternion
        .slerpQuaternions(qStart, qFinal, e)
        .multiply(new THREE.Quaternion().setFromAxisAngle(fallSpin, (1 - e) * Math.PI * 4));
    });
    die.position.copy(slot);
    die.quaternion.copy(qFinal);
    die.scale.setScalar(1);
    die.castShadow = true;
    this.dustPuff(slot.clone().setY(0.05), 14, '#d9b27a', 1.4);
    this.sound(() => sfx.dieClack(1));
    this.sparks(slot.clone().setY(0.4), color, 26, 2.5, { up: 1.5 });
    this.shake(0.08);
    await this.tween(260, (k) => {
      die.position.y = slot.y + Math.abs(Math.sin(k * Math.PI * 2)) * 0.32 * (1 - k);
    });
    this.dustPuff(slot.clone().setY(0.05), 5, '#d9b27a', 0.8);
    this.sound(() => sfx.dieClack(0.5));

  }

  private async syncDice(state: GameState, animated: boolean) {
    if (this.dice.length === state.revealed.length) return;
    if (animated && state.revealed.length === 0) {
      // los dados vuelven a la pirámide
      const dice = this.dice;
      this.dice = [];
      const apex = this.pyramid.group.localToWorld(this.pyramid.apex.clone());
      await Promise.all(
        dice.map((d, i) =>
          this.wait(i * 120).then(() => {
            const from = d.position.clone();
            const q0 = d.quaternion.clone();
            return this.tween(650, (k) => {
              const e = easeInOut(k);
              d.position.lerpVectors(from, apex, e);
              d.position.y += Math.sin(k * Math.PI) * 2;
              d.quaternion.copy(q0).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 1, 0).normalize(), k * 8));
              d.scale.setScalar(1 - e * 0.85);
            }).then(() => {
              this.world.remove(d);
              this.sparks(apex, '#ffd36a', 12, 2);
              this.sound(() => sfx.pop());
            });
          }),
        ),
      );
      return;
    }
    for (const d of this.dice) this.world.remove(d);
    this.dice = state.revealed.map((r, i) => {
      const die = createDie(r.die);
      die.position.copy(DICE_SLOT(i));
      die.quaternion.copy(dieQuaternion(r));
      this.world.add(die);
      return die;
    });
  }

  // ---------- Fichas de etapa, de pirámide y cartas ----------

  /** Vuela una pieza hacia la esquina superior izquierda de la pantalla (donde están los jugadores). */
  private flyToPlayer(mesh: THREE.Mesh, trail: string) {
    mesh.userData.flying = true;
    const start = mesh.getWorldPosition(new THREE.Vector3());
    this.world.attach(mesh);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const back = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 2);
    const end = start.clone().addScaledVector(up, 6).addScaledVector(right, -7).addScaledVector(back, 6);
    const r0 = mesh.rotation.clone();
    const c = col(trail);
    return this.tween(850, (k) => {
      const e = easeInOut(k);
      mesh.position.lerpVectors(start, end, e);
      mesh.position.y += Math.sin(k * Math.PI) * 1.5;
      mesh.rotation.set(r0.x + e * Math.PI * 1.5, r0.y + e * Math.PI, r0.z);
      mesh.scale.setScalar(1 - e * 0.8);
      if (Math.random() < 0.8 * this.fx)
        this.glow.emit({ pos: mesh.position.clone(), vel: new THREE.Vector3(0, 0.3, 0), color: c, size: 0.35, sizeEnd: 0, life: 0.6 });
    }).then(() => this.world.remove(mesh));
  }

  private async playBet(color: RacingColor) {
    const stack = this.bets.get(color)!;
    const ticket = stack.tickets.pop();
    if (!ticket) return;
    this.sound(() => sfx.ticket());
    this.sparks(ticket.getWorldPosition(new THREE.Vector3()), CAMEL_COLORS[color], 20, 2);
    await this.flyToPlayer(ticket, CAMEL_COLORS[color]);
  }

  private makeTicket(color: RacingColor, value: number, i: number) {
    const t = flatPiece(1.3, 1.75, 0.07, betTicketTexture(CAMEL_COLORS[color], value), '#efe2c4');
    t.position.copy(TICKET_POS(i));
    t.rotation.y = (i - 1.5) * 0.04;
    t.userData.value = value;
    return t;
  }

  private async syncBets(state: GameState, animated: boolean) {
    const jobs: Promise<void>[] = [];
    RACING.forEach((c, ci) => {
      const stack = this.bets.get(c)!;
      const want = state.betStacks[c];
      const have = stack.tickets.map((t) => t.userData.value as number);
      if (want.length === have.length && want.every((v, i) => v === have[i])) return;
      const restoring = animated && have.every((v, i) => v === want[i]) && want.length > have.length;
      if (!restoring) {
        for (const t of stack.tickets) stack.group.remove(t);
        stack.tickets = want.map((v, i) => this.makeTicket(c, v, i));
        stack.group.add(...stack.tickets);
        return;
      }
      for (let i = have.length; i < want.length; i++) {
        const t = this.makeTicket(c, want[i], i);
        const target = t.position.clone();
        t.position.y += 5;
        t.visible = false;
        stack.group.add(t);
        stack.tickets.push(t);
        jobs.push(
          this.wait(ci * 90 + i * 110).then(() => {
            this.sound(() => sfx.card());
            t.visible = true;
            return this.tween(600, (k) => {
              t.position.y = target.y + (1 - easeOutBounce(k)) * 5;
            }).then(() => {
              if (i === want.length - 1) this.dustPuff(stack.group.position.clone().setY(0.1), 6, '#e6c48c', 0.8);
            });
          }),
        );
      }
    });
    await Promise.all(jobs);
  }

  private async syncTokens(state: GameState, animated: boolean) {
    if (this.tokens.length === state.pyramidLeft) return;
    if (animated && this.tokens.length < state.pyramidLeft) {
      const jobs: Promise<void>[] = [];
      for (let i = this.tokens.length; i < state.pyramidLeft; i++) {
        const t = createPyramidToken();
        const y = 0.06 + i * 0.1;
        t.position.copy(TOKENS_POS).setY(y + 5);
        t.visible = false;
        this.world.add(t);
        this.tokens.push(t);
        jobs.push(
          this.wait(300 + i * 120).then(() => {
            t.visible = true;
            return this.tween(550, (k) => (t.position.y = y + (1 - easeOutBounce(k)) * 5));
          }),
        );
      }
      await Promise.all(jobs);
      return;
    }
    for (const t of this.tokens) this.world.remove(t);
    this.tokens = [];
    for (let i = 0; i < state.pyramidLeft; i++) {
      const t = createPyramidToken();
      t.position.copy(TOKENS_POS).setY(0.06 + i * 0.1);
      this.world.add(t);
      this.tokens.push(t);
    }
  }

  private makeCard(pile: FinalPile, i: number, playerId: string) {
    const c = flatPiece(1.0, 1.45, 0.04, cardBackTexture(this.seatColor(playerId)), '#f2e3c2');
    const base = PILE_POS[pile];
    c.position.set(base.x + Math.sin(i * 2.3) * 0.06, base.y + 0.04 + i * 0.045, base.z + Math.cos(i * 1.7) * 0.06);
    c.rotation.y = Math.sin(i * 3.1) * 0.12;
    return c;
  }

  private async playFinalCard(pile: FinalPile, playerId: string) {
    this.sound(() => sfx.card());
    const i = this.piles[pile].length;
    const card = this.makeCard(pile, i, playerId);
    const end = card.position.clone();
    const r1 = card.rotation.y;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const start = end.clone().addScaledVector(up, 8).addScaledVector(right, -6);
    card.position.copy(start);
    this.world.add(card);
    this.piles[pile].push(card);
    const color = this.seatColor(playerId);
    await this.tween(800, (k) => {
      const e = easeOut(k);
      card.position.lerpVectors(start, end, e);
      card.position.y += Math.sin(k * Math.PI) * 2;
      card.rotation.y = r1 + (1 - e) * Math.PI * 4;
      card.rotation.z = (1 - e) * 0.8;
      if (Math.random() < 0.7 * this.fx)
        this.glow.emit({ pos: card.position.clone(), vel: new THREE.Vector3(0, 0.2, 0), color: col(color), size: 0.3, sizeEnd: 0, life: 0.5 });
    });
    this.dustPuff(end, 8, '#e6c48c', 1);
    this.sound(() => sfx.card());
    this.sparks(end.clone().setY(0.3), color, 16, 1.8);
  }

  private syncPiles(state: GameState) {
    for (const [pile, cards] of [['winner', state.winnerPile], ['loser', state.loserPile]] as const) {
      const have = this.piles[pile];
      if (have.length > cards.length) {
        for (const c of have) this.world.remove(c);
        this.piles[pile] = [];
      }
      for (let i = this.piles[pile].length; i < cards.length; i++) {
        const c = this.makeCard(pile, i, cards[i].playerId);
        this.world.add(c);
        this.piles[pile].push(c);
      }
    }
  }

  // ---------- Público ----------

  private async syncSpectators(state: GameState, animated: boolean) {
    const jobs: Promise<void>[] = [];
    const seen = new Set<string>();
    for (const p of state.players) {
      const want = p.spectator;
      const have = this.spectators.get(p.id);
      seen.add(p.id);
      if (have && want && have.space === want.space && have.side === want.side) continue;
      if (have) {
        this.spectators.delete(p.id);
        jobs.push(this.removeSpectator(have.tile, animated));
      }
      if (want) {
        const tile = new SpectatorTile(PLAYER_COLORS[p.seat], want.side);
        const pos = cellPosition(want.space);
        tile.group.position.set(pos.x, TILE_TOP, pos.z);
        tile.group.rotation.y = facing(want.space, 'blue');
        this.world.add(tile.group);
        this.spectators.set(p.id, { tile, space: want.space, side: want.side });
        if (animated) jobs.push(this.dropSpectator(tile, PLAYER_COLORS[p.seat]));
      }
    }
    for (const [id, s] of this.spectators)
      if (!seen.has(id)) {
        this.spectators.delete(id);
        jobs.push(this.removeSpectator(s.tile, animated));
      }
    await Promise.all(jobs);
  }

  private async dropSpectator(tile: SpectatorTile, color: string) {
    const g = tile.group;
    const y = g.position.y;
    const rot = g.rotation.y; // orientación final, alineada con la pista
    await this.tween(650, (k) => {
      g.position.y = y + (1 - easeOutBounce(k)) * 4;
      g.rotation.y = rot + (1 - easeOut(k)) * Math.PI * 1.5;
    });
    this.dustPuff(g.position.clone(), 18, '#e2bd84', 2);
    this.sound(() => sfx.thud());
    this.sparks(g.position.clone().setY(0.4), color, 18, 2);
    tile.excite();
  }

  private async removeSpectator(tile: SpectatorTile, animated: boolean) {
    const g = tile.group;
    if (animated) {
      const y = g.position.y;
      const rot = g.rotation.y;
      await this.tween(500, (k) => {
        g.position.y = y + easeInOut(k) * 2.5;
        g.scale.setScalar(1 - easeInOut(k));
        g.rotation.y = rot + k * 3;
      });
      this.dust.emit({ pos: g.position.clone(), vel: new THREE.Vector3(0, 0.5, 0), color: col('#e2bd84'), alpha: 0.5, size: 0.8, sizeEnd: 2, life: 0.8 });
    }
    this.world.remove(g);
  }

  // ---------- Celebraciones ----------

  private camelTop(id: CamelId) {
    const c = this.camels.get(id)!;
    return c.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.1, 0));
  }

  private async celebrateStage(state: GameState) {
    const s = state.lastStage;
    if (!s) return;
    this.sound(() => sfx.fanfare());
    const lead = this.camelTop(s.leader);
    const second = this.camelTop(s.second);
    this.texts.spawn('1º', '#ffd35a', lead.clone().add(new THREE.Vector3(0, 1.2, 0)), 0.9, 2.4);
    this.texts.spawn('2º', '#e0e6ef', second.clone().add(new THREE.Vector3(0, 1.2, 0)), 0.7, 2.4);
    for (let i = 0; i < 3; i++) setTimeout(() => this.sparks(lead, '#ffd35a', 40, 3, { up: 4, gravity: 3, life: 1.2 }), i * 180);
    this.confettiBurst(lead, [CAMEL_COLORS[s.leader], '#ffd35a', '#ffffff'], 70, 6);
    this.circuit.cheer(2.5, this.time);
    const leader = this.camels.get(s.leader)!;
    leader.land();
    leader.mood = 'happy';
    this.sound(() => sfx.happy());
    this.shake(0.08);
    await this.wait(1300);
    leader.mood = 'idle';
  }

  private celebrateRace(state: GameState) {
    const f = state.final;
    if (!f) return;
    this.sound(() => sfx.bigFanfare());
    this.fireworksUntil = this.time + 9;
    this.circuit.cheer(9, this.time);
    this.confettiRainUntil = this.time + 5;
    this.texts.spawn('¡GANADOR!', '#ffd35a', this.camelTop(f.winner).add(new THREE.Vector3(0, 2, 0)), 1.1, 4);
    this.confettiBurst(this.camelTop(f.winner), [CAMEL_COLORS[f.winner], '#ffd35a', '#ffffff'], 120, 7);
    this.shake(0.15);
  }
}
