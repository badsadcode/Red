// =============================================================================
// audio.js — Oregon Lakehouse procedural soundscape
// -----------------------------------------------------------------------------
// Every sound in the game is synthesized here with the WebAudio API. There are
// no sample files, so there is nothing to license and nothing to download.
//
// Signal flow (all gains are AudioParams that update() ramps smoothly):
//
//   one-shots ──► sfxBus ────────────────────────────┐
//                   ├─► roomSend ─► roomVerb (cabin) ─┤
//                   └─► bigSend ──► bigVerb (halls) ──┤
//   ambient events ─► evBus ─(same sends)─────────────┤
//   nature beds (rain/wind/lake/birds/crickets)       │
//        ─► natureBus ─► muffle lowpass ─► natureGain ┤
//   roof patter (inside cabin, not muffled) ──────────┤
//   underground beds (hum/vent/deep) ─► ugBus ────────┤
//   red sky choir / danger pulse ─► moodBus ──────────┤
//                                                     ▼
//                                   master ─► compressor ─► speakers
//
// Public API (see class AudioSys at the bottom of the file for details):
//   init(), setListener(pos, fwd), setEnvironment(env), update(dt),
//   play(name, opts), startLoop(name, opts), setMasterVolume(v),
//   suspend(), resume()
//
// Studio motto #001: code shall remain understandable to whichever AI inherits
// this mess. So: small helpers, every sound in its own little recipe.
// =============================================================================

const MAX_VOICES = 24;          // concurrent one-shot voices (ambient events included)
const ENV_TC = 0.45;            // time constant (s) for environment ramps
const ENV_TICK = 0.1;           // how often (s) update() pushes env ramps to the graph

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp01 = (x) => Math.max(0, Math.min(1, x || 0));
const chance = (perSecond, dt) => Math.random() < perSecond * dt;

// -----------------------------------------------------------------------------
// Buffer factories (run once at init)
// -----------------------------------------------------------------------------

function makeNoise(ctx, kind, seconds = 4) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet's economy pink filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else { // brown
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}

// Sparse decaying clicks: rain drops, stove crackle, fire pops.
// density = events per second, decay = seconds per click, amp = peak level.
function makeCrackle(ctx, seconds, density, decay, amp = 1) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const n = Math.floor(seconds * density);
  const dlen = Math.max(4, Math.floor(decay * sr));
  for (let k = 0; k < n; k++) {
    const start = Math.floor(Math.random() * len);
    const a = amp * Math.pow(Math.random(), 2.2);          // mostly small, a few loud
    const dl = Math.floor(dlen * rand(0.4, 1.6));
    for (let i = 0; i < dl; i++) {
      const idx = (start + i) % len;                       // wrap so the loop is seamless
      d[idx] += a * (Math.random() * 2 - 1) * Math.exp(-5 * i / dl);
    }
  }
  return buf;
}

// Stereo impulse response: decaying noise that darkens over time.
function makeIR(ctx, seconds, decayPow, darken) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decayPow);
      // one-pole lowpass whose coefficient grows over time = tail gets darker
      const k = 1 - Math.min(0.97, darken * t);
      lp += k * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * env;
    }
    // tiny pre-delay gap for a sense of size
    const gap = Math.floor(sr * 0.012 * seconds);
    for (let i = 0; i < Math.min(gap, len); i++) d[i] *= i / gap;
  }
  return buf;
}

