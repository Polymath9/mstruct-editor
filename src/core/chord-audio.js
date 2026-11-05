export class ChordPianoPlayer {
  constructor(options = {}) {
    this.instrument = options.instrument ?? "acoustic_grand_piano";
    this.instrumentUrl = options.instrumentUrl ?? "";
    this.volume = options.volume ?? 82;
    this.context = null;
    this.piano = null;
    this.loadingPromise = null;
    this.playGeneration = 0;
    this.previewVoices = [];
    this.manualVoices = new Set();
    this.disposeGeneration = 0;
  }

  get loaded() {
    return Boolean(this.piano && !this.loadingPromise);
  }

  async load({ resume = true } = {}) {
    const generation = this.disposeGeneration;
    const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("Web Audio is unavailable.");

    if (!this.context) this.context = new AudioContextConstructor();
    if (resume) await this.context.resume();
    if (generation !== this.disposeGeneration) throw new Error("Piano loading was cancelled.");
    if (this.loaded) return;
    if (!this.loadingPromise) {
      const context = this.context;
      this.loadingPromise = (async () => {
        const { Soundfont } = await import("smplr");
        if (generation !== this.disposeGeneration) throw new Error("Piano loading was cancelled.");
        const pianoOptions = { volume: this.volume };
        if (this.instrumentUrl) pianoOptions.instrumentUrl = this.instrumentUrl;
        else pianoOptions.instrument = this.instrument;
        const piano = Soundfont(context, pianoOptions);
        this.piano = piano;
        try {
          await piano.ready;
        } catch (error) {
          piano.dispose();
          if (this.piano === piano) this.piano = null;
          throw error;
        }
      })();
    }
    const loading = this.loadingPromise;
    try { await loading; }
    finally { if (this.loadingPromise === loading) this.loadingPromise = null; }
  }

  stop() {
    this.playGeneration += 1;
    this.previewVoices.splice(0).forEach(stop => stop());
  }

  async play(midiNotes, { durationSeconds = 1.7 } = {}) {
    if (!Array.isArray(midiNotes) || midiNotes.some((note) => !Number.isInteger(note) || note < 0 || note > 127)) {
      throw new TypeError("MIDI notes must be integers from 0 to 127.");
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new TypeError("Piano duration must be a positive number of seconds.");
    }
    this.stop();
    const generation = this.playGeneration;
    await this.load();
    if (generation !== this.playGeneration) return;
    const time = this.context.currentTime + 0.025;
    this.previewVoices = midiNotes.map(note => this.piano.start({ note, velocity: 88, time, duration: durationSeconds }));
  }

  async noteOn(note, isCancelled = () => false) {
    if (!Number.isInteger(note) || note < 0 || note > 127) throw new TypeError("Invalid MIDI note.");
    const generation = this.disposeGeneration;
    await this.load();
    if (generation !== this.disposeGeneration || isCancelled()) return () => {};
    const stop = this.piano.start({ note, velocity: 88, time: this.context.currentTime });
    const release = () => { if (this.manualVoices.delete(release)) stop(); };
    this.manualVoices.add(release);
    return release;
  }

  dispose() {
    this.disposeGeneration += 1;
    this.stop();
    for (const release of this.manualVoices) release();
    this.piano?.dispose();
    this.piano = null;
    this.loadingPromise = null;
    if (this.context) void this.context.close();
    this.context = null;
  }
}
