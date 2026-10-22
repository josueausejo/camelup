import { audio, mtof } from './engine';

// Música de ambiente egipcio, compuesta en tiempo real (nunca suena igual):
//  · bordón grave de re y la,
//  · darbuka con el ritmo "maqsum" (dum tek - tek dum - tek -),
//  · laúd punteado (tipo oud) que arpegia los acordes,
//  · flauta ney con vibrato que improvisa en la escala Hijaz.

const BPM = 104;
const EIGHTH = 60 / BPM / 2;
const LOOKAHEAD = 0.15;

// Escala Hijaz sobre re (semitonos): re mib fa# sol la sib do
const HIJAZ = [0, 1, 4, 5, 7, 8, 10];
// Acordes (raíz en MIDI) que se repiten cada dos compases: re · mib · re · do
const CHORDS = [50, 51, 50, 48];
// Maqsum en corcheas: D = dum, T = tek, k = golpe suave
const MAQSUM = ['D', 'T', '', 'T', 'D', '', 'T', 'k'];

function scaleNote(degree: number, base = 62) {
  const oct = Math.floor(degree / HIJAZ.length);
  const idx = ((degree % HIJAZ.length) + HIJAZ.length) % HIJAZ.length;
  return base + oct * 12 + HIJAZ[idx];
}

class Music {
  private timer = 0;
  private next = 0;
  private step = 0;
  private drone: { stop(): void } | null = null;
  private melodyDegree = 4; // empieza en la
  private phraseLeft = 0;
  private playing = false;

  start() {
    const ctx = audio.ctx;
    if (!ctx || this.playing) return;
    this.playing = true;
    this.next = ctx.currentTime + 0.1;
    this.step = 0;
    this.drone = this.startDrone();
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.drone?.stop();
    this.drone = null;
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

  private playStep(step: number, when: number) {
    const inBar = step % 8;
    const bar = Math.floor(step / 8);
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];

    // ---------- darbuka ----------
    const hit = MAQSUM[inBar];
    if (hit === 'D') dum(when);
    if (hit === 'T') tek(when, 1);
    if (hit === 'k') tek(when, 0.45);
    // adornos de la darbuka en algunos compases
    if (bar % 4 === 3 && inBar >= 5 && Math.random() < 0.7) tek(when + EIGHTH / 2, 0.4);
    if (Math.random() < 0.15) riq(when + EIGHTH / 2);

    // ---------- laúd ----------
    const arp = [0, 7, 12, 7, 10, 7, 12, 15];
    if (bar >= 1 && (inBar % 2 === 0 || Math.random() < 0.3)) {
      const interval = inBar === 4 && Math.random() < 0.4 ? 8 : arp[inBar];
      oud(mtof(chord + interval), when, inBar === 0 ? 0.11 : 0.07);
    }

    // ---------- ney: frases improvisadas con descansos ----------
    if (bar < 2) return;
    if (inBar === 0 && this.phraseLeft <= 0 && Math.random() < 0.6) this.phraseLeft = 4 + Math.floor(Math.random() * 6);
    if (this.phraseLeft > 0 && (inBar % 2 === 0 || Math.random() < 0.35)) {
      // paseo aleatorio por la escala, sobre todo por grados vecinos
      const moves = [-2, -1, -1, 1, 1, 2, 0];
      this.melodyDegree = Math.max(0, Math.min(9, this.melodyDegree + moves[Math.floor(Math.random() * moves.length)]));
      this.phraseLeft--;
      // al acabar la frase reposa en re o la
      if (this.phraseLeft === 0) this.melodyDegree = Math.random() < 0.5 ? 4 : 7;
      const len = this.phraseLeft === 0 ? 4 : Math.random() < 0.3 ? 2 : 1;
      const note = scaleNote(this.melodyDegree);
      if (Math.random() < 0.2) ney(mtof(scaleNote(this.melodyDegree + 1)), when, EIGHTH * 0.35, 0.035); // floreo
      ney(mtof(note), when + (Math.random() < 0.2 ? EIGHTH * 0.35 : 0), EIGHTH * len, 0.06);
    }
  }

  private startDrone() {
    const ctx = audio.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(lp.frequency);
    lp.connect(out).connect(audio.musicBus);
    const oscs = [mtof(38), mtof(38) * 1.003, mtof(45)].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
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

// ---------- instrumentos ----------

function dum(when: number) {
  audio.tone({ freq: 120, freqEnd: 52, dur: 0.28, vol: 0.32, when, dest: audio.musicBus });
  audio.noise({ dur: 0.05, vol: 0.06, when, dest: audio.musicBus, filter: { type: 'lowpass', freq: 400 } });
}

function tek(when: number, accent: number) {
  audio.noise({ dur: 0.06, vol: 0.13 * accent, when, dest: audio.musicBus, filter: { type: 'bandpass', freq: 3800, q: 1.5 } });
  audio.tone({ type: 'triangle', freq: 820, freqEnd: 600, dur: 0.04, vol: 0.05 * accent, when, dest: audio.musicBus });
}

function riq(when: number) {
  audio.noise({ dur: 0.08, vol: 0.025, when, dest: audio.musicBus, filter: { type: 'highpass', freq: 7000 } });
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
      dur: 0.42,
      vol: vol * k,
      attack: 0.004,
      when,
      dest: audio.musicBus,
      filter: { type: 'lowpass', freq: 2400, freqEnd: 500, q: 2 },
    });
  }
  audio.noise({ dur: 0.02, vol: vol * 0.3, when, dest: audio.musicBus, filter: { type: 'bandpass', freq: freq * 3, q: 3 } });
}

function ney(freq: number, when: number, dur: number, vol: number) {
  const d = dur + 0.18;
  audio.tone({ freq, dur: d, vol, attack: 0.07, when, dest: audio.musicBus, vibrato: { rate: 5.2, depth: freq * 0.006 } });
  audio.tone({ type: 'triangle', freq: freq * 2, dur: d, vol: vol * 0.15, attack: 0.09, when, dest: audio.musicBus });
  // soplido
  audio.noise({ dur: d, vol: vol * 0.25, attack: 0.06, when, dest: audio.musicBus, filter: { type: 'bandpass', freq: freq * 2.5, q: 4 } });
}

export const music = new Music();

/** La música sigue las preferencias: arranca cuando hay audio y está activada. */
export function syncMusic() {
  if (audio.ready && audio.settings.music && audio.settings.musicVolume > 0) music.start();
  else music.stop();
}
