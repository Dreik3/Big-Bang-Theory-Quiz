class BackgroundMusic {
  constructor() {
    this.context = null;
    this.buffers = new Map();
    this.track = null;
    this.scene = "menu";
    this.enabled = true;
  }

  async start() {
    this.context ??= new AudioContext();
    await this.context.resume();
    this.update();
  }

  setScene(scene) {
    this.scene = scene;
    this.update();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.update();
  }

  pause() {
    if (!this.track) return;
    const { source, gain } = this.track;
    const now = this.context.currentTime;
    gain.gain.cancelAndHoldAtTime(now);
    gain.gain.linearRampToValueAtTime(0, now + 0.6);
    source.stop(now + 0.6);
    this.track = null;
  }

  update() {
    if (!this.context || this.context.state !== "running") return;
    if (!this.enabled || document.hidden) {
      this.pause();
      return;
    }
    if (this.track?.scene === this.scene) return;
    this.pause();
    if (!this.buffers.has(this.scene)) {
      this.buffers.set(this.scene, this.compose(this.scene));
    }
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.buffers.get(this.scene);
    source.loop = true;
    source.connect(gain);
    gain.connect(this.context.destination);
    const now = this.context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(this.scene === "menu" ? 0.06 : 0.09, now + 1.2);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start();
    this.track = { source, gain, scene: this.scene };
  }

  compose(scene) {
    // Original, softly voiced loops: major-seventh ambience and a minor-key pulse.
    const dramatic = scene === "game";
    const beat = 60 / (dramatic ? 96 : 68);
    const bar = beat * 4;
    const sampleRate = this.context.sampleRate;
    const buffer = this.context.createBuffer(1, Math.ceil(bar * 8 * sampleRate), sampleRate);
    const samples = buffer.getChannelData(0);
    const chords = dramatic
      ? [[45, 52, 57, 60], [41, 48, 53, 57], [48, 55, 60, 64], [40, 47, 56, 59]]
      : [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 55, 59]];
    const note = (pitch, start, duration, volume, attack, pluck = false) => {
      const frequency = 440 * 2 ** ((pitch - 69) / 12);
      const offset = Math.round(start * sampleRate);
      const length = Math.ceil(duration * sampleRate);
      for (let i = 0; i < length; i += 1) {
        const time = i / sampleRate;
        const release = Math.min(0.7, duration / 3);
        const envelope = Math.max(0, Math.min(1, time / attack, (duration - time) / release));
        const phase = 2 * Math.PI * frequency * time;
        const tone = Math.sin(phase) + 0.18 * Math.sin(phase * 2) + 0.05 * Math.sin(phase * 3);
        const decay = pluck ? Math.exp(-time * 3) : 1;
        // Wrap release tails into the beginning for a seamless loop.
        samples[(offset + i) % samples.length] += tone * envelope * decay * volume;
      }
    };
    for (let measure = 0; measure < 8; measure += 1) {
      const chord = chords[measure % chords.length];
      const start = measure * bar;
      chord.forEach((pitch) => note(pitch, start, bar + 0.5, 0.075, 0.8));
      if (dramatic) {
        for (let step = 0; step < 8; step += 1) {
          note(chord[[0, 1, 2, 1, 0, 1, 3, 2][step]] + 12,
            start + step * beat / 2, beat * 0.9, 0.085, 0.025, true);
        }
        for (let step = 0; step < 4; step += 1) {
          note(chord[0] - 12, start + step * beat, beat * 0.8, 0.15, 0.035, true);
        }
      } else {
        [2, 3, 1].forEach((index, step) => {
          note(chord[index] + 12, start + step * beat * 1.25, beat * 1.8, 0.065, 0.04, true);
        });
      }
    }
    return buffer;
  }
}
