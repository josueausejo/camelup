import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  Oasis,
  Palm,
  createBigPyramid,
  createObelisk,
  createRock,
  createShrub,
  createTent,
} from './models';
import { sandTextures, skyTexture } from './textures';

// El circuito está a ras del suelo del desierto
export const GROUND_Y = -0.03;

export interface Environment {
  sun: THREE.DirectionalLight;
  update(t: number): void;
  setShadowQuality(size: number): void;
}

/** Cielo, luces, dunas y decorado alrededor del tablero. */
export function buildEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Environment {
  scene.background = skyTexture();
  scene.fog = new THREE.Fog('#efc283', 55, 130);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;

  // ---------- Luces ----------
  scene.add(new THREE.HemisphereLight('#ffeacc', '#b07a44', 0.75));
  const sun = new THREE.DirectionalLight('#ffd9a0', 2.5);
  sun.position.set(14, 22, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -17;
  sc.right = sc.top = 17;
  sc.near = 1;
  sc.far = 70;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#a9c4ff', 0.35);
  fill.position.set(-10, 8, -12);
  scene.add(fill);

  // ---------- Suelo con dunas ----------
  const { map, normalMap } = sandTextures(30);
  const ground = new THREE.PlaneGeometry(240, 240, 180, 180);
  ground.rotateX(-Math.PI / 2);
  const pos = ground.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const d = Math.max(Math.abs(x), Math.abs(z));
    const k = THREE.MathUtils.smoothstep(d, 15, 30);
    const h =
      Math.sin(x * 0.07 + Math.cos(z * 0.05) * 2) * 1.6 +
      Math.sin(z * 0.11 + x * 0.03) * 1.1 +
      Math.sin((x + z) * 0.21) * 0.25;
    pos.setY(i, k * Math.max(-0.4, h + 1.2));
  }
  ground.computeVertexNormals();
  const groundMesh = new THREE.Mesh(
    ground,
    new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1, color: '#f4d29a' }),
  );
  groundMesh.position.y = GROUND_Y;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // ---------- Decorado ----------
  const updatables: { update(t: number): void }[] = [];
  const place = (o: THREE.Object3D, x: number, z: number, rot = Math.random() * Math.PI * 2) => {
    o.position.set(x, GROUND_Y, z);
    o.rotation.y = rot;
    scene.add(o);
    return o;
  };

  const oasis = new Oasis(2.4);
  place(oasis.group, -12.5, -11.5, 0);
  updatables.push(oasis);
  for (const [x, z, s] of [
    [-15.2, -12.5, 1.15],
    [-11, -14.6, 0.9],
    [-14.5, -9, 0.8],
    [-9.6, -10.6, 0.7],
  ]) {
    const p = new Palm(s);
    place(p.group, x, z);
    updatables.push(p);
  }

  place(createBigPyramid(7), -4, -22, 0.2);
  place(createBigPyramid(4.6), -21, -5, -0.3);
  place(createBigPyramid(3), -14, -24, 0.5);
  place(createObelisk(), -12.5, 2.5, 0.3);
  place(createObelisk(), 2.5, -12.5, 0.3);
  place(createTent(), 12.5, -4, -0.6);
  const tent2 = createTent();
  tent2.scale.setScalar(0.8);
  place(tent2, 12, 4.5, 0.4);

  const avoid = [
    [-12.5, -11.5, 4.5],
    [-12.5, 2.5, 1.6],
    [2.5, -12.5, 1.6],
    [12.5, -4, 2.2],
    [12, 4.5, 2],
  ];
  let placed = 0;
  for (let tries = 0; placed < 46 && tries < 400; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = 13 + Math.random() * 14;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.abs(x) < 12.5 && Math.abs(z) < 12.5) continue; // fuera del circuito y las gradas
    if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    const o = placed % 3 === 0 ? createShrub() : createRock(0.3 + Math.random() * 0.8);
    place(o, x, z);
    placed++;
  }

  return {
    sun,
    update: (t) => updatables.forEach((u) => u.update(t)),
    setShadowQuality: (size) => {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    },
  };
}
