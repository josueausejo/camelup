import { audio, mtof } from './engine';

// Efectos de sonido cartoon, sintetizados. Cada uno comprueba si los efectos están activos
// y algunos se limitan en frecuencia para no saturar (saltos, golpes, voces).

const last = new Map<string, number>();
function ok(name: string, gap = 0): boolean {
  if (!audio.sfxOn) return false;
  if (gap) {
    const now = performance.now();
    if (now - (last.get(name) ?? 0) < gap) return false;
    last.set(name, now);
  }
  return true;
}
const r = (a: number, b: number) => a + Math.random() * (b - a);

// Escala Hijaz (re) para fanfarrias y jingles: D Eb F# G A Bb C
const HIJAZ = [62, 63, 66, 67, 69, 70, 72, 74, 75, 78, 79, 81];

export const sfx = {
  // ---------- interfaz ----------
  click() {
    if (!ok('click', 40)) return;
    audio.tone({ type: 'triangle', freq: 880, freqEnd: 620, dur: 0.05, vol: 0.07 });
  },
  error() {
    if (!ok('error', 200)) return;
    audio.tone({ type: 'square', freq: 220, freqEnd: 180, dur: 0.18, vol: 0.05, filter: { type: 'lowpass', freq: 1200 } });
    audio.tone({ type: 'square', freq: 165, freqEnd: 140, dur: 0.22, vol: 0.05, when: 0.1, filter: { type: 'lowpass', freq: 1000 } });
  },
  yourTurn() {
    if (!ok('turn', 500)) return;
    // gong suave con parciales inarmónicos
    for (const [k, v] of [
      [1, 0.22],
      [2.41, 0.1],
      [3.93, 0.06],
      [5.4, 0.04],
    ])
      audio.tone({ freq: 196 * k, freqEnd: 196 * k * 0.995, dur: 2.2, vol: v, attack: 0.01 });
    audio.noise({ dur: 0.15, vol: 0.05, filter: { type: 'bandpass', freq: 2500, q: 2 } });
  },
  message() {
    if (!ok('msg', 80)) return;
    audio.tone({ freq: 660, freqEnd: 990, dur: 0.09, vol: 0.12 });
    audio.tone({ freq: 990, dur: 0.12, vol: 0.08, when: 0.07 });
  },
  emojiPop() {
    if (!ok('emoji', 60)) return;
    audio.tone({ freq: 300, freqEnd: 1200, dur: 0.12, vol: 0.16 });
    audio.tone({ type: 'triangle', freq: 1500, dur: 0.06, vol: 0.06, when: 0.1 });
  },
  /** Blip de "voz" de Kamil al hablar (estilo Animal Crossing). */
  talk() {
    if (!ok('talk', 55)) return;
    const f = r(520, 760);
    audio.tone({ type: 'square', freq: f, freqEnd: f * r(0.9, 1.15), dur: 0.045, vol: 0.035, filter: { type: 'lowpass', freq: 2200 } });
  },
  success() {
    if (!ok('success', 300)) return;
    [74, 78, 81, 86].forEach((m, i) => audio.tone({ type: 'triangle', freq: mtof(m), dur: 0.22, vol: 0.13, when: i * 0.08 }));
  },

  // ---------- pirámide y dados ----------
  whoosh(up = true) {
    if (!ok('whoosh', 60)) return;
    audio.noise({ dur: 0.35, vol: 0.12, attack: 0.08, filter: { type: 'bandpass', freq: up ? 400 : 2400, freqEnd: up ? 2600 : 400, q: 1.5 } });
  },
  /** Los dados traqueteando dentro de la pirámide. */
  pyramidShake(seconds: number) {
    if (!ok('shake', 200)) return;
    const n = Math.round(seconds * 16);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * seconds + r(0, 0.03);
      audio.noise({ dur: 0.04, vol: r(0.18, 0.32), when: t, filter: { type: 'bandpass', freq: r(1800, 3200), q: 4 } });
      audio.tone({ type: 'triangle', freq: r(500, 900), dur: 0.03, vol: 0.1, when: t });
    }
    audio.noise({ dur: seconds, vol: 0.12, attack: 0.1, filter: { type: 'lowpass', freq: 220 } });
  },
  dieClack(vol = 1) {
    if (!ok('clack', 35)) return;
    audio.noise({ dur: 0.05, vol: 0.18 * vol, filter: { type: 'bandpass', freq: r(2200, 3000), q: 3 } });
    audio.tone({ type: 'triangle', freq: r(650, 800), freqEnd: 400, dur: 0.06, vol: 0.1 * vol });
  },
  /** Destello mágico al mostrarse el dado en grande. */
  reveal() {
    if (!ok('reveal', 150)) return;
    [86, 90, 93, 98].forEach((m, i) =>
      audio.tone({ freq: mtof(m), dur: 0.5, vol: 0.07, when: i * 0.045, vibrato: { rate: 7, depth: 6 } }),
    );
    audio.noise({ dur: 0.4, vol: 0.04, attack: 0.05, filter: { type: 'highpass', freq: 6000 } });
  },
  drumroll(seconds: number) {
    if (!ok('drumroll', 500)) return;
    const n = Math.round(seconds * 22);
    for (let i = 0; i < n; i++)
      audio.noise({ dur: 0.05, vol: 0.05 + (i / n) * 0.1, when: i / 22, filter: { type: 'bandpass', freq: 900, q: 1.2 } });
  },

  // ---------- camellos ----------
  hop() {
    if (!ok('hop', 45)) return;
    audio.tone({ type: 'triangle', freq: r(260, 320), freqEnd: r(560, 680), dur: 0.12, vol: 0.09 });
  },
  land(weight = 1) {
    if (!ok('land', 45)) return;
    audio.tone({ freq: 150, freqEnd: 55, dur: 0.16, vol: 0.18 * Math.min(1.6, weight) });
    audio.noise({ dur: 0.08, vol: 0.07, filter: { type: 'lowpass', freq: 500 } });
  },
  /** Muelle de dibujo animado (salto grande, mascota). */
  boing() {
    if (!ok('boing', 80)) return;
    audio.tone({ freq: 180, freqEnd: 520, dur: 0.35, vol: 0.14, vibrato: { rate: 22, depth: 40 } });
  },
  pop() {
    if (!ok('pop', 40)) return;
    audio.tone({ freq: 380, freqEnd: 900, dur: 0.07, vol: 0.12 });
  },
  scared() {
    if (!ok('scared', 250)) return;
    audio.tone({ freq: 900, freqEnd: 1700, dur: 0.12, vol: 0.08, vibrato: { rate: 30, depth: 60 } });
    audio.tone({ freq: 1500, freqEnd: 2100, dur: 0.1, vol: 0.06, when: 0.12 });
  },
  happy() {
    if (!ok('happy', 250)) return;
    audio.tone({ type: 'triangle', freq: mtof(79), dur: 0.12, vol: 0.1 });
    audio.tone({ type: 'triangle', freq: mtof(86), dur: 0.18, vol: 0.1, when: 0.1 });
  },
  /** Risita tambaleante de los camellos locos. */
  crazy() {
    if (!ok('crazy', 400)) return;
    for (let i = 0; i < 4; i++)
      audio.voice({ freq: 520 - i * 40, freqEnd: 380 - i * 30, dur: 0.11, vol: 0.06, when: i * 0.11, formants: [700, 1100] });
  },
  /** Gruñido de camello. */
  grunt() {
    if (!ok('grunt', 300)) return;
    audio.voice({ freq: 95, freqEnd: 70, dur: 0.45, vol: 0.12, formants: [400, 800], vibrato: 9 });
  },

  // ---------- fichas, cartas y monedas ----------
  coin() {
    if (!ok('coin', 70)) return;
    audio.tone({ type: 'square', freq: 1318, dur: 0.07, vol: 0.05, filter: { type: 'lowpass', freq: 5000 } });
    audio.tone({ type: 'square', freq: 1760, dur: 0.22, vol: 0.05, when: 0.06, filter: { type: 'lowpass', freq: 5000 } });
  },
  ticket() {
    if (!ok('ticket', 80)) return;
    audio.noise({ dur: 0.18, vol: 0.09, attack: 0.02, filter: { type: 'bandpass', freq: 3500, freqEnd: 1800, q: 1 } });
    audio.tone({ freq: 700, freqEnd: 1400, dur: 0.1, vol: 0.06, when: 0.05 });
  },
  card() {
    if (!ok('card', 60)) return;
    audio.noise({ dur: 0.07, vol: 0.12, filter: { type: 'highpass', freq: 2500 } });
    audio.tone({ type: 'triangle', freq: 500, freqEnd: 300, dur: 0.05, vol: 0.06, when: 0.04 });
  },
  thud() {
    if (!ok('thud', 60)) return;
    audio.tone({ freq: 110, freqEnd: 45, dur: 0.22, vol: 0.22 });
    audio.noise({ dur: 0.12, vol: 0.08, filter: { type: 'lowpass', freq: 400 } });
  },

  // ---------- público ----------
  cheer() {
    if (!ok('cheer', 300)) return;
    for (let i = 0; i < 6; i++)
      audio.voice({ freq: r(260, 380), freqEnd: r(420, 560), dur: r(0.35, 0.6), vol: 0.09, when: r(0, 0.25), formants: [r(700, 900), r(1100, 1400)], vibrato: 8 });
    audio.noise({ dur: 0.9, vol: 0.12, attack: 0.08, filter: { type: 'bandpass', freq: 1400, q: 0.7 } });
    // silbido
    audio.tone({ freq: 1800, freqEnd: 2600, dur: 0.3, vol: 0.08, when: 0.15 });
  },
  boo() {
    if (!ok('boo', 300)) return;
    for (let i = 0; i < 5; i++)
      audio.voice({ freq: r(110, 150), freqEnd: r(85, 105), dur: r(0.6, 0.9), vol: 0.12, when: r(0, 0.15), formants: [300, 870], vibrato: 5 });
  },

  // ---------- personas lanzadas ----------
  grab() {
    if (!ok('grab', 100)) return;
    audio.voice({ freq: 420, freqEnd: 560, dur: 0.14, vol: 0.07, formants: [600, 1700] });
  },
  scream() {
    if (!ok('scream', 150)) return;
    audio.voice({ freq: r(560, 700), freqEnd: r(300, 380), dur: 0.9, vol: 0.07, formants: [850, 1250], vibrato: 18 });
  },
  ouch() {
    if (!ok('ouch', 150)) return;
    audio.voice({ freq: 520, freqEnd: 330, dur: 0.22, vol: 0.08, formants: [750, 1200] });
  },
  bonk() {
    if (!ok('bonk', 120)) return;
    audio.tone({ type: 'square', freq: 330, freqEnd: 160, dur: 0.12, vol: 0.08, filter: { type: 'lowpass', freq: 1800 } });
    audio.tone({ type: 'triangle', freq: 990, dur: 0.06, vol: 0.06 });
  },
  dizzy() {
    if (!ok('dizzy', 900)) return;
    [91, 95, 91, 95].forEach((m, i) => audio.tone({ type: 'triangle', freq: mtof(m), dur: 0.12, vol: 0.05, when: i * 0.12 }));
  },

  // ---------- celebraciones ----------
  /** Fanfarria corta en escala Hijaz (fin de etapa). */
  fanfare() {
    if (!ok('fanfare', 800)) return;
    audio.duck(1.6);
    const notes = [62, 66, 69, 74];
    notes.forEach((m, i) => brass(mtof(m), i * 0.12, 0.2, 0.09));
    [62, 66, 69, 74].forEach((m) => brass(mtof(m), 0.5, 0.9, 0.06));
    timpani(0.5);
  },
  /** Gran final: escala ascendente, acorde largo y platillo. */
  bigFanfare() {
    if (!ok('bigFanfare', 2000)) return;
    audio.duck(3);
    HIJAZ.slice(0, 8).forEach((m, i) => brass(mtof(m), i * 0.09, 0.14, 0.08));
    [62, 66, 69, 74, 78].forEach((m) => brass(mtof(m), 0.78, 1.6, 0.06));
    timpani(0.78);
    timpani(1.1);
    audio.noise({ dur: 2, vol: 0.1, when: 0.78, attack: 0.005, filter: { type: 'highpass', freq: 5000 } });
  },
  fireworkLaunch() {
    if (!ok('fwLaunch', 150)) return;
    audio.tone({ freq: 500, freqEnd: 1700, dur: 0.6, vol: 0.07, attack: 0.05 });
  },
  fireworkPop() {
    if (!ok('fwPop', 120)) return;
    audio.noise({ dur: 0.35, vol: 0.4, filter: { type: 'lowpass', freq: 1400, freqEnd: 200 } });
    for (let i = 0; i < 6; i++) audio.noise({ dur: 0.03, vol: 0.1, when: 0.1 + Math.random() * 0.5, filter: { type: 'highpass', freq: 4000 } });
  },
};

function brass(freq: number, when: number, dur: number, vol: number) {
  for (const det of [-4, 4]) {
    audio.tone({
      type: 'sawtooth',
      freq: freq * Math.pow(2, det / 1200),
      dur,
      vol,
      attack: 0.03,
      when,
      filter: { type: 'lowpass', freq: 2600, freqEnd: 900, q: 1 },
    });
  }
}

function timpani(when: number) {
  audio.tone({ freq: 98, freqEnd: 70, dur: 0.6, vol: 0.25, when });
  audio.noise({ dur: 0.1, vol: 0.08, when, filter: { type: 'lowpass', freq: 600 } });
}