function makeDistortion(amount = 30) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// =============================================================================
// AudioSys
// =============================================================================
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.env = {
      outdoor: 1, rain: 0, wind: 0.3, night: 0, inside: 0, underground: 0,
      stove: 0, lake: 0, hum: 0, deep: 0, redsky: 0, danger: 0,
    };
    this._lp = { x: 0, y: 0, z: 0 };   // listener position
    this._voices = 0;
    this._envTimer = 0;
    this._gustTimer = 0;
    this._loops = new Set();
    this._warned = new Set();
    this._masterVol = 1;
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();

    // --- shared buffers
    this.noise = { white: makeNoise(c, 'white'), pink: makeNoise(c, 'pink'), brown: makeNoise(c, 'brown') };
    this.buf = {
      drops: makeCrackle(c, 4, 70, 0.003, 0.9),     // rain drop ticks
      patter: makeCrackle(c, 4, 45, 0.012, 1.0),    // drops on the roof (gets lowpassed)
      crackle: makeCrackle(c, 5, 9, 0.008, 1.0),    // wood stove / fire pops
      embers: makeCrackle(c, 5, 60, 0.002, 0.25),   // fine sizzle under the pops
    };
    this.distCurve = makeDistortion(60);

    // --- master chain
    this.master = c.createGain(); this.master.gain.value = this._masterVol;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4;
    comp.attack.value = 0.005; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(c.destination);

    // --- reverbs
    this.roomVerb = c.createConvolver(); this.roomVerb.buffer = makeIR(c, 0.9, 3, 0.6);
    this.bigVerb = c.createConvolver(); this.bigVerb.buffer = makeIR(c, 7, 2.2, 0.9);
    const roomRet = c.createGain(); roomRet.gain.value = 0.8;
    const bigRet = c.createGain(); bigRet.gain.value = 0.9;
    this.roomVerb.connect(roomRet); roomRet.connect(this.master);
    this.bigVerb.connect(bigRet); bigRet.connect(this.master);

    // --- buses
    this.sfxBus = c.createGain(); this.sfxBus.connect(this.master);
    this.evBus = c.createGain(); this.evBus.connect(this.master);
    this.roomSend = c.createGain(); this.roomSend.gain.value = 0;
    this.bigSend = c.createGain(); this.bigSend.gain.value = 0;
    this.roomSend.connect(this.roomVerb); this.bigSend.connect(this.bigVerb);
    for (const b of [this.sfxBus, this.evBus]) { b.connect(this.roomSend); b.connect(this.bigSend); }

    this.natureBus = c.createGain();
    this.muffle = c.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 18000;
    this.natureGain = c.createGain();
    this.natureBus.connect(this.muffle); this.muffle.connect(this.natureGain); this.natureGain.connect(this.master);

    this.ugBus = c.createGain(); this.ugBus.connect(this.master);
    this.ugVerbSend = c.createGain(); this.ugVerbSend.gain.value = 0.25;
    this.ugBus.connect(this.ugVerbSend); this.ugVerbSend.connect(this.bigVerb);
    this.moodBus = c.createGain(); this.moodBus.connect(this.master);

    this._buildBeds();
    this._applyEnv(true);
    if (c.state === 'suspended') { try { await c.resume(); } catch (e) { /* needs gesture */ } }
  }

  // Looping noise source with a random start offset.
  _loopSrc(buf, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    s.start(this.ctx.currentTime, Math.random() * buf.duration);
    return s;
  }
  _filter(type, freq, Q = 0.7) {
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q; return f;
  }
  _gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  _lfo(freq, depth, type = 'sine') {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = this._gain(depth); o.connect(g); o.start(); return g;
  }
  _const(v) { const s = this.ctx.createConstantSource(); s.offset.value = v; s.start(); return s; }
  _chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }

  // ---------------------------------------------------------------------------
  // Continuous ambient beds. Each ends in a gain (this.bed.X) at 0 that
  // _applyEnv() opens according to the environment.
  // ---------------------------------------------------------------------------
  _buildBeds() {
    const c = this.ctx, B = this.bed = {};

    // RAIN (outside): hiss + low body + drop ticks
    B.rain = this._gain();
    this._chain(this._loopSrc(this.noise.pink), this._filter('highpass', 500), this._filter('lowpass', 7500), this._gain(0.55), B.rain);
    this._chain(this._loopSrc(this.noise.brown), this._filter('lowpass', 700), this._gain(0.35), B.rain);
    this._chain(this._loopSrc(this.buf.drops), this._filter('highpass', 1800), this._gain(0.5), B.rain);
    B.rain.connect(this.natureBus);

    // ROOF PATTER (inside the cabin): thuddy drops + dull hiss, bypasses muffle
    B.roof = this._gain();
    this._chain(this._loopSrc(this.buf.patter, 0.9), this._filter('lowpass', 1400), this._filter('highpass', 120), this._gain(1.1), B.roof);
    this._chain(this._loopSrc(this.noise.pink), this._filter('bandpass', 900, 0.6), this._gain(0.18), B.roof);
    B.roof.connect(this.master);

    // WIND: brown noise through a wandering bandpass; gusts move the params
    B.wind = this._gain();
    this.windFilter = this._filter('bandpass', 500, 0.8);
    this.windGust = this._gain(0.7);
    const windLfo = this._lfo(0.07, 180);
    windLfo.connect(this.windFilter.frequency);
    this._chain(this._loopSrc(this.noise.brown), this.windFilter, this.windGust, this._gain(1.4), B.wind);
    this._chain(this._loopSrc(this.noise.pink, 0.5), this._filter('bandpass', 1600, 2), this._gain(0.05), B.wind); // leaves/needles hiss
    B.wind.connect(this.natureBus);

    // LAKE: low lapping, amplitude wobbles at two slow incommensurate rates
    B.lake = this._gain();
    const lap = this._gain(0);
    this._const(0.45).connect(lap.gain);
    this._lfo(0.23, 0.3).connect(lap.gain);
    this._lfo(0.37, 0.22).connect(lap.gain);
    this._chain(this._loopSrc(this.noise.brown), this._filter('lowpass', 480), lap, B.lake);
    this._chain(this._loopSrc(this.buf.patter, 0.5), this._filter('bandpass', 700, 1.5), this._gain(0.25), B.lake); // small slaps
    B.lake.connect(this.natureBus);

    // CRICKETS (night): 4.4 kHz tone, AM-gated twice for chirp trains
    B.crickets = this._gain();
    const cr = c.createOscillator(); cr.type = 'sine'; cr.frequency.value = 4400; cr.start();
    const g1 = this._gain(0), g2 = this._gain(0);
    this._const(0.5).connect(g1.gain); this._lfo(24, 0.5, 'square').connect(g1.gain);
    const gate = this._lfo(0.9, 0.5, 'square'); const gateLp = this._filter('lowpass', 12);
    gate.connect(gateLp); gateLp.connect(g2.gain); this._const(0.5).connect(g2.gain);
    this._chain(cr, g1, g2, this._gain(0.08), B.crickets);
    const cr2 = c.createOscillator(); cr2.type = 'sine'; cr2.frequency.value = 3900; cr2.start();
    const g3 = this._gain(0); this._const(0.5).connect(g3.gain); this._lfo(19, 0.5, 'square').connect(g3.gain);
    this._chain(cr2, g3, this._gain(0.04), B.crickets);
    B.crickets.connect(this.natureBus);

    // STOVE: pops + fine embers + soft roar
    B.stove = this._gain();
    this._chain(this._loopSrc(this.buf.crackle), this._filter('highpass', 600), this._gain(0.9), B.stove);
    this._chain(this._loopSrc(this.buf.embers), this._filter('highpass', 2500), this._gain(0.5), B.stove);
    this._chain(this._loopSrc(this.noise.brown), this._filter('lowpass', 250), this._gain(0.25), B.stove);
    B.stove.connect(this.sfxBus);

    // HUM (facility): mains hum + ventilation air
    B.hum = this._gain();
    const mains = c.createOscillator(); mains.type = 'sawtooth'; mains.frequency.value = 60; mains.start();
    this._chain(mains, this._filter('lowpass', 260, 3), this._gain(0.07), B.hum);
    for (const [f, a] of [[120, 0.05], [180, 0.025], [240, 0.012]]) {
      const o = c.createOscillator(); o.frequency.value = f; o.start(); this._chain(o, this._gain(a), B.hum);
    }
    const vent = this._gain(0.4); this._const(0.7).connect(vent.gain); this._lfo(0.11, 0.25).connect(vent.gain);
    this._chain(this._loopSrc(this.noise.pink), this._filter('bandpass', 420, 0.5), vent, B.hum);
    this._chain(this._loopSrc(this.noise.white), this._filter('bandpass', 3200, 4), this._gain(0.012), B.hum); // fluorescent buzz
    B.hum.connect(this.ugBus);

    // DEEP: two beating sub sines + a slow breathing rumble
    B.deep = this._gain();
    for (const f of [41, 42.3, 61.5]) {
      const o = c.createOscillator(); o.frequency.value = f; o.start(); this._chain(o, this._gain(f > 60 ? 0.06 : 0.16), B.deep);
    }
    const breath = this._gain(0); this._const(0.35).connect(breath.gain); this._lfo(0.05, 0.3).connect(breath.gain);
    this._chain(this._loopSrc(this.noise.brown, 0.6), this._filter('lowpass', 140, 2), breath, B.deep);
    B.deep.connect(this.ugBus);

    // RED SKY: dissonant formant "choir" with vibrato + a high glassy ring
    B.redsky = this._gain();
    const choirSum = this._gain(1);
    const vib = this._lfo(4.7, 9);                      // cents
    for (const f of [98, 103.8, 146.8, 155.6, 196, 207.6]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.detune.value = rand(-8, 8); vib.connect(o.detune); o.start();
      o.connect(choirSum);
    }
    const choirOut = this._gain(0.05);
    for (const [ff, q, a] of [[650, 6, 1], [1080, 7, 0.7], [2450, 9, 0.3]]) {
      this._chain(choirSum, this._filter('bandpass', ff, q), this._gain(a), choirOut);
    }
    const swell = this._gain(0); this._const(0.7).connect(swell.gain); this._lfo(0.13, 0.3).connect(swell.gain);
    this._chain(choirOut, swell, B.redsky);
    const ring = c.createOscillator(); ring.frequency.value = 1864; ring.start();
    const ringG = this._gain(0); this._const(0.012).connect(ringG.gain); this._lfo(0.31, 0.01).connect(ringG.gain);
    this._chain(ring, ringG, B.redsky);
    B.redsky.connect(this.moodBus);
    const redVerb = this._gain(0.6); B.redsky.connect(redVerb); redVerb.connect(this.bigVerb);

    // DANGER: low heartbeat-ish pulse (square LFO smoothed into a gain)
    B.danger = this._gain();
    const thump = c.createOscillator(); thump.frequency.value = 48; thump.start();
    const pulse = this._gain(0);
    const pl = this._lfo(1.15, 0.5, 'square'); const plLp = this._filter('lowpass', 7);
    pl.connect(plLp); plLp.connect(pulse.gain); this._const(0.5).connect(pulse.gain);
    this._chain(thump, pulse, this._gain(0.5), B.danger);
    this._chain(this._loopSrc(this.noise.brown), this._filter('lowpass', 90), this._gain(0.2), B.danger);
    B.danger.connect(this.moodBus);
  }

  // Push the current env targets into the graph.
  _applyEnv(immediate = false) {
    const c = this.ctx, e = this.env, t = c.currentTime;
    const set = (param, v) => immediate ? (param.value = v) : param.setTargetAtTime(v, t, ENV_TC);
    const ug = clamp01(e.underground);
    const out = clamp01(e.outdoor) * (1 - ug);
    const inside = clamp01(e.inside);
    const rain = clamp01(e.rain), night = clamp01(e.night);

    set(this.natureGain.gain, out);
    set(this.muffle.frequency, 18000 * Math.pow(800 / 18000, inside)); // log interpolation 18k -> 800 Hz
    set(this.bed.rain.gain, rain * (1 - inside * 0.6) * 0.8);
    set(this.bed.roof.gain, rain * inside * out * 0.9);
    set(this.bed.wind.gain, clamp01(e.wind) * (0.35 + 0.65 * (1 - inside)) * 0.9);
    set(this.bed.lake.gain, clamp01(e.lake) * 0.7);
    set(this.bed.crickets.gain, night * (1 - rain * 0.7));
    set(this.bed.stove.gain, clamp01(e.stove) * 0.5);
    set(this.bed.hum.gain, clamp01(e.hum) * 0.8);
    set(this.bed.deep.gain, clamp01(e.deep) * 0.9);
    set(this.bed.redsky.gain, clamp01(e.redsky) * 0.9);
    set(this.bed.danger.gain, clamp01(e.danger) * 0.7);
    set(this.roomSend.gain, inside * 0.3 * (1 - ug));
    set(this.bigSend.gain, Math.min(0.7, ug * 0.55 + clamp01(e.deep) * 0.2));
  }

  // ---------------------------------------------------------------------------
  // Public: listener / environment / per-frame update
  // ---------------------------------------------------------------------------
  setListener(pos, fwd) {
    if (!this.ctx || !pos) return;
    this._lp = { x: pos.x, y: pos.y, z: pos.z };
    const L = this.ctx.listener;
    const f = fwd || { x: 0, y: 0, z: -1 };
    if (L.positionX) {
      L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  setEnvironment(env) {
    if (!env) return;
    for (const k in env) if (k in this.env) this.env[k] = env[k];
  }

  update(dt) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    dt = Math.min(dt || 0, 0.25);

    this._envTimer += dt;
    if (this._envTimer >= ENV_TICK) { this._envTimer = 0; this._applyEnv(); }

    // wind gusts: wander the filter centre and level every few seconds
    this._gustTimer -= dt;
    if (this._gustTimer <= 0) {
      const t = this.ctx.currentTime, w = clamp01(this.env.wind);
      this._gustTimer = rand(1.5, 5);
      this.windGust.gain.setTargetAtTime(rand(0.35, 0.8 + w * 0.6), t, rand(0.6, 2));
      this.windFilter.frequency.setTargetAtTime(rand(280, 500 + w * 600), t, 1.5);
    }

    this._ambientEvents(dt);
    for (const l of this._loops) if (l.tick) l.tick(dt);
  }

  // Random point around the listener on a ring (metres), height jitter.
  _around(rMin, rMax, yMin = -2, yMax = 8) {
    const a = Math.random() * Math.PI * 2, r = rand(rMin, rMax), p = this._lp;
    return { x: p.x + Math.cos(a) * r, y: p.y + rand(yMin, yMax), z: p.z + Math.sin(a) * r };
  }

  _ambientEvents(dt) {
    const e = this.env;
    const ug = clamp01(e.underground);
    const out = clamp01(e.outdoor) * (1 - ug);
    const night = clamp01(e.night), rain = clamp01(e.rain), inside = clamp01(e.inside);
    const nat = out * (1 - inside * 0.7);  // how audible nature events are
    const evOpts = (r1, r2, vol) => ({ position: this._around(r1, r2), ref: 8, volume: vol * nat, bus: this.natureBus });

    if (nat > 0.05) {
      // day birds
      const day = 1 - night;
      if (day > 0.3 && chance(0.55 * day * (1 - rain * 0.75), dt)) {
        const r = Math.random();
        const o = evOpts(10, 45, 0.5);
        if (r < 0.35) this._birdTrill(o);
        else if (r < 0.6) this._birdThrush(o);
        else if (r < 0.8) this._birdFeeBee(o);
        else this._raven({ ...o, volume: 0.6 * nat, position: this._around(25, 80, 10, 30) });
      }
      // night: frogs by the lake, the odd owl
      if (night > 0.5) {
        if (chance(0.9 * night * (0.5 + clamp01(e.lake)), dt)) this._frog(evOpts(6, 30, 0.35));
        if (chance(0.025 * night, dt)) this._owl({ ...evOpts(40, 90, 0.45) });
      }
      // thunder when it pours
      if (rain > 0.6 && chance(0.012 * rain, dt)) this.play('thunder', { volume: 0.7 * out, position: this._around(200, 600, 50, 150), ref: 200, bus: this.natureBus });
    }

    if (ug > 0.2) {
      const evU = (r1, r2, vol) => ({ position: this._around(r1, r2, -6, 10), ref: 6, volume: vol * ug, bus: this.evBus });
      if (chance(0.35 * ug, dt)) this._drip(evU(4, 25, 0.35));
      if (chance(0.06 * ug, dt)) this._distantClank(evU(25, 70, 0.6));
      if (chance(0.035 * ug * clamp01(e.hum + 0.3), dt)) this._ventRattle(evU(6, 25, 0.35));
      if (chance(0.012 * ug, dt)) this._distantBoom(evU(60, 150, 0.6));
    }
    if (e.deep > 0.2 && chance(0.05 * e.deep, dt)) this._stoneGroan({ position: this._around(20, 60, -10, 5), ref: 10, volume: 0.6 * e.deep, bus: this.evBus });
  }

  // ---------------------------------------------------------------------------
  // Voice + primitive helpers for one-shots
  // ---------------------------------------------------------------------------
  _panner(p, ref = 2) {
    const pn = new PannerNode(this.ctx, {
      panningModel: 'HRTF', distanceModel: 'inverse',
      refDistance: ref, maxDistance: 1000, rolloffFactor: 1,
      positionX: p.x, positionY: p.y, positionZ: p.z,
    });
    return pn;
  }

  // Allocate a voice: gain (+ optional panner) into a bus; auto-cleanup after dur.
  _voice(opts = {}, dur = 1, force = false) {
    const c = this.ctx;
    if (!c || c.state === 'closed') return null;
    if (!force && this._voices >= MAX_VOICES) return null;
    this._voices++;
    const g = c.createGain(); g.gain.value = opts.volume ?? 1;
    let tail = g;
    if (opts.position) { tail = this._panner(opts.position, opts.ref ?? 2); g.connect(tail); }
    tail.connect(opts.bus || this.sfxBus);
    setTimeout(() => {
      this._voices--;
      try { g.disconnect(); if (tail !== g) tail.disconnect(); } catch (e) { /* already gone */ }
    }, (dur + 0.6) * 1000);
    return { c, t: c.currentTime + 0.005, dst: g, rate: opts.rate ?? 1 };
  }

  // Envelope on a gain param: attack to peak, optional hold, exponential decay.
  _env(param, t0, a, hold, dur, peak) {
    const end = t0 + Math.max(dur, a + hold + 0.01);
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(peak, t0 + a);
    if (hold > 0) param.setValueAtTime(peak, t0 + a + hold);
    param.exponentialRampToValueAtTime(0.0001, end);
    return end;
  }

  // Apply a frequency path: [[dt, f], ...] exponential ramps from start.
  _path(param, t0, f0, fp) {
    param.setValueAtTime(f0, t0);
    if (fp) for (const [dt, f] of fp) param.exponentialRampToValueAtTime(Math.max(1, f), t0 + dt);
  }

  // Noise burst. o: type, t, dur, a, hold, peak, f/ftype/Q/fp (filter), hp, lp, rate, to
  _nz(v, o = {}) {
    const c = v.c, t0 = v.t + (o.t || 0), dur = o.dur ?? 0.2;
    const s = c.createBufferSource();
    s.buffer = o.buf || this.noise[o.type || 'white'];
    s.loop = true; s.playbackRate.value = (o.rate ?? 1) * v.rate;
    let node = s;
    if (o.f) {
      const fl = c.createBiquadFilter(); fl.type = o.ftype || 'bandpass'; fl.Q.value = o.Q ?? 1;
      this._path(fl.frequency, t0, o.f, o.fp); node.connect(fl); node = fl;
    }
    if (o.hp) { const fl = this._filter('highpass', o.hp); node.connect(fl); node = fl; }
    if (o.lp) { const fl = this._filter('lowpass', o.lp); node.connect(fl); node = fl; }
    const g = c.createGain();
    const end = this._env(g.gain, t0, o.a ?? 0.004, o.hold ?? 0, dur, o.peak ?? 0.8);
    node.connect(g); g.connect(o.to || v.dst);
    s.start(t0, Math.random() * (s.buffer.duration - 0.5)); s.stop(end + 0.05);
    return g;
  }

  // Oscillator note. o: type, f, fp, t, dur, a, hold, peak, ff/ftype/Q (filter), detune, to
  _osc(v, o = {}) {
    const c = v.c, t0 = v.t + (o.t || 0), dur = o.dur ?? 0.3;
    const os = c.createOscillator(); os.type = o.type || 'sine';
    const r = v.rate;
    this._path(os.frequency, t0, (o.f ?? 440) * r, o.fp && o.fp.map(([dt, f]) => [dt, f * r]));
    if (o.detune) os.detune.value = o.detune;
    let node = os;
    if (o.ff) {
      const fl = c.createBiquadFilter(); fl.type = o.ftype || 'lowpass'; fl.Q.value = o.Q ?? 1;
      this._path(fl.frequency, t0, o.ff, o.ffp); node.connect(fl); node = fl;
    }
    const g = c.createGain();
    const end = this._env(g.gain, t0, o.a ?? 0.004, o.hold ?? 0, dur, o.peak ?? 0.4);
    node.connect(g); g.connect(o.to || v.dst);
    os.start(t0); os.stop(end + 0.05);
    return { os, g };
  }

  // Inharmonic metallic partials (bells, clangs, struck pipes).
  _clang(v, freqs, dur, peak, t = 0) {
    freqs.forEach((f, i) => this._osc(v, { f: f * rand(0.98, 1.02), t, dur: dur * rand(0.6, 1) / (1 + i * 0.25), peak: peak / (1 + i * 0.6), a: 0.002 }));
  }

  // ---------------------------------------------------------------------------
  // play(): one-shot recipes
  // ---------------------------------------------------------------------------
  play(name, opts = {}) {
    if (!this.ctx) return false;
    const fn = this._recipes()[name];
    if (!fn) {
      if (!this._warned.has(name)) { this._warned.add(name); console.warn('[audio] unknown sound:', name); }
      return false;
    }
    try { fn(opts); return true; } catch (err) { console.warn('[audio] failed', name, err); return false; }
  }

  // Built lazily once; each recipe is opts => void.
  _recipes() {
    if (this._rec) return this._rec;
    const V = (o, d, force) => this._voice(o, d, force);
    const nz = (v, o) => this._nz(v, o), osc = (v, o) => this._osc(v, o);
    const R = {};

    // --- footsteps (each call randomizes rate/filter so no two steps match)
    R.step_dirt = (o) => { const v = V(o, 0.25); if (!v) return; const r = rand(0.85, 1.15);
      nz(v, { type: 'brown', dur: 0.14, f: 500 * r, ftype: 'lowpass', peak: 0.9 });
      nz(v, { type: 'pink', dur: 0.09, f: 1400 * r, Q: 1.2, peak: 0.25, t: 0.01 }); };
    R.step_grass = (o) => { const v = V(o, 0.3); if (!v) return; const r = rand(0.8, 1.2);
      nz(v, { type: 'pink', dur: 0.18, a: 0.03, f: 3200 * r, Q: 0.6, peak: 0.35 });
      nz(v, { type: 'brown', dur: 0.08, f: 300, ftype: 'lowpass', peak: 0.4 }); };
    R.step_wood = (o) => { const v = V(o, 0.3); if (!v) return; const r = rand(0.9, 1.1);
      osc(v, { type: 'triangle', f: 115 * r, fp: [[0.09, 70]], dur: 0.12, peak: 0.5 });
      nz(v, { dur: 0.07, f: 820 * r, Q: 4, peak: 0.35 });
      if (Math.random() < 0.25) osc(v, { type: 'sawtooth', f: 240 * r, fp: [[0.2, 210]], ff: 900, Q: 5, t: 0.04, a: 0.03, dur: 0.22, peak: 0.04 }); }; // creak
    R.step_metal = (o) => { const v = V(o, 0.5); if (!v) return; const r = rand(0.9, 1.12);
      nz(v, { dur: 0.05, f: 2600 * r, Q: 6, peak: 0.5 });
      nz(v, { type: 'brown', dur: 0.08, f: 250, ftype: 'lowpass', peak: 0.5 });
      this._clang(v, [610 * r, 1530 * r, 2390 * r], 0.35, 0.08); };
    R.step_concrete = (o) => { const v = V(o, 0.2); if (!v) return; const r = rand(0.85, 1.15);
      nz(v, { dur: 0.05, f: 1900 * r, Q: 1, peak: 0.45 });
      nz(v, { type: 'brown', dur: 0.07, f: 200, ftype: 'lowpass', peak: 0.6 }); };
    R.step_water = (o) => { const v = V(o, 0.45); if (!v) return; const r = rand(0.85, 1.15);
      nz(v, { type: 'pink', dur: 0.3, a: 0.01, f: 1100 * r, fp: [[0.3, 450]], Q: 1.5, peak: 0.6 });
      osc(v, { f: 500 * r, fp: [[0.06, 1300 * r]], t: 0.04, dur: 0.07, peak: 0.08 }); };
    R.step_stone = (o) => { const v = V(o, 0.2); if (!v) return; const r = rand(0.85, 1.2);
      nz(v, { dur: 0.04, f: 3000 * r, Q: 1.5, peak: 0.4 });
      nz(v, { type: 'brown', dur: 0.06, f: 300, ftype: 'lowpass', peak: 0.5 }); };
    R.jump_land = (o) => { const v = V(o, 0.4); if (!v) return;
      nz(v, { type: 'brown', dur: 0.25, f: 260, ftype: 'lowpass', peak: 1.2 });
      nz(v, { type: 'pink', dur: 0.1, f: 1300, Q: 1, peak: 0.3 }); };

    // --- axe
    R.axe_swing = (o) => { const v = V(o, 0.45); if (!v) return;
      nz(v, { type: 'pink', dur: 0.32, a: 0.12, f: 400, fp: [[0.14, 2200], [0.32, 500]], Q: 2.5, peak: 0.5 }); };
    R.axe_hit_wood = (o) => { const v = V(o, 0.4); if (!v) return;
      osc(v, { type: 'triangle', f: 190, fp: [[0.15, 85]], dur: 0.18, peak: 0.7 });
      nz(v, { dur: 0.1, f: 1150, Q: 2, peak: 0.6 });
      nz(v, { type: 'brown', dur: 0.12, f: 400, ftype: 'lowpass', peak: 0.7 }); };
    R.axe_hit_metal = (o) => { const v = V(o, 1.6); if (!v) return;
      nz(v, { dur: 0.03, hp: 2000, peak: 0.9 });
      this._clang(v, [523, 1347, 2213, 3187, 4410], 1.4, 0.35); };
    R.axe_hit_flesh = (o) => { const v = V(o, 0.4); if (!v) return;
      nz(v, { type: 'brown', dur: 0.18, f: 380, ftype: 'lowpass', peak: 1 });
      nz(v, { type: 'pink', dur: 0.22, a: 0.01, f: 900, fp: [[0.2, 500]], Q: 3, peak: 0.4 }); };
    R.padlock_break = (o) => { const v = V(o, 1.6); if (!v) return;
      nz(v, { dur: 0.04, hp: 1500, peak: 1 });
      this._clang(v, [880, 2210, 3420, 5100], 0.9, 0.3);
      osc(v, { f: 3400, fp: [[0.5, 3300]], dur: 0.6, peak: 0.08, t: 0.02 });
      for (let i = 0; i < 6; i++) nz(v, { t: 0.15 + i * rand(0.06, 0.14), dur: 0.03, f: rand(2500, 4500), Q: 8, peak: 0.25 / (1 + i * 0.4) }); }; // rattle as it falls

    // --- doors
    R.door_metal_open = (o) => { const v = V(o, 3); if (!v) return;
      osc(v, { type: 'sawtooth', f: 85, fp: [[0.6, 110], [1.2, 78], [1.9, 95]], ff: 700, Q: 6, a: 0.25, hold: 1.2, dur: 2.0, peak: 0.25 });
      osc(v, { type: 'sawtooth', f: 171, fp: [[0.9, 205], [1.8, 160]], ff: 1300, Q: 9, a: 0.4, hold: 0.8, dur: 1.9, peak: 0.07 });
      nz(v, { type: 'brown', dur: 2.2, a: 0.3, hold: 1.2, f: 180, ftype: 'lowpass', peak: 0.5 });
      nz(v, { type: 'brown', t: 2.0, dur: 0.4, f: 220, ftype: 'lowpass', peak: 1.2 });
      this._clang(v, [180, 470, 830], 0.8, 0.2, 2.0); };
    R.door_slide = (o) => { const v = V(o, 1.8); if (!v) return;
      nz(v, { dur: 0.8, a: 0.01, hp: 2800, peak: 0.45 });
      nz(v, { type: 'brown', dur: 1.2, a: 0.08, hold: 0.6, f: 190, ftype: 'lowpass', peak: 0.7 });
      osc(v, { type: 'sawtooth', f: 70, fp: [[1.0, 95]], ff: 300, a: 0.1, hold: 0.5, dur: 1.1, peak: 0.12 });
      nz(v, { type: 'brown', t: 1.1, dur: 0.25, f: 250, ftype: 'lowpass', peak: 1 }); };
    R.door_wood = (o) => { const v = V(o, 1.2); if (!v) return;
      osc(v, { type: 'sawtooth', f: 190, fp: [[0.25, 240], [0.6, 170]], ff: 1200, Q: 7, a: 0.08, hold: 0.3, dur: 0.7, peak: 0.12 });
      osc(v, { type: 'triangle', f: 120, fp: [[0.1, 70]], t: 0.65, dur: 0.15, peak: 0.6 });
      nz(v, { t: 0.65, dur: 0.08, f: 700, Q: 3, peak: 0.4 }); };

    // --- fishing
    R.cast = (o) => { const v = V(o, 0.9); if (!v) return;
      nz(v, { type: 'pink', dur: 0.35, a: 0.1, f: 500, fp: [[0.15, 2500], [0.35, 700]], Q: 2, peak: 0.4 });
      osc(v, { f: 2200, fp: [[0.6, 900]], t: 0.12, a: 0.02, dur: 0.6, peak: 0.05 }); };
    R.splash = (o) => { const v = V(o, 0.7); if (!v) return;
      nz(v, { type: 'pink', dur: 0.4, a: 0.005, f: 1300, fp: [[0.4, 500]], Q: 1, peak: 0.6 });
      for (let i = 0; i < 3; i++) osc(v, { f: rand(500, 900), fp: [[0.05, rand(1200, 1900)]], t: 0.05 + i * rand(0.04, 0.1), dur: 0.06, peak: 0.06 }); };
    R.bite = (o) => { const v = V(o, 0.4); if (!v) return;
      osc(v, { f: 280, fp: [[0.07, 820]], dur: 0.09, peak: 0.35 });
      nz(v, { type: 'pink', dur: 0.15, f: 1000, Q: 1.5, peak: 0.35, t: 0.02 }); };
    R.reel_tick = (o) => { const v = V(o, 0.1); if (!v) return;
      nz(v, { dur: 0.015, hp: 4000, peak: 0.5 }); osc(v, { type: 'square', f: 2600, dur: 0.012, peak: 0.04 }); };
    R.fish_caught = (o) => { const v = V(o, 1.6); if (!v) return;
      nz(v, { type: 'pink', dur: 0.7, a: 0.005, f: 1500, fp: [[0.7, 400]], Q: 0.8, peak: 0.9 });
      nz(v, { type: 'brown', dur: 0.4, f: 300, ftype: 'lowpass', peak: 0.7 });
      for (let i = 0; i < 4; i++) { const t = 0.6 + i * rand(0.15, 0.25);
        osc(v, { type: 'triangle', f: 150, fp: [[0.06, 90]], t, dur: 0.08, peak: 0.35 / (1 + i * 0.3) });
        nz(v, { t, dur: 0.06, f: 1200, Q: 2, peak: 0.25 / (1 + i * 0.3) }); } };

    // --- cooking & eating
    R.sizzle = (o) => { const v = V(o, 1.8); if (!v) return;
      nz(v, { dur: 1.5, a: 0.05, hold: 1.0, hp: 2800, peak: 0.35 });
      nz(v, { buf: this.buf.embers, dur: 1.5, a: 0.05, hold: 1.0, hp: 1800, peak: 1.4 });
      nz(v, { buf: this.buf.crackle, dur: 1.5, a: 0.05, hold: 1.0, hp: 1500, peak: 0.7, rate: 1.6 }); };
    R.eat = (o) => { const v = V(o, 0.9); if (!v) return;
      for (let i = 0; i < 3; i++) nz(v, { t: i * rand(0.2, 0.28), dur: 0.1, f: rand(1600, 2600), Q: 1.5, peak: 0.45, type: 'pink' }); };
    R.drink = (o) => { const v = V(o, 1.0); if (!v) return;
      for (let i = 0; i < 3; i++) osc(v, { f: 240, fp: [[0.1, 520]], t: i * 0.27, a: 0.02, dur: 0.14, peak: 0.25, ff: 900 }); };
    R.pickup = (o) => { const v = V(o, 0.5); if (!v) return;
      osc(v, { f: 660, dur: 0.12, peak: 0.15 }); osc(v, { f: 990, t: 0.07, dur: 0.22, peak: 0.13 });
      nz(v, { type: 'pink', dur: 0.08, f: 2500, Q: 1, peak: 0.15 }); };

    // --- facility interfaces
    R.keycard = (o) => { const v = V(o, 0.9); if (!v) return;
      nz(v, { dur: 0.18, a: 0.03, f: 1400, fp: [[0.18, 4200]], Q: 3, peak: 0.3 });
      osc(v, { type: 'square', f: 880, ff: 2500, t: 0.25, dur: 0.12, peak: 0.08 });
      osc(v, { type: 'square', f: 1320, ff: 3000, t: 0.36, dur: 0.25, peak: 0.08 }); };
    R.beep = (o) => { const v = V(o, 0.3); if (!v) return; osc(v, { type: 'square', f: 1000, ff: 2400, dur: 0.12, hold: 0.06, peak: 0.08 }); };
    R.deny = (o) => { const v = V(o, 0.6); if (!v) return;
      osc(v, { type: 'square', f: 140, ff: 1200, dur: 0.42, hold: 0.3, peak: 0.12 });
      osc(v, { type: 'square', f: 147, ff: 1200, dur: 0.42, hold: 0.3, peak: 0.12 }); };
    R.switch = (o) => { const v = V(o, 0.8); if (!v) return;
      nz(v, { type: 'brown', dur: 0.2, f: 220, ftype: 'lowpass', peak: 1.2 });
      nz(v, { dur: 0.025, hp: 2500, peak: 0.7 });
      this._clang(v, [310, 790, 1460], 0.4, 0.12);
      osc(v, { type: 'sawtooth', f: 60, ff: 300, t: 0.1, a: 0.2, dur: 0.6, peak: 0.06 }); };
    R.elevator_start = (o) => { const v = V(o, 2.6); if (!v) return;
      nz(v, { type: 'brown', dur: 0.4, f: 200, ftype: 'lowpass', peak: 1.2 });
      this._clang(v, [140, 330, 610], 0.9, 0.18);
      osc(v, { type: 'sawtooth', f: 40, fp: [[2.0, 110]], ff: 400, a: 0.6, hold: 1.0, dur: 2.3, peak: 0.18, t: 0.2 }); };
    R.elevator_stop = (o) => { const v = V(o, 3.2, true); if (!v) return;
      nz(v, { type: 'brown', dur: 0.6, f: 180, ftype: 'lowpass', peak: 1.4 });
      nz(v, { dur: 0.04, hp: 1500, peak: 0.7 });
      this._clang(v, [110, 262, 421, 793, 1210], 3.0, 0.32);
      nz(v, { type: 'brown', t: 0.1, dur: 2.5, a: 0.1, f: 90, ftype: 'lowpass', peak: 0.5 }); };
    R.lift_clank = (o) => { const v = V(o, 1.2); if (!v) return;
      nz(v, { type: 'brown', dur: 0.3, f: 240, ftype: 'lowpass', peak: 1 });
      this._clang(v, [230, 610, 1180], 1.0, 0.2); };
    R.paper = (o) => { const v = V(o, 0.7); if (!v) return;
      for (let i = 0; i < 5; i++) nz(v, { type: 'white', t: i * rand(0.05, 0.11), dur: rand(0.05, 0.12), a: 0.01, f: rand(2500, 5000), Q: 0.8, peak: rand(0.1, 0.3) }); };
    R.radio_on = (o) => { const v = V(o, 0.7); if (!v) return;
      nz(v, { dur: 0.02, hp: 3000, peak: 0.6 });
      nz(v, { t: 0.05, dur: 0.45, a: 0.02, f: 2000, Q: 0.6, peak: 0.25 }); };
    R.chop_done = (o) => { const v = V(o, 0.7); if (!v) return;
      nz(v, { dur: 0.03, hp: 1200, peak: 1 });
      osc(v, { type: 'triangle', f: 220, fp: [[0.12, 90]], dur: 0.15, peak: 0.6 });
      nz(v, { type: 'pink', t: 0.03, dur: 0.35, f: 650, fp: [[0.35, 380]], Q: 2, peak: 0.45 });
      osc(v, { type: 'triangle', f: 160, fp: [[0.08, 100]], t: 0.35, dur: 0.1, peak: 0.35 }); }; // pieces land
    R.stove_light = (o) => { const v = V(o, 1.2); if (!v) return;
      nz(v, { type: 'brown', dur: 0.9, a: 0.15, f: 100, fp: [[0.25, 900], [0.9, 200]], ftype: 'lowpass', peak: 1.3 });
      nz(v, { buf: this.buf.crackle, t: 0.3, dur: 0.8, hp: 900, peak: 1 }); };
    R.sleep = (o) => { const v = V(o, 3.5); if (!v) return;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => osc(v, { f, t: i * 0.22, a: 0.05, dur: 2.8 - i * 0.3, peak: 0.08 })); };
    R.hurt = (o) => { const v = V(o, 0.8); if (!v) return;
      nz(v, { type: 'brown', dur: 0.3, f: 300, ftype: 'lowpass', peak: 1.3 });
      nz(v, { type: 'pink', dur: 0.35, a: 0.005, f: 700, Q: 2, peak: 0.4 });
      osc(v, { f: 52, fp: [[0.25, 40]], t: 0.3, dur: 0.3, peak: 0.5 }); };

    // --- the thing in the dark
    R.stalker_shriek = (o) => { const v = V(o, 2.2); if (!v) return;
      const c = this.ctx, t0 = v.t;
      const shaper = c.createWaveShaper(); shaper.curve = this.distCurve; shaper.oversample = '2x';
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
      this._path(bp.frequency, t0, 600, [[0.6, 2400], [1.7, 900]]);
      const ringMod = c.createGain(); ringMod.gain.value = 0;           // ring modulation for the inhuman edge
      const rm = c.createOscillator(); rm.frequency.value = 37; rm.connect(ringMod.gain); rm.start(t0); rm.stop(t0 + 2);
      const out = c.createGain(); this._env(out.gain, t0, 0.45, 0.6, 1.8, 0.35);
      for (const [f, d] of [[310, 0], [327, 13], [468, -9]]) {
        const s = c.createOscillator(); s.type = 'sawtooth'; s.detune.value = d;
        this._path(s.frequency, t0, f * v.rate, [[0.5, f * 1.4 * v.rate], [1.8, f * 0.6 * v.rate]]);
        const wob = c.createOscillator(); wob.frequency.value = rand(6, 11);
        const wg = c.createGain(); wg.gain.value = 40; wob.connect(wg); wg.connect(s.detune);
        s.connect(ringMod); s.start(t0); s.stop(t0 + 1.9); wob.start(t0); wob.stop(t0 + 1.9);
      }
      ringMod.connect(shaper); shaper.connect(bp); bp.connect(out); out.connect(v.dst);
      nz(v, { type: 'white', dur: 1.6, a: 0.4, f: 3000, fp: [[1.6, 1200]], Q: 2, peak: 0.12 }); };
    R.stalker_step = (o) => { const v = V(o, 0.4); if (!v) return; const r = rand(0.8, 1.1);
      nz(v, { type: 'brown', dur: 0.16, f: 260 * r, ftype: 'lowpass', peak: 1 });
      nz(v, { type: 'pink', dur: 0.12, t: 0.02, f: 700 * r, Q: 3, peak: 0.25 });
      nz(v, { dur: 0.015, t: 0.05, hp: 3500, peak: 0.2 }); };

    // --- small gear
    R.flashlight_click = (o) => { const v = V(o, 0.2); if (!v) return;
      nz(v, { dur: 0.012, hp: 3500, peak: 0.5 }); nz(v, { t: 0.05, dur: 0.01, hp: 4500, peak: 0.3 }); };
    R.battery_insert = (o) => { const v = V(o, 0.5); if (!v) return;
      nz(v, { type: 'pink', dur: 0.15, a: 0.03, f: 2200, Q: 2, peak: 0.25 });
      nz(v, { t: 0.18, dur: 0.02, hp: 2500, peak: 0.6 }); osc(v, { type: 'square', f: 1800, t: 0.18, dur: 0.02, peak: 0.05 }); };
    R.ui_click = (o) => { const v = V(o, 0.1); if (!v) return; osc(v, { type: 'square', f: 1800, ff: 4000, dur: 0.025, peak: 0.05 }); };
    R.water_pour = (o) => { const v = V(o, 1.8); if (!v) return;
      const g = nz(v, { type: 'pink', dur: 1.5, a: 0.1, hold: 1.0, f: 1000, fp: [[1.5, 1400]], Q: 1.2, peak: 0.4 });
      const l = this.ctx.createOscillator(); l.frequency.value = 9; const lg = this._gain(0.15);
      l.connect(lg); lg.connect(g.gain); l.start(v.t); l.stop(v.t + 1.6); };
    R.generator_start = (o) => { const v = V(o, 3.0); if (!v) return;
      let t = 0;
      for (let i = 0; i < 10; i++) { const gap = Math.max(0.07, 0.35 - i * 0.03);
        nz(v, { type: 'brown', t, dur: 0.12, f: 200, ftype: 'lowpass', peak: 0.9 * Math.min(1, 0.4 + i * 0.1) }); t += gap; }
      osc(v, { type: 'sawtooth', f: 32, fp: [[1.5, 48]], ff: 300, t: 0.8, a: 0.8, hold: 0.6, dur: 2.0, peak: 0.15 }); };
    R.discovery = (o) => { const v = V({ bus: this.evBus, ...o }, 3.2); if (!v) return;
      osc(v, { f: 55, a: 0.6, dur: 3, peak: 0.25 }); osc(v, { f: 82.4, a: 0.9, dur: 2.8, peak: 0.12 });
      osc(v, { type: 'sawtooth', f: 110, fp: [[2.5, 104]], ff: 300, ffp: [[1.2, 1400], [2.8, 300]], a: 1.0, dur: 2.8, peak: 0.05 });
      osc(v, { f: 659, t: 0.5, a: 0.5, dur: 2.4, peak: 0.02 }); };

    // --- weather and the event
    R.thunder = (o) => { const v = V({ ref: 60, ...o }, 7, true); if (!v) return;
      nz(v, { type: 'white', dur: 0.5, a: 0.01, lp: 2500, peak: 0.3 });
      nz(v, { type: 'brown', dur: rand(4, 6), a: 0.2, f: 160, fp: [[1, 300], [5, 70]], ftype: 'lowpass', peak: 1.4 });
      for (let i = 0; i < 3; i++) nz(v, { type: 'brown', t: rand(0.6, 3), dur: rand(1, 2), a: 0.15, f: rand(120, 260), ftype: 'lowpass', peak: 0.7 }); };
    R.boom = (o) => this._boom(o);

    // underground ambient one-shots exposed too (handy for scripted moments)
    R.drip = (o) => this._drip(o);
    R.clank_distant = (o) => this._distantClank(o);
    R.boom_distant = (o) => this._distantBoom(o);
    R.stone_groan = (o) => this._stoneGroan(o);

    this._rec = R;
    return R;
  }

  // THE red-sky sound: sub impact, rolling valley rumble with echoes, metallic overtone.
  _boom(o = {}) {
    const v = this._voice({ volume: o.volume ?? 1, position: o.position, ref: o.ref ?? 50, bus: this.master }, 13, true);
    if (!v) return;
    const c = this.ctx;
    // 1) the crack of arrival
    this._nz(v, { type: 'white', dur: 0.6, a: 0.005, lp: 3000, peak: 0.5 });
    this._nz(v, { type: 'brown', dur: 1.2, a: 0.01, f: 400, ftype: 'lowpass', peak: 1.6 });
    // 2) the sub-bass body
    this._osc(v, { f: 38, fp: [[0.3, 31], [4, 21]], a: 0.02, hold: 0.4, dur: 4.5, peak: 0.95 });
    this._osc(v, { f: 57, fp: [[3, 33]], a: 0.03, dur: 3, peak: 0.4 });
    // 3) long rolling rumble, cutoff wandering = rolling across the valley
    const roll = this._nz(v, { type: 'brown', t: 0.2, dur: 11, a: 0.6, hold: 1.5, f: 180, fp: [[2, 320], [4, 140], [7, 220], [11, 60]], ftype: 'lowpass', Q: 1.5, peak: 1.3 });
    const wob = c.createOscillator(); wob.frequency.value = 0.6; const wg = this._gain(0.35);
    wob.connect(wg); wg.connect(roll.gain); wob.start(v.t); wob.stop(v.t + 11.5);
    // 4) echoes off the far ridges: delayed, darker, panned alternately
    [[1.4, -0.8, 0.55], [2.9, 0.7, 0.4], [4.6, -0.4, 0.3], [6.5, 0.9, 0.2], [8.6, -0.6, 0.12]].forEach(([t, pan, a]) => {
      const p = new StereoPannerNode(c, { pan });
      p.connect(v.dst);
      this._nz(v, { type: 'brown', t, dur: 2.2, a: 0.08, f: 260 - t * 18, ftype: 'lowpass', peak: a * 1.4, to: p });
      this._osc(v, { f: 34, t, dur: 1.8, a: 0.05, peak: a * 0.5, to: p });
    });
    // 5) the wrong part: a metallic, beating, resonant overtone that lingers
    for (const [f, a] of [[147, 0.07], [149.5, 0.07], [233, 0.05], [311, 0.035], [622.5, 0.015]]) {
      const n = this._osc(v, { f, t: 0.1, a: 0.6, hold: 1.5, dur: 8, peak: a });
      n.g.connect(this.bigVerb); // send straight into the huge reverb
    }
  }

  // --- ambient event recipes (spatial) ---------------------------------------
  _birdTrill(o) { // robin-ish phrase: 3-6 swooping notes
    const n = 3 + Math.floor(Math.random() * 4), base = rand(1900, 3000);
    const v = this._voice(o, n * 0.2 + 0.4); if (!v) return;
    for (let i = 0; i < n; i++) {
      const f = base * rand(0.8, 1.25), t = i * rand(0.12, 0.2);
      this._osc(v, { f, fp: [[0.05, f * rand(1.1, 1.4)], [0.11, f * rand(0.8, 1)]], t, a: 0.01, dur: 0.12, peak: 0.12 });
    }
  }
  _birdThrush(o) { // varied thrush: one long buzzy whistle, the Pacific NW signature
    const v = this._voice(o, 2.2); if (!v) return;
    const f = rand(2400, 4300), c = this.ctx;
    const { os } = this._osc(v, { f, a: 0.08, hold: 1.0, dur: 1.6, peak: 0.1 });
    const lfo = c.createOscillator(); lfo.frequency.value = rand(35, 60);
    const lg = this._gain(f * 0.012); lfo.connect(lg); lg.connect(os.frequency);
    lfo.start(v.t); lfo.stop(v.t + 1.7);
  }
  _birdFeeBee(o) { // two clear whistles, high then lower
    const v = this._voice(o, 1.0); if (!v) return;
    const f = rand(3200, 3900);
    this._osc(v, { f, a: 0.02, hold: 0.15, dur: 0.3, peak: 0.1 });
    this._osc(v, { f: f * 0.84, fp: [[0.3, f * 0.82]], t: 0.38, a: 0.02, hold: 0.15, dur: 0.35, peak: 0.1 });
  }
  _raven(o) { // 2-3 throaty croaks
    const n = 2 + Math.floor(Math.random() * 2);
    const v = this._voice(o, n * 0.5 + 0.4); if (!v) return;
    for (let i = 0; i < n; i++) {
      const t = i * rand(0.38, 0.5), f = rand(300, 380);
      this._osc(v, { type: 'sawtooth', f, fp: [[0.3, f * 0.85]], ff: 1100, Q: 4, ftype: 'bandpass', t, a: 0.03, dur: 0.32, peak: 0.25 });
      this._nz(v, { type: 'pink', t, dur: 0.3, f: 1300, Q: 3, peak: 0.08 });
    }
  }
  _frog(o) { // Pacific tree frog "rib-bit": two buzzy pulses
    const v = this._voice(o, 0.5); if (!v) return;
    const f = rand(1500, 2100);
    for (const t of [0, 0.13]) this._osc(v, { type: 'sawtooth', f, fp: [[0.08, f * 0.9]], ff: f * 1.1, ftype: 'bandpass', Q: 5, t, a: 0.01, dur: 0.09, peak: 0.25 });
  }
  _owl(o) { // great horned owl: hoo, hoo-hoo, hoo
    const v = this._voice(o, 2.6); if (!v) return;
    [0, 0.6, 0.85, 1.6].forEach((t, i) => this._osc(v, { f: i === 3 ? 360 : 390, fp: [[0.3, 340]], t, a: 0.08, dur: i === 1 || i === 2 ? 0.2 : 0.45, peak: 0.18 }));
  }
  _drip(o) {
    const v = this._voice(o, 0.4); if (!v) return;
    const f = rand(900, 1800);
    this._osc(v, { f, fp: [[0.05, f * 2.2]], dur: 0.07, a: 0.002, peak: 0.25 });
  }
  _distantClank(o) {
    const v = this._voice(o, 2.2); if (!v) return;
    this._nz(v, { type: 'brown', dur: 0.3, f: 300, ftype: 'lowpass', peak: 0.8 });
    this._clang(v, [rand(150, 260), rand(400, 600), rand(900, 1300), rand(1700, 2300)], 1.8, 0.2);
  }
  _ventRattle(o) {
    const v = this._voice(o, 1.4); if (!v) return;
    const n = 5 + Math.floor(Math.random() * 8), f = rand(500, 1200);
    for (let i = 0; i < n; i++) this._nz(v, { t: i * rand(0.05, 0.11), dur: 0.04, f: f * rand(0.9, 1.1), Q: 6, peak: rand(0.15, 0.4) });
  }
  _distantBoom(o) {
    const v = this._voice(o, 4); if (!v) return;
    this._nz(v, { type: 'brown', dur: 3.2, a: 0.05, f: 140, fp: [[3, 60]], ftype: 'lowpass', peak: 1.3 });
    this._osc(v, { f: 45, fp: [[2, 30]], dur: 2, peak: 0.3 });
  }
  _stoneGroan(o) {
    const v = this._voice(o, 4); if (!v) return;
    const f = rand(36, 55);
    this._osc(v, { type: 'sawtooth', f, fp: [[1.5, f * 0.8], [3.2, f * 0.7]], ff: 220, Q: 3, a: 0.8, dur: 3.4, peak: 0.25 });
    this._nz(v, { type: 'brown', dur: 3.4, a: 0.6, f: 180, fp: [[3.4, 90]], ftype: 'lowpass', peak: 0.5 });
    this._nz(v, { type: 'pink', t: 0.5, dur: 2.2, a: 0.4, f: 900, Q: 8, peak: 0.04 }); // grit
  }

  // ---------------------------------------------------------------------------
  // startLoop(): long-running sounds with a control handle
  // ---------------------------------------------------------------------------
  startLoop(name, opts = {}) {
    const dummy = { setVolume() {}, setRate() {}, setPosition() {}, stop() {} };
    if (!this.ctx) return dummy;
    const c = this.ctx, t = c.currentTime;
    const out = this._gain(0);
    const vol = opts.volume ?? 1;
    out.gain.setTargetAtTime(vol, t, 0.08);
    let panner = null;
    if (opts.position) { panner = this._panner(opts.position, opts.ref ?? 3); out.connect(panner); panner.connect(opts.bus || this.sfxBus); }
    else out.connect(opts.bus || this.sfxBus);

    const sources = [];          // things with .stop()
    const rateParams = [];       // [param, baseValue]
    const src = (node) => { sources.push(node); return node; };
    const loopNz = (buf, rate = 1) => { const s = src(this._loopSrc(buf, rate)); rateParams.push([s.playbackRate, rate]); return s; };
    const oscN = (type, f) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.start(); src(o); rateParams.push([o.frequency, f]); return o; };
    let tick = null;

    switch (name) {
      case 'elevator_motor': {
        this._chain(oscN('sawtooth', 55), this._filter('lowpass', 380, 2), this._gain(0.12), out);
        this._chain(oscN('sawtooth', 110.6), this._filter('lowpass', 500), this._gain(0.05), out);
        this._chain(loopNz(this.noise.brown), this._filter('lowpass', 200), this._gain(0.4), out);
        // cable/guide-rail clicks
        tick = (dt) => { if (chance(1.2, dt)) { const v = this._voice({ volume: 0.3 * vol, position: opts.position, bus: opts.bus }, 0.3); if (v) this._nz(v, { dur: 0.03, f: rand(1500, 3000), Q: 5, peak: 0.4 }); } };
        break;
      }
      case 'reel': {
        const sq = oscN('square', 28);
        this._chain(sq, this._filter('highpass', 2500), this._gain(0.06), out);
        this._chain(loopNz(this.noise.white), this._filter('bandpass', 3500, 3), this._gain(0.03), out);
        break;
      }
      case 'radio_static': {
        const amp = this._gain(0.5); this._const(0.5).connect(amp.gain); this._lfo(0.4, 0.2).connect(amp.gain);
        this._chain(loopNz(this.noise.white), this._filter('bandpass', 1900, 0.5), amp, this._gain(0.18), out);
        this._chain(loopNz(this.buf.drops, 0.7), this._filter('bandpass', 2500, 1), this._gain(0.2), out);
        if (opts.numbers) {
          // faint number-station tones: a slow sequence of digits as pitches
          const scale = [392, 440, 494, 523, 587, 659, 698, 784, 880, 988];
          let timer = 1.5, seq = 0;
          tick = (dt) => {
            timer -= dt; if (timer > 0) return;
            seq++; timer = (seq % 5 === 0) ? 2.2 : 0.75;
            const v = this._voice({ volume: vol, bus: out }, 0.5); if (!v) return;
            this._osc(v, { f: pick(scale), ff: 1500, a: 0.03, hold: 0.25, dur: 0.38, peak: 0.05, type: 'triangle' });
          };
        }
        break;
      }
      case 'machine': {
        const chug = this._gain(0); this._const(0.5).connect(chug.gain);
        const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 3; lfo.start(); src(lfo); rateParams.push([lfo.frequency, 3]);
        const lg = this._gain(0.45), lp = this._filter('lowpass', 20); lfo.connect(lg); lg.connect(lp); lp.connect(chug.gain);
        this._chain(loopNz(this.noise.brown), this._filter('lowpass', 320), chug, this._gain(0.7), out);
        this._chain(oscN('sawtooth', 45), this._filter('lowpass', 200, 3), this._gain(0.08), out);
        this._chain(loopNz(this.noise.pink), this._filter('bandpass', 1500, 4), this._gain(0.03), out);
        break;
      }
      case 'alarm': {
        const o = oscN('square', 520);
        const sw = c.createOscillator(); sw.type = 'square'; sw.frequency.value = 0.55; sw.start(); src(sw);
        const sg = this._gain(80); sw.connect(sg); sg.connect(o.frequency);
        const g = this._gain(0.05);
        this._chain(o, this._filter('bandpass', 900, 2), this._filter('lowpass', 1500), g, out);
        const send = this._gain(0.5); g.connect(send); send.connect(this.bigVerb);
        break;
      }
      case 'fire': {
        this._chain(loopNz(this.buf.crackle), this._filter('highpass', 500), this._gain(1.0), out);
        this._chain(loopNz(this.buf.embers), this._filter('highpass', 2000), this._gain(0.6), out);
        this._chain(loopNz(this.noise.brown), this._filter('lowpass', 300), this._gain(0.35), out);
        break;
      }
      default:
        if (!this._warned.has('loop:' + name)) { this._warned.add('loop:' + name); console.warn('[audio] unknown loop:', name); }
        out.disconnect(); if (panner) panner.disconnect();
        return dummy;
    }

    const handle = {
      tick,
      setVolume: (v) => out.gain.setTargetAtTime(v, c.currentTime, 0.08),
      setRate: (r) => { for (const [p, base] of rateParams) p.setTargetAtTime(base * r, c.currentTime, 0.1); },
      setPosition: (p) => {
        if (!panner || !p) return;
        panner.positionX.value = p.x; panner.positionY.value = p.y; panner.positionZ.value = p.z;
      },
      stop: () => {
        if (!this._loops.has(handle)) return;
        this._loops.delete(handle);
        const now = c.currentTime;
        out.gain.setTargetAtTime(0, now, 0.08);
        setTimeout(() => {
          for (const s of sources) { try { s.stop(); } catch (e) { /* already stopped */ } }
          try { out.disconnect(); if (panner) panner.disconnect(); } catch (e) { /* gone */ }
        }, 600);
      },
    };
    this._loops.add(handle);
    return handle;
  }

  // ---------------------------------------------------------------------------
  // Global controls
  // ---------------------------------------------------------------------------
  setMasterVolume(v) {
    this._masterVol = Math.max(0, v);
    if (this.master) this.master.gain.setTargetAtTime(this._masterVol, this.ctx.currentTime, 0.05);
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') return this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') return this.ctx.resume(); }
}
