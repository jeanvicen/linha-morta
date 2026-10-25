/**
 * Procedural sound design with the Web Audio API.
 *
 * - The AudioContext is only created/resumed from a user gesture (browser autoplay policies).
 * - Separate buses: music, ambience (rain, wind, low drone, radio) and sound effects, all under
 *   a master gain with a gentle compressor. Every level change is ramped to avoid clicks.
 * - Beds are started once and only crossfaded when screens change, so nothing plays twice.
 */
import { Emitter } from '../core/events';
import { clamp } from '../core/math';
import type { AudioSettings } from '../features/settings/settings';
import { brownNoise, crackle, distortionCurve, impulseResponse, pinkNoise, rainDrops, whiteNoise } from './synth';

export type AudioScene = 'silent' | 'loading' | 'menu' | 'chapter' | 'game';
export type AudioState = 'locked' | 'on' | 'off' | 'unavailable';
export type UiSound = 'click' | 'hover' | 'back' | 'open' | 'error' | 'success';

interface AudioEvents {
  state: AudioState;
}

interface BedLevels {
  rain: number;
  wind: number;
  drone: number;
  radio: number;
  music: number;
}

const SCENES: Record<AudioScene, BedLevels> = {
  silent: { rain: 0, wind: 0, drone: 0, radio: 0, music: 0 },
  loading: { rain: 0.12, wind: 0.2, drone: 0.18, radio: 0.55, music: 0 },
  menu: { rain: 0.7, wind: 0.42, drone: 0.22, radio: 0.025, music: 1 },
  chapter: { rain: 0.3, wind: 0.18, drone: 0.35, radio: 0, music: 0.55 },
  game: { rain: 0.85, wind: 0.5, drone: 0.26, radio: 0, music: 0.25 },
};

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const w = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

export class AudioManager extends Emitter<AudioEvents> {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private ambienceBus!: GainNode;
  private sfxBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private beds!: Record<keyof BedLevels, GainNode>;
  private windFilter!: BiquadFilterNode;
  private windWhistle!: BiquadFilterNode;
  private windGain!: GainNode;
  private radioVoice!: GainNode;
  private radioWhistle!: OscillatorNode;
  private radioWhistleGain!: GainNode;
  private radioObjectGain!: GainNode;
  private hazardGain!: GainNode;
  private noise!: { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer };
  private settings: AudioSettings;
  private scene: AudioScene = 'silent';
  private stateValue: AudioState;
  private scheduler = 0;
  private nextMetal = 0;
  private nextChord = 0;
  private nextNote = 0;
  private chordIndex = 0;
  private nextRadioEvent = 0;
  private lastHover = 0;
  private gust = 0.5;

