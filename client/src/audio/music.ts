import { audio, mtof } from './engine';

// Música de ambiente egipcio, compuesta en tiempo real:
//  · flauta pungi de encantador de serpientes (caña nasal, notas ligadas que se deslizan,
//    trinos y vibrato) tocando frases compuestas en escala Hijaz, con variaciones,
//  · bordón nasal continuo como el de la propia pungi,
//  · darbuka con el ritmo "maqsum" (dum tek - tek dum - tek -),
//  · laúd punteado (tipo oud), espaciado para dejar sitio a la melodía.

const BPM = 96;
const EIGHTH = 60 / BPM / 2;
const LOOKAHEAD = 0.2;

// Escala Hijaz sobre re (semitonos): re mib fa# sol la sib do
const HIJAZ = [0, 1, 4, 5, 7, 8, 10];
// Acordes (raíz en MIDI) que se repiten cada dos compases: re · mib · re · do
const CHORDS = [50, 51, 50, 48];
// Maqsum en corcheas: D = dum, T = tek, k = golpe suave
const MAQSUM = ['D', 'T', '', 'T', 'D', '', 'T', 'k'];

type Ornament = 'trill' | 'slide' | 'vib' | 'mordent' | undefined;
/** [nota MIDI (0 = silencio), duración en corcheas, adorno] */
type Note = [number, number, Ornament?];

// Frases de dos compases (16 corcheas) al estilo del encantador de serpientes.
const PHRASES: Note[][] = [
  // 1 · motivo hipnótico alrededor del la
  [[69, 2, 'trill'], [70, 1], [69, 1], [67, 1], [66, 1], [67, 2, 'slide'], [69, 4, 'vib'], [0, 4]],
  // 2 · respuesta que baja hasta re
  [[74, 2, 'slide'], [72, 1], [70, 1], [69, 2], [70, 1], [69, 1], [67, 2], [66, 2, 'trill'], [62, 4, 'vib']],
  // 3 · subida
  [[62, 1], [63, 1], [66, 2, 'slide'], [67, 1], [69, 1], [70, 2, 'trill'], [69, 1], [67, 1], [69, 2, 'mordent'], [0, 4]],
  // 4 · clímax agudo
  [[74, 3, 'slide'], [75, 1], [74, 2], [72, 1], [70, 1], [72, 2, 'trill'], [70, 1], [69, 1], [69, 4, 'vib']],
  // 5 · serpenteo grave
  [[62, 1], [63, 1], [62, 1], [63, 1], [66, 2, 'slide'], [63, 1], [62, 1], [60, 2], [62, 6, 'vib']],
];
// Orden de las frases (-1 = compases de descanso, solo bordón y percusión)
const FORM = [0, 1, 0, 2, 3, 1, 4, -1];

const HIJAZ_NOTES = new Set(Array.from({ length: 40 }, (_, i) => 50 + i).filter((m) => HIJAZ.includes((((m - 62) % 12) + 12) % 12)));
function neighbor(m: number, dir: 1 | -1) {
  let n = m + dir;
  while (!HIJAZ_NOTES.has(n) && Math.abs(n - m) < 4) n += dir;
  return n;
}

/** Una frase con variaciones: adornos nuevos, notas vecinas y a veces una octava más alta. */
function vary(phrase: Note[], strength: number): Note[] {
  const up = Math.random() < 0.15 * strength && Math.max(...phrase.map((n) => n[0])) <= 69 ? 12 : 0;
  return phrase.map(([m, len, orn]) => {
    if (m === 0) return [0, len];
    let note = m + up;
    if (Math.random() < 0.12 * strength && len === 1) note = neighbor(note, Math.random() < 0.5 ? 1 : -1);
    let o = orn;
    if (!o && len >= 2 && Math.random() < 0.25 * strength) o = (['trill', 'slide', 'mordent'] as const)[Math.floor(Math.random() * 3)];
    return [note, len, o];
  });
}

// ---------- Flauta pungi: una voz continua (legato) con timbre nasal de caña ----------

class Pungi {
  private osc: OscillatorNode;
  private osc2: OscillatorNode;
  private gain: GainNode;
  private vibDepth: GainNode;
  private breath: GainNode;
  private nodes: AudioScheduledSourceNode[] = [];

