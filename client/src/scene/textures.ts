import * as THREE from 'three';

// Texturas procedurales dibujadas en canvas: arena, piedra, madera, telas, fichas, partículas...

export function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function toTexture(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat !== 1) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  return t;
}

/** Convierte un mapa de alturas (gris) en un normal map. */
export function heightToNormal(src: HTMLCanvasElement, strength = 2, repeat = 1): THREE.Texture {
  const w = src.width;
  const h = src.height;
  const data = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const [c, ctx] = canvas(w, h);
  const out = ctx.createImageData(w, h);
  const H = (x: number, y: number) => data[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  ctx.putImageData(out, 0, 0);
  return toTexture(c, repeat, false);
}

/** Ruido de motas sobre un color base. */
function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, colors: string[], count: number, size: number) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = 0.15 + Math.random() * 0.35;
    const s = Math.random() * size;
    ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

// ---------- Arena ----------

function sandRipples(ctx: CanvasRenderingContext2D, size: number, color: (a: number) => string, n: number) {
  for (let i = 0; i < n; i++) {
    const y0 = (i / n) * size;
    ctx.strokeStyle = color(0.25 + Math.random() * 0.35);
    ctx.lineWidth = 2 + Math.random() * 3;
    ctx.beginPath();
    for (let x = -10; x <= size + 10; x += 8) {
      const y = y0 + Math.sin(x / 37 + i * 1.7) * 7 + Math.sin(x / 13 + i) * 2;
      if (x < 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

export function sandTextures(repeat = 1): { map: THREE.Texture; normalMap: THREE.Texture } {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#e8c58a';
  ctx.fillRect(0, 0, S, S);
  sandRipples(ctx, S, (a) => `rgba(196,150,90,${a * 0.5})`, 34);
  speckle(ctx, S, S, ['#b98a4a', '#fff1c9', '#a8743a', '#f7dca6'], 14000, 2.5);
  const [hc, hctx] = canvas(S);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, S, S);
  sandRipples(hctx, S, (a) => `rgba(255,255,255,${a})`, 34);
  speckle(hctx, S, S, ['#000', '#fff'], 6000, 2);
  return { map: toTexture(c, repeat), normalMap: heightToNormal(hc, 3, repeat) };
}

// ---------- Piedra de las casillas ----------

export function stoneTileTextures(num: number): { map: THREE.Texture; normalMap: THREE.Texture } {
  const S = 256;
  const [c, ctx] = canvas(S);
  const [hc, hctx] = canvas(S);
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#f2dcab');
  g.addColorStop(1, '#ddb879');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, S, S, ['#b8894c', '#fff5d8', '#c99a5a'], 2600, 3);
  hctx.fillStyle = '#9a9a9a';
  hctx.fillRect(0, 0, S, S);
  speckle(hctx, S, S, ['#707070', '#c0c0c0'], 3000, 3);

  // grietas
  for (let k = 0; k < 3; k++) {
    let x = Math.random() * S;
    let y = Math.random() * S;
    ctx.strokeStyle = 'rgba(120,80,40,0.35)';
    hctx.strokeStyle = '#505050';
    ctx.lineWidth = hctx.lineWidth = 1.5;
    ctx.beginPath();
    hctx.beginPath();
    ctx.moveTo(x, y);
    hctx.moveTo(x, y);
    for (let i = 0; i < 6; i++) {
      x += (Math.random() - 0.5) * 50;
      y += (Math.random() - 0.5) * 50;
      ctx.lineTo(x, y);
      hctx.lineTo(x, y);
    }
    ctx.stroke();
    hctx.stroke();
  }

  // bisel en el borde
  for (let i = 0; i < 14; i++) {
    const v = Math.round(154 - (14 - i) * 7);
    hctx.strokeStyle = `rgb(${v},${v},${v})`;
    hctx.lineWidth = 1;
    hctx.strokeRect(i + 0.5, i + 0.5, S - 2 * i - 1, S - 2 * i - 1);
  }
  ctx.strokeStyle = 'rgba(140,90,40,0.55)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, S - 6, S - 6);

  // número grabado en un medallón
  ctx.fillStyle = '#8a5524';
  ctx.beginPath();
  ctx.arc(48, 48, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e8b25a';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#ffe3a6';
  ctx.font = 'bold 36px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), 48, 50);
  hctx.fillStyle = '#5a5a5a';
  hctx.beginPath();
  hctx.arc(48, 48, 30, 0, Math.PI * 2);
  hctx.fill();
  hctx.fillStyle = '#b0b0b0';
  hctx.font = 'bold 36px Georgia, serif';
  hctx.textAlign = 'center';
  hctx.textBaseline = 'middle';
  hctx.fillText(String(num), 48, 50);

  // jeroglífico decorativo tenue
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#7a4a1c';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(170, 170, 22, 0, Math.PI * 2);
  ctx.moveTo(170, 192);
  ctx.lineTo(170, 230);
  ctx.moveTo(150, 208);
  ctx.lineTo(190, 208);
  ctx.stroke();
  ctx.globalAlpha = 1;

  return { map: toTexture(c), normalMap: heightToNormal(hc, 4) };
}

// ---------- Madera, ladrillo, telas ----------

export function woodTexture(base = '#9b6a3c'): THREE.Texture {
  const [c, ctx] = canvas(512, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = `rgba(60,30,10,${0.05 + Math.random() * 0.14})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    const y = Math.random() * 256;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(160, y + Math.random() * 20 - 10, 340, y + Math.random() * 20 - 10, 512, y);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 256;
    ctx.strokeStyle = 'rgba(50,25,8,0.25)';
    for (let r = 3; r < 14; r += 3) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * 2, r * 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return toTexture(c);
}

/** Veta clara en escala de grises para multiplicar por el color de cada camello. */
export function grainTexture(): THREE.Texture {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.06})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    const y = Math.random() * 256;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(90, y + Math.random() * 16 - 8, 160, y + Math.random() * 16 - 8, 256, y);
    ctx.stroke();
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function sandstoneTextures(): { map: THREE.Texture; normalMap: THREE.Texture } {
  const S = 512;
  const [c, ctx] = canvas(S);
  const [hc, hctx] = canvas(S);
  ctx.fillStyle = '#c99a55';
  ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#202020';
  hctx.fillRect(0, 0, S, S);
  const rows = 8;
  const bh = S / rows;
  for (let r = 0; r < rows; r++) {
    const bw = 128;
    const off = r % 2 ? bw / 2 : 0;
    for (let x = -bw; x < S + bw; x += bw) {
      const shade = 195 + Math.random() * 35;
      ctx.fillStyle = `rgb(${shade + 22},${shade - 8},${shade - 72})`;
      ctx.fillRect(x + off + 3, r * bh + 3, bw - 6, bh - 6);
      hctx.fillStyle = '#c8c8c8';
      hctx.fillRect(x + off + 4, r * bh + 4, bw - 8, bh - 8);
    }
  }
  speckle(ctx, S, S, ['#8d6630', '#f3d9a4'], 9000, 3);
  speckle(hctx, S, S, ['#999', '#fff'], 5000, 3);
  return { map: toTexture(c), normalMap: heightToNormal(hc, 3) };
}

export function fabricTexture(a: string, b: string, accent = '#f4d27a'): THREE.Texture {
  const [c, ctx] = canvas(128);
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 32) {
    ctx.fillStyle = b;
    ctx.fillRect(0, i + 8, 128, 12);
    ctx.fillStyle = accent;
    ctx.fillRect(0, i + 22, 128, 3);
  }
  for (let x = 0; x < 128; x += 16) {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(x, 4);
    ctx.lineTo(x + 8, 0);
    ctx.lineTo(x + 16, 4);
    ctx.fill();
  }
  return toTexture(c);
}

export function rugTexture(): THREE.Texture {
  const [c, ctx] = canvas(512, 128);
  ctx.fillStyle = '#8e1f1f';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#e7b75a';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 496, 112);
  ctx.strokeStyle = '#1f3a6e';
  ctx.lineWidth = 8;
  ctx.strokeRect(20, 20, 472, 88);
  for (let x = 40; x < 480; x += 48) {
    ctx.fillStyle = '#e7b75a';
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 20, 40);
    ctx.lineTo(x + 40, 64);
    ctx.lineTo(x + 20, 88);
    ctx.fill();
    ctx.fillStyle = '#1f3a6e';
    ctx.beginPath();
    ctx.arc(x + 20, 64, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  // flecos
  ctx.fillStyle = '#f1e2c0';
  for (let y = 4; y < 124; y += 6) {
    ctx.fillRect(0, y, 6, 2);
    ctx.fillRect(506, y, 6, 2);
  }
  return toTexture(c);
}

export function finishLineTexture(): THREE.Texture {
  const [c, ctx] = canvas(64, 256);
  const s = 16;
  for (let y = 0; y < 256; y += s)
    for (let x = 0; x < 64; x += s) {
      ctx.fillStyle = ((x + y) / s) % 2 ? '#1d1d1d' : '#f7f2e6';
      ctx.fillRect(x, y, s, s);
    }
  return toTexture(c);
}

export function checkerFlagTexture(): THREE.Texture {
  const [c, ctx] = canvas(128, 96);
  const s = 16;
  for (let y = 0; y < 96; y += s)
    for (let x = 0; x < 128; x += s) {
      ctx.fillStyle = ((x + y) / s) % 2 ? '#151515' : '#fafafa';
      ctx.fillRect(x, y, s, s);
    }
  return toTexture(c);
}

// ---------- Dados ----------

/** Cara de dado: puntos (dados de carrera) o número (dado gris de los camellos locos). */
export function dieFaceTexture(bg: string, fg: string, value: number, numeral = false): THREE.Texture {
  const [c, ctx] = canvas(128);
  const g = ctx.createRadialGradient(64, 54, 10, 64, 64, 90);
  g.addColorStop(0, bg);
  g.addColorStop(1, shade(bg, -0.18));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  if (numeral) {
    ctx.font = 'bold 92px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    // contorno de contraste para leer bien el número blanco o negro sobre gris
    ctx.strokeStyle = fg === '#ffffff' ? 'rgba(40,40,40,0.55)' : 'rgba(255,255,255,0.45)';
    ctx.strokeText(String(value), 64, 70);
    ctx.fillStyle = fg;
    ctx.fillText(String(value), 64, 70);
    return toTexture(c);
  }
  const pips: Record<number, [number, number][]> = {
    1: [[64, 64]],
    2: [[36, 36], [92, 92]],
    3: [[32, 32], [64, 64], [96, 96]],
  };
  for (const [x, y] of pips[value]) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(x + 1.5, y + 2, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}

function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amount);
  return `#${c.getHexString()}`;
}

// ---------- Fichas y cartas ----------

export function betTicketTexture(color: string, value: number): THREE.Texture {
  const [c, ctx] = canvas(192, 256);
  ctx.fillStyle = '#f6ecd4';
  ctx.fillRect(0, 0, 192, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, shade(color, 0.08));
  g.addColorStop(1, shade(color, -0.1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(10, 10, 172, 236, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,240,200,0.7)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(18, 18, 156, 220, 10);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(96, 106, 58, 0, Math.PI * 2);
  ctx.fill();
  const cg = ctx.createRadialGradient(86, 94, 6, 96, 106, 50);
  cg.addColorStop(0, '#f6c35a');
  cg.addColorStop(1, '#b8651a');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(96, 106, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff3d6';
  ctx.font = 'bold 64px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), 96, 110);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = 'bold 26px Georgia, serif';
  ctx.fillText('+1   −1', 96, 205);
  return toTexture(c);
}

export function spectatorTexture(playerColor: string, side: 'cheer' | 'boo'): THREE.Texture {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = side === 'cheer' ? '#e4f1cc' : '#f4d3cb';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = playerColor;
  ctx.lineWidth = 24;
  ctx.strokeRect(12, 12, 232, 232);
  ctx.fillStyle = side === 'cheer' ? '#2f8a2f' : '#b3261e';
  ctx.font = 'bold 110px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(side === 'cheer' ? '+1' : '−1', 128, 136);
  return toTexture(c);
}

export function cardBackTexture(playerColor: string): THREE.Texture {
  const [c, ctx] = canvas(128, 192);
  ctx.fillStyle = '#f2e3c2';
  ctx.fillRect(0, 0, 128, 192);
  ctx.fillStyle = playerColor;
  ctx.beginPath();
  ctx.roundRect(8, 8, 112, 176, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, 92, 156);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 54px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 64, 98);
  return toTexture(c);
}

export function labelTexture(text: string, bg = '#7a4a1c', fg = '#ffe9b8'): THREE.Texture {
  const [c, ctx] = canvas(512, 128);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(4, 4, 504, 120, 24);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,233,184,0.6)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.font = 'bold 60px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68);
  return toTexture(c);
}

export function coinTexture(): THREE.Texture {
  const [c, ctx] = canvas(128);
  const g = ctx.createRadialGradient(54, 50, 10, 64, 64, 64);
  g.addColorStop(0, '#ffe08a');
  g.addColorStop(1, '#c07a18');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#8a5210';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#8a5210';
  ctx.font = 'bold 60px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('1', 64, 68);
  return toTexture(c);
}

// ---------- Naturaleza ----------

export function leafTexture(): THREE.Texture {
  const [c, ctx] = canvas(64, 256);
  ctx.clearRect(0, 0, 64, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#3f9a3a');
  g.addColorStop(1, '#245e25');
  ctx.fillStyle = g;
  // hoja de palmera con foliolos
  for (let y = 12; y < 248; y += 7) {
    const w = Math.sin((y / 256) * Math.PI) * 30;
    ctx.beginPath();
    ctx.moveTo(32, y);
    ctx.lineTo(32 - w, y + 16);
    ctx.lineTo(32 - w + 4, y + 18);
    ctx.lineTo(32, y + 6);
    ctx.lineTo(32 + w - 4, y + 18);
    ctx.lineTo(32 + w, y + 16);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = '#9ccc65';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(32, 0);
  ctx.lineTo(32, 256);
  ctx.stroke();
  return toTexture(c);
}

export function waterNormal(): THREE.Texture {
  const S = 256;
  const [hc, hctx] = canvas(S);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 6 + Math.random() * 26;
    const g = hctx.createRadialGradient(x, y, 0, x, y, r);
    const v = Math.random() > 0.5 ? 255 : 0;
    g.addColorStop(0, `rgba(${v},${v},${v},0.18)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    hctx.fillStyle = g;
    hctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return heightToNormal(hc, 5, 3);
}

// ---------- Fondo y suelo ----------

export function skyTexture(): THREE.Texture {
  const [c, ctx] = canvas(16, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#f6d7a0');
  g.addColorStop(0.55, '#f0bf7c');
  g.addColorStop(1, '#d9945a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 512);
  return toTexture(c);
}

export function blobShadowTexture(): THREE.Texture {
  const [c, ctx] = canvas(256);
  const g = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
  g.addColorStop(0, 'rgba(60,30,5,0.55)');
  g.addColorStop(1, 'rgba(60,30,5,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return toTexture(c);
}

// ---------- Partículas ----------

export function softDotTexture(): THREE.Texture {
  const [c, ctx] = canvas(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c, 1, false);
}

export function sparkleTexture(): THREE.Texture {
  const [c, ctx] = canvas(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 12);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (const [w, h] of [[2, 30], [30, 2]]) {
    const lg = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    lg.addColorStop(0, 'rgba(255,255,255,1)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(32 - w, 32 - h, w * 2, h * 2);
  }
  return toTexture(c, 1, false);
}

export function smokeTexture(): THREE.Texture {
  const [c, ctx] = canvas(64);
  for (let i = 0; i < 10; i++) {
    const x = 20 + Math.random() * 24;
    const y = 20 + Math.random() * 24;
    const r = 10 + Math.random() * 12;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return toTexture(c, 1, false);
}

export function textTexture(text: string, color: string, size = 72): THREE.Texture {
  const [c, ctx] = canvas(512, 128);
  ctx.font = `900 ${size}px Cinzel, Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 12;
  ctx.strokeStyle = 'rgba(40,20,5,0.85)';
  ctx.strokeText(text, 256, 66);
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 66);
  return toTexture(c);
}

// ---------- Circuito ----------

/** Tierra batida de la pista: rastrillada a lo largo y con huellas de pezuñas. */
export function trackTextures(): { map: THREE.Texture; normalMap: THREE.Texture } {
  const W = 512;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  const [hc, hctx] = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#c98f55');
  g.addColorStop(0.15, '#dba76c');
  g.addColorStop(0.85, '#dba76c');
  g.addColorStop(1, '#c98f55');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, W, H);
  // surcos del rastrillo, a lo largo de la pista (eje u)
  for (let i = 0; i < 46; i++) {
    const y = (i / 46) * H + Math.random() * 3;
    ctx.strokeStyle = `rgba(150,95,45,${0.12 + Math.random() * 0.12})`;
    hctx.strokeStyle = `rgba(30,30,30,${0.4 + Math.random() * 0.3})`;
    ctx.lineWidth = hctx.lineWidth = 1.5 + Math.random() * 1.5;
    for (const k of [ctx, hctx]) {
      k.beginPath();
      k.moveTo(0, y);
      for (let x = 0; x <= W; x += 16) k.lineTo(x, y + Math.sin(x / 40 + i) * 1.5);
      k.stroke();
    }
  }
  speckle(ctx, W, H, ['#a8743a', '#f1cf98', '#b9814a'], 9000, 2.5);
  // huellas de pezuñas
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * W;
    const y = 40 + Math.random() * (H - 80);
    for (const [k, col] of [
      [ctx, 'rgba(120,70,30,0.35)'],
      [hctx, 'rgba(0,0,0,0.6)'],
    ] as const) {
      k.fillStyle = col;
      for (const dy of [-5, 5]) {
        k.beginPath();
        k.ellipse(x, y + dy, 6, 3.5, 0, 0, Math.PI * 2);
        k.fill();
      }
    }
  }
  const map = toTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const normalMap = heightToNormal(hc, 3);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  return { map, normalMap };
}

/** Número de casilla pintado en el suelo (fondo transparente). */
export function numberDecalTexture(num: number): THREE.Texture {
  const [c, ctx] = canvas(128);
  ctx.fillStyle = 'rgba(122,70,28,0.92)';
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f2c14e';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = '#fff1cc';
  ctx.font = 'bold 62px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), 64, 68);
  return toTexture(c);
}

/** Pancarta del arco de meta. */
export function bannerTexture(text: string): THREE.Texture {
  const [c, ctx] = canvas(512, 128);
  ctx.fillStyle = '#b5302a';
  ctx.fillRect(0, 0, 512, 128);
  const s = 16;
  for (const y0 of [0, 128 - s])
    for (let x = 0; x < 512; x += s) {
      ctx.fillStyle = (x / s + y0 / s) % 2 ? '#151515' : '#fafafa';
      ctx.fillRect(x, y0, s, s);
    }
  ctx.fillStyle = '#ffe9b0';
  ctx.font = '900 70px Cinzel, Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#5a1510';
  ctx.strokeText(text, 256, 68);
  ctx.fillText(text, 256, 68);
  return toTexture(c);
}