  constructor(settings: AudioSettings) {
    super();
    this.settings = settings;
    this.stateValue = audioContextCtor() ? (settings.enabled ? 'locked' : 'off') : 'unavailable';
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get state(): AudioState {
    return this.stateValue;
  }

  get running(): boolean {
    return this.ctx?.state === 'running' && this.stateValue === 'on';
  }

  private setState(state: AudioState): void {
    if (state === this.stateValue) return;
    this.stateValue = state;
    this.emit('state', state);
  }

  /**
   * Starts or resumes audio. Must be called from a user gesture handler (click/key/touch).
   * Returns true when audio is actually running.
   */
  async unlock(): Promise<boolean> {
    if (this.stateValue === 'unavailable' || !this.settings.enabled) return false;
    try {
      if (!this.ctx) this.build();
      if (this.ctx!.state !== 'running') await this.ctx!.resume();
      if (this.ctx!.state === 'running') {
        this.applyVolumes(0.05);
        this.applyScene(1.5);
        this.setState('on');
        return true;
      }
    } catch (error) {
      console.warn('[audio] unable to start audio', error);
    }
    return false;
  }

  updateSettings(settings: AudioSettings): void {
    const wasEnabled = this.settings.enabled;
    this.settings = settings;
    if (this.stateValue === 'unavailable') return;
    if (!settings.enabled) {
      this.applyVolumes(0.15);
      this.setState('off');
      window.setTimeout(() => {
        if (!this.settings.enabled) void this.ctx?.suspend();
      }, 400);
      return;
    }
    if (!wasEnabled || this.stateValue === 'off') {
      // Re-enabling happens from a click on the toggle, so resuming here is allowed.
      if (this.ctx) void this.unlock();
      else this.setState('locked');
      return;
    }
    this.applyVolumes(0.08);
  }

  setScene(scene: AudioScene): void {
    this.scene = scene;
    this.applyScene(scene === 'loading' ? 0.6 : 1.8);
  }

  /** Wind gust factor from the visual simulation (0 – 1). */
  setGust(gust: number): void {
    this.gust = gust;
  }

  private build(): void {
    const Ctor = audioContextCtor();
    if (!Ctor) throw new Error('Web Audio indisponível');
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.noise = { white: whiteNoise(ctx, 3), pink: pinkNoise(ctx, 6), brown: brownNoise(ctx, 6) };

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.4;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(compressor).connect(ctx.destination);

    this.musicBus = this.gain(0, this.master);
    this.ambienceBus = this.gain(0, this.master);
    this.sfxBus = this.gain(0, this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulseResponse(ctx, 3.6, 2.6);
    this.reverbSend = this.gain(0.9, this.reverb);
    this.reverb.connect(this.master);

    this.beds = {
      rain: this.gain(0, this.ambienceBus),
      wind: this.gain(0, this.ambienceBus),
      drone: this.gain(0, this.ambienceBus),
      radio: this.gain(0, this.ambienceBus),
      music: this.gain(0, this.musicBus),
    };
    this.buildRain();
    this.buildWind();
    this.buildDrone();
    this.buildRadio();
    this.radioObjectGain = this.gain(0, this.sfxBus);
    this.buildRadioObject();
    this.hazardGain = this.gain(0.05, this.sfxBus);

    const now = ctx.currentTime;
    this.nextMetal = now + 9;
    this.nextChord = now + 1;
    this.nextNote = now + 5;
    this.nextRadioEvent = now + 2;
    this.scheduler = window.setInterval(() => this.schedule(), 200);
  }

  private gain(value: number, destination: AudioNode | AudioParam): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = value;
    if (destination instanceof AudioParam) g.connect(destination);
    else g.connect(destination);
    return g;
  }

  private loop(buffer: AudioBuffer, destination: AudioNode, rate = 1, offset = 0): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    src.connect(destination);
    src.start(this.ctx!.currentTime, offset % buffer.duration);
    return src;
  }