  constructor(dest: AudioNode) {
    const ctx = audio.ctx!;
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc2.detune.value = 6;
    const mix = ctx.createGain();
    const sq = ctx.createGain();
    sq.gain.value = 0.35;
    this.osc.connect(mix);
    this.osc2.connect(sq).connect(mix);
    // formantes de caña doble: el sonido nasal y zumbón de la pungi
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    for (const [f, q, k] of [
      [1150, 5, 1],
      [2500, 6, 0.6],
      [650, 3, 0.5],
    ]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = k;
      mix.connect(bp).connect(g).connect(this.gain);
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    this.gain.connect(lp).connect(dest);
    // vibrato
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.6;
    this.vibDepth = ctx.createGain();
    this.vibDepth.gain.value = 0;
    lfo.connect(this.vibDepth);
    this.vibDepth.connect(this.osc.frequency);
    this.vibDepth.connect(this.osc2.frequency);
    // soplido de aire
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise.buffer = buf;
    noise.loop = true;
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = 2800;
    nbp.Q.value = 1.2;
    this.breath = ctx.createGain();
    this.breath.gain.value = 0;
    noise.connect(nbp).connect(this.breath).connect(dest);

    this.osc.frequency.value = mtof(69);
    this.osc2.frequency.value = mtof(69);
    this.nodes = [this.osc, this.osc2, lfo, noise];
    for (const n of this.nodes) n.start();
  }

  private setFreq(f: number, at: number, glide: number) {
    for (const o of [this.osc, this.osc2]) o.frequency.setTargetAtTime(f, at, glide);
  }

  note(m: number, when: number, dur: number, orn: Ornament, peak = 0.26) {
    const ctx = audio.ctx!;
    const t = ctx.currentTime + when;
    const f = mtof(m);
    // deslizamiento desde abajo o paso ligado rápido a la nota
    if (orn === 'slide') {
      this.setFreq(mtof(m - 3), t, 0.005);
      this.setFreq(f, t + 0.03, 0.06);
    } else this.setFreq(f, t, 0.018);
    // adornos
    if (orn === 'trill') {
      const up = mtof(neighbor(m, 1));
      for (let k = 0.07; k < dur * 0.65; k += 0.13) {
        this.setFreq(up, t + k, 0.01);
        this.setFreq(f, t + k + 0.065, 0.01);
      }
    }
    if (orn === 'mordent') {
      this.setFreq(mtof(neighbor(m, -1)), t + 0.05, 0.008);
      this.setFreq(f, t + 0.11, 0.01);
    }
    // vibrato que crece en las notas largas
    this.vibDepth.gain.setTargetAtTime(f * 0.004, t, 0.02);
    if (dur > EIGHTH * 1.5 || orn === 'vib') this.vibDepth.gain.setTargetAtTime(f * (orn === 'vib' ? 0.016 : 0.01), t + 0.18, 0.15);
    // articulación: cada nota "respira" un poco, sin cortar el sonido (legato)
    const g = this.gain.gain;
    g.setTargetAtTime(peak * 0.55, t, 0.012);
    g.setTargetAtTime(peak, t + 0.02, 0.03);
    g.setTargetAtTime(peak * 0.8, t + dur * 0.7, 0.08);
    this.breath.gain.setTargetAtTime(peak * 0.12, t, 0.03);
  }

  rest(when: number) {
    const t = audio.ctx!.currentTime + when;
    this.gain.gain.setTargetAtTime(0, t, 0.06);
    this.breath.gain.setTargetAtTime(0, t, 0.06);
    this.vibDepth.gain.setTargetAtTime(0, t, 0.1);
  }

  stop() {
    const ctx = audio.ctx!;
    const t = ctx.currentTime;
    this.gain.gain.setTargetAtTime(0, t, 0.1);
    this.breath.gain.setTargetAtTime(0, t, 0.1);
    for (const n of this.nodes) n.stop(t + 0.6);
  }
}

class Music {
  private timer = 0;
  private next = 0;
  private step = 0;
  private drone: { stop(): void } | null = null;
  private flute: Pungi | null = null;
  private melody = new Map<number, Note>(); // corchea absoluta -> nota que empieza ahí
  private formIndex = 0;
  private nextPhraseAt = 16; // la melodía entra tras dos compases de bordón y percusión
  private playing = false;

  start() {
    const ctx = audio.ctx;
    if (!ctx || this.playing) return;
    this.playing = true;
    this.next = ctx.currentTime + 0.1;
    this.step = 0;
    this.melody.clear();
    this.formIndex = 0;
    this.nextPhraseAt = 16;
    this.drone = this.startDrone();
    this.flute = new Pungi(audio.musicBus);
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.drone?.stop();
    this.drone = null;
    this.flute?.stop();
    this.flute = null;
  }

  get isPlaying() {
    return this.playing;
  }

  private schedule() {
    const ctx = audio.ctx;
    if (!ctx) return;
    // si la pestaña estuvo dormida, no intentamos recuperar el tiempo perdido
    if (this.next < ctx.currentTime - 0.5) this.next = ctx.currentTime + 0.05;
    while (this.next < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.next - ctx.currentTime);
      this.next += EIGHTH;
      this.step++;
    }
  }

