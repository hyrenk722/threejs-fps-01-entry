// PORTFALL audio: every sound is synthesised with WebAudio — no audio files,
// no network. Gunshots are filtered noise bursts, beeps are oscillators, the
// round stinger is two detuned saws. Created lazily on the first user gesture;
// every call is a no-op until then, so headless captures stay silent-safe.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function noise(dur, filterType, freq, gain, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, type, gain, slideTo = null, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  const SHOT_GAIN = { hook: 0.1, p9: 0.5, mule: 0.7, sparrow: 0.42, breakwater: 0.85, kestrel: 0.55, gullwing: 0.7, harpoon: 0.9 };
  const SHOT_FREQ = { hook: 800, p9: 1800, mule: 1200, sparrow: 2200, breakwater: 900, kestrel: 1600, gullwing: 1400, harpoon: 1000 };

  return {
    unlock() {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    shot(weaponId, distant = false) {
      const g = (SHOT_GAIN[weaponId] ?? 0.5) * (distant ? 0.35 : 1);
      noise(weaponId === 'breakwater' ? 0.22 : 0.12, 'lowpass', SHOT_FREQ[weaponId] ?? 1600, g);
      if (weaponId === 'harpoon' || weaponId === 'gullwing') noise(0.3, 'bandpass', 500, g * 0.5, 0.05);
    },
    dryFire() {
      tone(1400, 0.03, 'square', 0.12);
    },
    reload() {
      tone(900, 0.04, 'square', 0.1);
      tone(700, 0.04, 'square', 0.1, null, 0.12);
    },
    hitTick(headshot) {
      tone(headshot ? 2400 : 1700, 0.06, 'sine', 0.22);
    },
    killChime() {
      tone(880, 0.09, 'sine', 0.2);
      tone(1320, 0.12, 'sine', 0.18, null, 0.07);
    },
    hurt() {
      noise(0.12, 'lowpass', 300, 0.4);
    },
    footstep(run) {
      noise(0.05, 'lowpass', 420, run ? 0.1 : 0.05);
    },
    buyClick() {
      tone(1200, 0.05, 'square', 0.14);
    },
    denied() {
      tone(220, 0.12, 'square', 0.16);
    },
    chargeBeep(fuseLeft) {
      // beeps accelerate as the fuse runs down
      tone(fuseLeft < 10 ? 1800 : 1200, 0.07, 'square', 0.2);
    },
    armTick() {
      tone(1000, 0.05, 'square', 0.12);
    },
    roundStart() {
      tone(523, 0.12, 'triangle', 0.2);
      tone(784, 0.18, 'triangle', 0.2, null, 0.12);
    },
    roundWin() {
      tone(523, 0.14, 'triangle', 0.22);
      tone(659, 0.14, 'triangle', 0.22, null, 0.13);
      tone(784, 0.26, 'triangle', 0.24, null, 0.26);
    },
    roundLose() {
      tone(392, 0.16, 'triangle', 0.2);
      tone(330, 0.28, 'triangle', 0.2, null, 0.15);
    },
    explosion() {
      noise(1.1, 'lowpass', 220, 0.9);
      tone(60, 0.9, 'sine', 0.5, 30);
    },
    pickup() {
      tone(660, 0.06, 'sine', 0.16);
      tone(990, 0.08, 'sine', 0.16, null, 0.06);
    },
  };
}