  private filter(type: BiquadFilterType, frequency: number, q = 0.707): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  }

  private buildRain(): void {
    const ctx = this.ctx!;
    const hiss = this.filter('highpass', 500);
    const hissLp = this.filter('lowpass', 8500);
    this.loop(this.noise.pink, hiss);
    hiss.connect(hissLp).connect(this.gain(0.42, this.beds.rain));
    const rumble = this.filter('lowpass', 520);
    this.loop(this.noise.brown, rumble, 1, 1.3);
    rumble.connect(this.gain(0.38, this.beds.rain));
    const drops = rainDrops(ctx, 5, 900, false, 41);
    const dropsHp = this.filter('highpass', 900);
    this.loop(drops, dropsHp, 1, 0);
    this.loop(rainDrops(ctx, 5.7, 700, false, 42), dropsHp, 0.93, 2.1);
    dropsHp.connect(this.gain(0.55, this.beds.rain));
    // Drops on the car roof and on leaves: sparse metallic pings.
    const pings = this.filter('bandpass', 2600, 0.6);
    this.loop(rainDrops(ctx, 7, 26, true, 43), pings);
    pings.connect(this.gain(0.12, this.beds.rain));
  }

  private buildWind(): void {
    this.windFilter = this.filter('bandpass', 420, 0.6);
    this.loop(this.noise.white, this.windFilter, 0.5);
    this.windGain = this.gain(0.35, this.beds.wind);
    this.windFilter.connect(this.windGain);
    // Leaves rustling / whistle through the trees during gusts.
    this.windWhistle = this.filter('bandpass', 1600, 4);
    this.loop(this.noise.pink, this.windWhistle, 1, 2.2);
    this.windWhistle.connect(this.gain(0.08, this.beds.wind));
    const rustle = this.filter('highpass', 3200);
    this.loop(this.noise.white, rustle, 1, 1.1);
    rustle.connect(this.gain(0.035, this.beds.wind));
  }

  private buildDrone(): void {
    const ctx = this.ctx!;
    const lp = this.filter('lowpass', 180);
    const swell = this.gain(0.5, this.beds.drone);
    lp.connect(swell);
    for (const [f, detune] of [
      [43.65, -6],
      [65.4, 5],
      [87.3, -3],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(this.gain(0.18, lp));
      o.start();
    }
    const n = this.filter('lowpass', 90);
    this.loop(this.noise.brown, n, 0.6, 3.1);
    n.connect(this.gain(0.6, lp));
    // Very slow breathing of the low end.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.035;
    const depth = this.gain(0.35, swell.gain);
    lfo.connect(depth);
    lfo.start();
  }

  private buildRadio(): void {
    const ctx = this.ctx!;
    const band = this.filter('bandpass', 1700, 0.9);
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(6);
    const out = this.gain(0.55, this.beds.radio);
    band.connect(shaper).connect(out);
    this.loop(this.noise.white, band, 1, 0.5);
    const crackleBand = this.filter('highpass', 900);
    this.loop(crackle(ctx, 6), crackleBand);
    crackleBand.connect(this.gain(0.55, this.beds.radio));
    // Syllabic murmur: band-limited noise with a speech-like amplitude envelope (no words).
    const voiceBand = this.filter('bandpass', 900, 1.4);
    this.loop(this.noise.pink, voiceBand, 1, 4.2);
    this.radioVoice = this.gain(0, this.beds.radio);
    voiceBand.connect(this.radioVoice);
    // Tuning whistle.
    this.radioWhistle = ctx.createOscillator();
    this.radioWhistle.type = 'sine';
    this.radioWhistle.frequency.value = 900;
    this.radioWhistleGain = this.gain(0, this.beds.radio);
    this.radioWhistle.connect(this.radioWhistleGain);
    this.radioWhistle.start();
  }

  /** The car radio heard in the prologue (positionless, level driven by the game). */
  private buildRadioObject(): void {
    const band = this.filter('bandpass', 1500, 1.1);
    const shaper = this.ctx!.createWaveShaper();
    shaper.curve = distortionCurve(4);
    this.loop(this.noise.white, band, 1, 1.7);
    band.connect(shaper).connect(this.gain(0.4, this.radioObjectGain));
    const c = this.filter('highpass', 1200);
    this.loop(crackle(this.ctx!, 4.3, 9), c);
    c.connect(this.gain(0.5, this.radioObjectGain));
  }

  private applyVolumes(time: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.settings;
    const on = s.enabled ? 1 : 0;
    this.master.gain.setTargetAtTime(s.master * on * 0.9, t, time);
    this.musicBus.gain.setTargetAtTime(s.music * 0.5, t, time);
    this.ambienceBus.gain.setTargetAtTime(s.ambience * 0.8, t, time);
    this.sfxBus.gain.setTargetAtTime(s.sfx, t, time);
  }

  private applyScene(time: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const levels = SCENES[this.scene];
    for (const key of Object.keys(levels) as (keyof BedLevels)[]) this.beds[key].gain.setTargetAtTime(levels[key], t, time);
  }

  /** Lookahead scheduler for sporadic events (metal, music, radio). */
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Wind follows the visual gusts.
    this.windFilter.frequency.setTargetAtTime(280 + this.gust * 520, now, 0.8);
    this.windGain.gain.setTargetAtTime(0.18 + this.gust * 0.5, now, 0.8);
    this.windWhistle.frequency.setTargetAtTime(1200 + this.gust * 900, now, 1.2);

    const levels = SCENES[this.scene];
    if ((levels.rain > 0 || this.scene === 'game') && now > this.nextMetal) {
      this.metal(now + Math.random() * 0.15);
      this.nextMetal = now + 18 + Math.random() * 30;
    }
    if (levels.music > 0 && now > this.nextChord - 0.3) this.playChord(Math.max(now, this.nextChord));
    if (levels.music > 0 && now > this.nextNote - 0.3) this.playNote(Math.max(now, this.nextNote));
    if (levels.radio > 0 && now > this.nextRadioEvent) this.radioEvent(now);
  }

  private radioEvent(now: number): void {
    const voice = this.radioVoice.gain;
    voice.cancelScheduledValues(now);
    const syllables = 6 + Math.floor(Math.random() * 10);
    let t = now;
    for (let i = 0; i < syllables; i++) {
      const len = 0.08 + Math.random() * 0.18;
      voice.setTargetAtTime(0.12 + Math.random() * 0.25, t, 0.02);
      voice.setTargetAtTime(0.0, t + len, 0.04);
      t += len + Math.random() * 0.12;
    }
    const w = this.radioWhistleGain.gain;
    if (Math.random() < 0.6) {
      const f = this.radioWhistle.frequency;
      f.setValueAtTime(400 + Math.random() * 600, now);
      f.exponentialRampToValueAtTime(900 + Math.random() * 2200, now + 0.9 + Math.random());
      w.setTargetAtTime(0.03, now, 0.05);
      w.setTargetAtTime(0, now + 1.2, 0.2);
    }
    this.nextRadioEvent = t + 1.2 + Math.random() * 3;
  }

  /** Distant metallic resonance (structure creaking far away). */
  private metal(at: number): void {
    const ctx = this.ctx!;
    const base = 140 + Math.random() * 260;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const lp = this.filter('lowpass', 1400);
    const out = this.gain(0, pan);
    pan.connect(this.sfxBus);
    pan.connect(this.reverbSend);
    lp.connect(out);
    const level = 0.05 + Math.random() * 0.05;
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(level, at + 0.02);
    out.gain.exponentialRampToValueAtTime(0.0001, at + 5);
    for (const ratio of [1, 2.76, 5.4, 8.93]) {
      const o = ctx.createOscillator();
      o.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.01);
      const g = this.gain(1 / ratio, lp);
      o.connect(g);
      o.start(at);
      o.stop(at + 5.2);
    }
  }

  private static readonly CHORDS: number[][] = [
    [146.83, 174.61, 220.0],
    [116.54, 146.83, 174.61],
    [98.0, 116.54, 146.83],
    [110.0, 138.59, 164.81],
  ];

  private playChord(at: number): void {
    const ctx = this.ctx!;
    const chord = AudioManager.CHORDS[this.chordIndex % AudioManager.CHORDS.length]!;
    this.chordIndex++;
    const dur = 13;
    const lp = this.filter('lowpass', 700);
    const env = this.gain(0, this.beds.music);
    lp.connect(env);
    env.connect(this.reverbSend);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(0.09, at + 4.5);
    env.gain.setValueAtTime(0.09, at + dur - 5);
    env.gain.linearRampToValueAtTime(0, at + dur + 1);
    for (const f of chord) {
      for (const detune of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = detune;
        o.connect(this.gain(0.11, lp));
        o.start(at);
        o.stop(at + dur + 1.2);
      }
    }
    this.nextChord = at + dur - 2;
  }

  private playNote(at: number): void {
    const ctx = this.ctx!;
    const scale = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33];
    const f = scale[Math.floor(Math.random() * scale.length)]!;
    const env = this.gain(0, this.beds.music);
    env.connect(this.reverbSend);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(0.05, at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 3.5);
    for (const [mult, amp] of [
      [1, 1],
      [2, 0.3],
      [3, 0.12],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = mult === 1 ? 'triangle' : 'sine';
      o.frequency.value = f * mult;
      o.connect(this.gain(amp, env));
      o.start(at);
      o.stop(at + 3.6);
    }
    this.nextNote = at + 5 + Math.random() * 7;
  }

  /** Thunder after a lightning flash (delay = distance). */
  thunder(intensity: number, delaySeconds: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const at = ctx.currentTime + delaySeconds;
    const close = delaySeconds < 2;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.brown;
    src.playbackRate.value = 0.7;
    const lp = this.filter('lowpass', close ? 900 : 380);
    lp.frequency.setValueAtTime(close ? 900 : 380, at);
    lp.frequency.exponentialRampToValueAtTime(110, at + 5);
    const out = this.gain(0, this.sfxBus);
    out.connect(this.reverbSend);
    src.connect(lp).connect(out);
    const level = clamp(intensity, 0, 1) * (close ? 0.85 : 0.6);
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(level, at + (close ? 0.05 : 0.6));
    out.gain.setTargetAtTime(level * 0.5, at + 0.8, 0.6);
    out.gain.setTargetAtTime(0, at + 2.2, 1.6);
    src.start(at, Math.random() * 3);
    src.stop(at + 9);
    if (close) {
      const crack = ctx.createBufferSource();
      crack.buffer = this.noise.white;
      const hp = this.filter('highpass', 1800);
      const g = this.gain(0, this.sfxBus);
      crack.connect(hp).connect(g);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level * 0.25, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      crack.start(at);
      crack.stop(at + 0.6);
    }
  }

  /** Hazard light relay (tick-tock). */
  hazardTick(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.scene === 'loading' || this.scene === 'silent') return;
    const at = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.white;
    const bp = this.filter('bandpass', on ? 2600 : 1900, 3);
    const g = this.gain(0, this.hazardGain);
    src.connect(bp).connect(g);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(on ? 0.5 : 0.32, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
    src.start(at, Math.random());
    src.stop(at + 0.05);
  }

  /** Hazard relay loudness (e.g. louder when the player stands next to the car). */
  setHazardLevel(level: number): void {
    if (!this.ctx) return;
    this.hazardGain.gain.setTargetAtTime(clamp(level, 0, 1) * 0.25, this.ctx.currentTime, 0.2);
  }

  /** Level of the car radio in the prologue (0 = off). */
  setRadioObject(level: number): void {
    if (!this.ctx) return;
    this.radioObjectGain.gain.setTargetAtTime(clamp(level, 0, 1) * 0.6, this.ctx.currentTime, 0.15);
  }

  ui(kind: UiSound): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const at = ctx.currentTime;
    if (kind === 'hover') {
      if (at - this.lastHover < 0.06) return;
      this.lastHover = at;
    }
    const tone = (f0: number, f1: number, dur: number, level: number, when = at, type: OscillatorType = 'sine'): void => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, when);
      o.frequency.exponentialRampToValueAtTime(f1, when + dur);
      const g = this.gain(0, this.sfxBus);
      o.connect(g);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(level, when + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.start(when);
      o.stop(when + dur + 0.02);
    };
    switch (kind) {
      case 'hover':
        tone(2400, 2200, 0.025, 0.018);
        break;
      case 'click':
        tone(1150, 700, 0.06, 0.07);
        break;
      case 'back':
        tone(700, 420, 0.08, 0.06);
        break;
      case 'open':
        this.whoosh(0.7, 0.08);
        break;
      case 'error':
        tone(220, 180, 0.12, 0.08, at, 'triangle');
        tone(220, 170, 0.14, 0.08, at + 0.14, 'triangle');
        break;
      case 'success':
        tone(660, 660, 0.18, 0.05);
        tone(990, 990, 0.3, 0.05, at + 0.12);
        break;
    }
  }

  /** Filtered noise sweep for transitions. */
  whoosh(duration = 1.4, level = 0.16): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const at = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.pink;
    const bp = this.filter('bandpass', 300, 1.2);
    bp.frequency.setValueAtTime(260, at);
    bp.frequency.exponentialRampToValueAtTime(1800, at + duration * 0.55);
    bp.frequency.exponentialRampToValueAtTime(380, at + duration);
    const g = this.gain(0, this.sfxBus);
    g.connect(this.reverbSend);
    src.connect(bp).connect(g);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + duration * 0.5);
    g.gain.linearRampToValueAtTime(0, at + duration);
    src.start(at, Math.random() * 2);
    src.stop(at + duration + 0.05);
  }

  /** Footstep on wet asphalt / gravel / grass (prologue). */
  footstep(surface: 'asphalt' | 'gravel' | 'grass', intensity = 1): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const at = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.white;
    const freq = surface === 'asphalt' ? 900 : surface === 'gravel' ? 2400 : 1400;
    const bp = this.filter('bandpass', freq * (0.85 + Math.random() * 0.3), surface === 'gravel' ? 0.6 : 1.2);
    const g = this.gain(0, this.sfxBus);
    src.connect(bp).connect(g);
    const level = (surface === 'grass' ? 0.08 : 0.13) * intensity;
    const dur = surface === 'gravel' ? 0.16 : surface === 'grass' ? 0.2 : 0.11;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.start(at, Math.random() * 2);
    src.stop(at + dur + 0.02);
    if (surface === 'asphalt') {
      // Wet splash.
      const s2 = ctx.createBufferSource();
      s2.buffer = this.noise.pink;
      const hp = this.filter('highpass', 2500);
      const g2 = this.gain(0, this.sfxBus);
      s2.connect(hp).connect(g2);
      g2.gain.setValueAtTime(0, at + 0.02);
      g2.gain.linearRampToValueAtTime(level * 0.5, at + 0.03);
      g2.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      s2.start(at + 0.02, Math.random() * 3);
      s2.stop(at + 0.25);
    }
  }

  /** Simple mechanical sound for interactions (car door, glovebox, radio switch). */
  thunk(kind: 'door' | 'switch' | 'pickup'): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const at = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.brown;
    const lp = this.filter('lowpass', kind === 'door' ? 500 : kind === 'switch' ? 3000 : 1600);
    const g = this.gain(0, this.sfxBus);
    src.connect(lp).connect(g);
    const level = kind === 'door' ? 0.6 : 0.25;
    const dur = kind === 'door' ? 0.35 : 0.08;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.start(at, Math.random() * 2);
    src.stop(at + dur + 0.05);
  }

  private onVisibility = (): void => {
    if (!this.ctx) return;
    if (document.hidden) void this.ctx.suspend();
    else if (this.settings.enabled && this.stateValue === 'on') void this.ctx.resume();
  };

  dispose(): void {
    window.clearInterval(this.scheduler);
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.ctx?.close();
  }
}