  /** Coloca la siguiente frase de la forma (con variaciones) a partir de la corchea indicada. */
  private queuePhrase(at: number) {
    const idx = FORM[this.formIndex % FORM.length];
    const round = Math.floor(this.formIndex / FORM.length);
    this.formIndex++;
    if (idx < 0) {
      // compases de descanso: la flauta calla (solo bordón y percusión)
      this.melody.set(at, [0, 16]);
      return;
    }
    // la primera vuelta suena casi tal cual; después, cada vez con más variaciones
    const phrase = vary(PHRASES[idx], Math.min(1, round * 0.6 + 0.2));
    let s = at;
    for (const n of phrase) {
      this.melody.set(s, n);
      s += n[1];
    }
  }

  private playStep(step: number, when: number) {
    const inBar = step % 8;
    const bar = Math.floor(step / 8);
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];

    // ---------- darbuka ----------
    const hit = MAQSUM[inBar];
    if (hit === 'D') dum(when);
    if (hit === 'T') tek(when, 1);
    if (hit === 'k') tek(when, 0.45);
    if (bar % 4 === 3 && inBar >= 5 && Math.random() < 0.7) tek(when + EIGHTH / 2, 0.4);
    if (Math.random() < 0.12) riq(when + EIGHTH / 2);

    // ---------- laúd: raíz y quinta, espaciado ----------
    if (bar >= 1) {
      if (inBar === 0) oud(mtof(chord), when, 0.09);
      if (inBar === 3 && Math.random() < 0.6) oud(mtof(chord + 7), when, 0.05);
      if (inBar === 4) oud(mtof(chord + 12), when, 0.06);
      if (inBar === 6 && Math.random() < 0.4) oud(mtof(chord + 7), when, 0.045);
    }

    // ---------- flauta pungi ----------
    if (step === this.nextPhraseAt) {
      this.queuePhrase(step);
      this.nextPhraseAt = step + 16;
    }
    const n = this.melody.get(step);
    if (n && this.flute) {
      this.melody.delete(step);
      const [m, len, orn] = n;
      if (m === 0) this.flute.rest(when);
      else this.flute.note(m, when, len * EIGHTH, orn);
    }
  }

  private startDrone() {
    const ctx = audio.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 3);
    // bordón nasal como el de la pungi: re grave con formante
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 2.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(lp.frequency);
    lp.connect(out);
    bp.connect(out);
    out.connect(audio.musicBus);
    const oscs = [mtof(38), mtof(38) * 1.003, mtof(45), mtof(50)].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i === 3 ? 0.35 : 1;
      o.connect(g);
      g.connect(lp);
      if (i === 3) g.connect(bp);
      o.start();
      return o;
    });
    lfo.start();
    return {
      stop() {
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0, t + 0.6);
        for (const o of [...oscs, lfo]) o.stop(t + 0.7);
      },
    };
  }
}

// ---------- percusión y laúd ----------

function dum(when: number) {
  audio.tone({ freq: 120, freqEnd: 52, dur: 0.28, vol: 0.3, when, dest: audio.musicBus });
  audio.noise({ dur: 0.05, vol: 0.06, when, dest: audio.musicBus, filter: { type: 'lowpass', freq: 400 } });
}

function tek(when: number, accent: number) {
  audio.noise({ dur: 0.06, vol: 0.12 * accent, when, dest: audio.musicBus, filter: { type: 'bandpass', freq: 3800, q: 1.5 } });
  audio.tone({ type: 'triangle', freq: 820, freqEnd: 600, dur: 0.04, vol: 0.045 * accent, when, dest: audio.musicBus });
}

function riq(when: number) {
  audio.noise({ dur: 0.08, vol: 0.022, when, dest: audio.musicBus, filter: { type: 'highpass', freq: 7000 } });
}

function oud(freq: number, when: number, vol: number) {
  // pulsación con un leve bajón de afinación y filtro que se cierra
  for (const [type, k] of [
    ['triangle', 1],
    ['sawtooth', 0.4],
  ] as const) {
    audio.tone({
      type,
      freq: freq * 1.012,
      freqEnd: freq,
      dur: 0.5,
      vol: vol * k,
      attack: 0.004,
      when,
      dest: audio.musicBus,
      filter: { type: 'lowpass', freq: 2200, freqEnd: 450, q: 2 },
    });
  }
  audio.noise({ dur: 0.02, vol: vol * 0.3, when, dest: audio.musicBus, filter: { type: 'bandpass', freq: freq * 3, q: 3 } });
}

export const music = new Music();

/** La música sigue las preferencias: arranca cuando hay audio y está activada. */
export function syncMusic() {
  if (audio.ready && audio.settings.music && audio.settings.musicVolume > 0) music.start();
  else music.stop();
}
