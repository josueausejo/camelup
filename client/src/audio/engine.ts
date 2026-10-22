// Motor de audio con Web Audio: todo el sonido se sintetiza (no hay archivos de audio).
// Dos buses (música y efectos) con volumen propio, un compresor y preferencias guardadas.

export interface AudioSettings {
  music: boolean;
  sfx: boolean;
  musicVolume: number; // 0-1
  sfxVolume: number; // 0-1
}

const DEFAULTS: AudioSettings = { music: true, sfx: true, musicVolume: 0.45, sfxVolume: 0.8 };

function load(): AudioSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('camelup.audio') ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  freqEnd?: number;
  dur: number;
  vol?: number;
  attack?: number;
  when?: number; // segundos desde ahora
  dest?: AudioNode;
  vibrato?: { rate: number; depth: number }; // depth en Hz
  filter?: { type: BiquadFilterType; freq: number; freqEnd?: number; q?: number };
  glide?: 'exp' | 'lin';
}

export interface NoiseOpts {
  dur: number;
  vol?: number;
  attack?: number;
  when?: number;
  dest?: AudioNode;
  filter?: { type: BiquadFilterType; freq: number; freqEnd?: number; q?: number };
}

class AudioEngine {
  ctx: AudioContext | null = null;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  private master!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private listeners: (() => void)[] = [];
  settings: AudioSettings = load();

  /** Se llama en el primer gesto del usuario (los navegadores no dejan sonar antes). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      comp.connect(this.master).connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.musicBus.connect(comp);
      this.sfxBus.connect(comp);
      // ruido blanco reutilizable
      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.applyVolumes();
      this.listeners.forEach((f) => f());
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Avisa cuando el audio queda listo (para arrancar la música). */
  onReady(f: () => void) {
    this.listeners.push(f);
    if (this.ctx) f();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get sfxOn() {
    return this.ready && this.settings.sfx && this.settings.sfxVolume > 0 && !document.hidden;
  }

  update(patch: Partial<AudioSettings>) {
    this.settings = { ...this.settings, ...patch };
    try {
      localStorage.setItem('camelup.audio', JSON.stringify(this.settings));
    } catch {
      /* sin almacenamiento */
    }
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.settings;
    this.musicBus.gain.setTargetAtTime(s.music ? s.musicVolume * 0.9 : 0, t, 0.08);
    this.sfxBus.gain.setTargetAtTime(s.sfx ? s.sfxVolume : 0, t, 0.03);
  }

  /** Baja un momento la música para que se oiga una fanfarria. */
  duck(seconds: number) {
    if (!this.ctx || !this.settings.music) return;
    const t = this.ctx.currentTime;
    const v = this.settings.musicVolume * 0.9;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(v * 0.3, t + 0.15);
    g.setValueAtTime(v * 0.3, t + seconds);
    g.linearRampToValueAtTime(v, t + seconds + 0.6);
  }

  // ---------- Bloques de síntesis ----------

  private envelope(g: GainNode, start: number, vol: number, attack: number, dur: number) {
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(vol, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(dur, attack + 0.01));
  }

  private makeFilter(f: NonNullable<ToneOpts['filter']>, start: number, dur: number) {
    const ctx = this.ctx!;
    const bq = ctx.createBiquadFilter();
    bq.type = f.type;
    bq.frequency.setValueAtTime(f.freq, start);
    if (f.freqEnd) bq.frequency.exponentialRampToValueAtTime(Math.max(20, f.freqEnd), start + dur);
    if (f.q !== undefined) bq.Q.value = f.q;
    return bq;
  }

  tone(o: ToneOpts) {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = ctx.currentTime + (o.when ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, start);
    if (o.freqEnd) {
      if (o.glide === 'lin') osc.frequency.linearRampToValueAtTime(o.freqEnd, start + o.dur);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), start + o.dur);
    }
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = o.vibrato.rate;
      depth.gain.value = o.vibrato.depth;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + o.dur + 0.05);
    }
    const g = ctx.createGain();
    this.envelope(g, start, o.vol ?? 0.2, o.attack ?? 0.005, o.dur);
    let node: AudioNode = osc;
    if (o.filter) node = node.connect(this.makeFilter(o.filter, start, o.dur));
    node.connect(g).connect(o.dest ?? this.sfxBus);
    osc.start(start);
    osc.stop(start + o.dur + 0.05);
  }

  noise(o: NoiseOpts) {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = ctx.currentTime + (o.when ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const offset = Math.random() * 1.5;
    const g = ctx.createGain();
    this.envelope(g, start, o.vol ?? 0.2, o.attack ?? 0.003, o.dur);
    let node: AudioNode = src;
    if (o.filter) node = node.connect(this.makeFilter(o.filter, start, o.dur));
    node.connect(g).connect(o.dest ?? this.sfxBus);
    src.start(start, offset, o.dur + 0.1);
  }

  /** Voz de dibujo animado: diente de sierra con dos formantes (una vocal). */
  voice(o: { freq: number; freqEnd: number; dur: number; vol?: number; when?: number; formants: [number, number]; vibrato?: number }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = ctx.currentTime + (o.when ?? 0);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(o.freq, start);
    osc.frequency.exponentialRampToValueAtTime(o.freqEnd, start + o.dur);
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 6;
      depth.gain.value = o.vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + o.dur + 0.05);
    }
    const g = ctx.createGain();
    this.envelope(g, start, o.vol ?? 0.2, 0.03, o.dur);
    g.connect(this.sfxBus);
    for (const f of o.formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 6;
      osc.connect(bp).connect(g);
    }
    osc.start(start);
    osc.stop(start + o.dur + 0.05);
  }
}

export const audio = new AudioEngine();

/** Frecuencia de una nota MIDI. */
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
