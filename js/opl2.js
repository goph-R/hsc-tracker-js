/**
 * OPL2 (YM3812) Emulator - Register-level interface
 *
 * Core synthesis math inspired by a1k0n's OPL2 emulator (MIT license).
 * Rewritten with a register-level API suitable for driving from an HSC sequencer.
 *
 * Native OPL2 sample rate: 49716 Hz (14.31818 MHz / 288)
 */

const OPL2_RATE = 49716;

// Frequency multiplier table
const freqMulTbl = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15];

// KSL (Key Scale Level) attenuation table - dB*8 per octave
const kslTable = [0, 32, 40, 45, 48, 51, 53, 55, 56, 58, 59, 60, 61, 62, 63, 64];

let expTbl, logSinTbl;

function initOPL2Tables() {
  if (expTbl) return; // already initialized

  expTbl = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    expTbl[i] = (2 * Math.pow(2, 1 - i / 256.0) * 1024 + 0.5) | 0;
  }

  logSinTbl = new Uint16Array(512);
  for (let i = 0; i < 512; i++) {
    logSinTbl[i] = (-Math.log(Math.sin((i + 0.5) * Math.PI / 512)) / Math.log(2) * 256 + 0.5) | 0;
  }
}

// Attempt exponentiation from log-space value
function expLookup(logVal) {
  if (logVal >= 7936) return 0;
  return expTbl[logVal & 0xff] >> (logVal >> 8);
}

// ADSR envelope phases
const ENV_ATTACK = 0;
const ENV_DECAY = 1;
const ENV_SUSTAIN = 2;
const ENV_RELEASE = 3;
const ENV_OFF = 4;

// Attack rate table (exponential curve)
const attackTable = [];
(function() {
  let x = 512;
  for (let i = 0; i < 64; i++) {
    attackTable.push(8 * x);
    x -= (x >> 3) + 1;
    if (x < 0) x = 0;
  }
})();

class OPL2Envelope {
  constructor() {
    this.attackRate = 0;
    this.decayRate = 0;
    this.sustainLevel = 0;
    this.releaseRate = 0;
    this.sustainMode = true; // EG type bit
    this.phase = ENV_OFF;
    this.vol = 4095; // max attenuation (silent)
    this.attackPhase = 0;
  }

  setADSR(att, dec, sus, rel) {
    this.attackRate = att;
    this.decayRate = dec;
    this.sustainLevel = sus;
    this.releaseRate = rel;
  }

  keyOn() {
    this.phase = ENV_ATTACK;
    this.attackPhase = 0;
  }

  keyOff() {
    if (this.phase !== ENV_OFF) {
      this.phase = ENV_RELEASE;
    }
  }

  generate(level, numSamples, out) {
    let vol = this.vol;
    const attInc = 1 << this.attackRate;
    const decInc = (1 << this.decayRate) / 768.0;
    const relInc = (1 << this.releaseRate) / 768.0;
    const susLvl = this.sustainLevel << 7;

    for (let i = 0; i < numSamples; i++) {
      switch (this.phase) {
        case ENV_ATTACK:
          vol = (this.attackPhase < attackTable.length * 8192)
            ? attackTable[(this.attackPhase / 8192) | 0]
            : 0;
          this.attackPhase += attInc;
          if (this.attackPhase >= attackTable.length * 8192) {
            vol = 0;
            this.phase = ENV_DECAY;
          }
          break;
        case ENV_DECAY:
          vol += decInc;
          if (vol >= susLvl) {
            vol = susLvl;
            this.phase = ENV_SUSTAIN;
          }
          break;
        case ENV_SUSTAIN:
          if (!this.sustainMode) {
            this.phase = ENV_RELEASE;
          }
          // vol stays at sustain level
          break;
        case ENV_RELEASE:
          vol += relInc;
          if (vol >= 4095) {
            vol = 4095;
            this.phase = ENV_OFF;
          }
          break;
        case ENV_OFF:
          vol = 4095;
          break;
      }
      out[i] = vol + level;
    }
    this.vol = vol;
  }
}

class OPL2Operator {
  constructor() {
    this.waveform = 0;
    this.phase = 0;
    this.phaseIncr = 0;
    this.feedback = 0;
    this.lastSample0 = 0;
    this.lastSample1 = 0;
  }

  generateMod(vol, numSamples, out) {
    let p = this.phase;
    const dp = this.phaseIncr;
    let w = this.lastSample0;
    let w1 = this.lastSample1;
    const fbShift = this.feedback > 0 ? (9 - this.feedback) : 31;
    const wf = this.waveform;

    for (let i = 0; i < numSamples; i++) {
      const m = p + ((w + w1) >> fbShift);
      w1 = w;
      const idx = m & 511;
      const negHalf = m & 512;

      let sample = 0;
      if (wf === 0) { // sine
        const l = logSinTbl[idx] + vol[i];
        sample = expLookup(l);
        if (negHalf) sample = -sample;
      } else if (wf === 1) { // half sine (positive half only)
        if (!negHalf) {
          const l = logSinTbl[idx] + vol[i];
          sample = expLookup(l);
        }
      } else if (wf === 2) { // abs sine
        const l = logSinTbl[idx] + vol[i];
        sample = expLookup(l);
      } else if (wf === 3) { // quarter sine (pulse)
        if (m & 256) {
          const l = logSinTbl[m & 255] + vol[i];
          sample = expLookup(l);
        }
      }

      w = sample;
      p += dp;
      out[i] = w;
    }

    this.phase = p % 1024.0;
    this.lastSample0 = w;
    this.lastSample1 = w1;
  }

  generateCar(vol, modulation, numSamples, out) {
    let p = this.phase;
    const dp = this.phaseIncr;
    const wf = this.waveform;

    for (let i = 0; i < numSamples; i++) {
      const m = p + modulation[i];
      const idx = m & 511;
      const negHalf = m & 512;

      let sample = 0;
      if (wf === 0) {
        const l = logSinTbl[idx] + vol[i];
        sample = expLookup(l);
        if (negHalf) sample = -sample;
      } else if (wf === 1) {
        if (!negHalf) {
          const l = logSinTbl[idx] + vol[i];
          sample = expLookup(l);
        }
      } else if (wf === 2) {
        const l = logSinTbl[idx] + vol[i];
        sample = expLookup(l);
      } else if (wf === 3) {
        if (m & 256) {
          const l = logSinTbl[m & 255] + vol[i];
          sample = expLookup(l);
        }
      }

      p += dp;
      out[i] += sample;
    }

    this.phase = p % 1024.0;
  }
}

/**
 * OPL2 Chip emulator with register-level interface.
 * Write registers with write(reg, val), generate samples with generate(n).
 */
class OPL2Chip {
  constructor(outputRate) {
    initOPL2Tables();

    this.outputRate = outputRate || OPL2_RATE;
    this.regs = new Uint8Array(256);

    // 9 channels, each with modulator + carrier operator
    this.channels = [];
    for (let i = 0; i < 9; i++) {
      this.channels[i] = {
        mod: new OPL2Operator(),
        car: new OPL2Operator(),
        menv: new OPL2Envelope(),
        cenv: new OPL2Envelope(),
        mlevel: 0,   // modulator total level (log attenuation)
        clevel: 0,   // carrier total level
        connection: 0, // 0=FM, 1=additive
        keyOn: false,
        fnum: 0,
        block: 0,
      };
    }

    // Scratch buffers
    this._scratch1 = new Int32Array(4096);
    this._scratch2 = new Int32Array(4096);
    this._outbuf = new Float32Array(4096);

    this.rhythmMode = false;
    this.rhythmBits = 0;

    // Channel-to-operator offset mapping
    // OPL2 has 18 operators mapped non-linearly to 9 channels
    this._chanToModOp = [0, 1, 2, 8, 9, 10, 16, 17, 18];
    this._chanToCarOp = [3, 4, 5, 11, 12, 13, 19, 20, 21];

    // Reverse: operator offset to channel number
    this._opToChan = new Int8Array(22).fill(-1);
    this._opIsCarrier = new Uint8Array(22);
    for (let ch = 0; ch < 9; ch++) {
      this._opToChan[this._chanToModOp[ch]] = ch;
      this._opToChan[this._chanToCarOp[ch]] = ch;
      this._opIsCarrier[this._chanToCarOp[ch]] = 1;
    }
  }

  /**
   * Write a value to an OPL2 register.
   */
  write(reg, val) {
    this.regs[reg] = val;

    // Decode register groups
    if (reg >= 0x20 && reg <= 0x35) {
      // Tremolo / Vibrato / Sustain / KSR / Multiple
      const op = reg - 0x20;
      const ch = this._opToChan[op];
      if (ch < 0) return;
      const isCarrier = this._opIsCarrier[op];
      const mul = freqMulTbl[val & 0x0f];
      const sustainMode = !!(val & 0x20);

      if (isCarrier) {
        this.channels[ch].car.cmul = mul;
        this.channels[ch].cenv.sustainMode = sustainMode;
      } else {
        this.channels[ch].mod.mmul = mul;
        this.channels[ch].menv.sustainMode = sustainMode;
      }
      this._updateFreq(ch);
    }
    else if (reg >= 0x40 && reg <= 0x55) {
      // KSL / Total Level
      const op = reg - 0x40;
      const ch = this._opToChan[op];
      if (ch < 0) return;
      const isCarrier = this._opIsCarrier[op];
      const tl = (val & 0x3f) << 5; // scale to log attenuation

      if (isCarrier) {
        this.channels[ch].clevel = tl;
      } else {
        this.channels[ch].mlevel = tl;
      }
    }
    else if (reg >= 0x60 && reg <= 0x75) {
      // Attack / Decay
      const op = reg - 0x60;
      const ch = this._opToChan[op];
      if (ch < 0) return;
      const isCarrier = this._opIsCarrier[op];
      const env = isCarrier ? this.channels[ch].cenv : this.channels[ch].menv;
      env.attackRate = val >> 4;
      env.decayRate = val & 0x0f;
    }
    else if (reg >= 0x80 && reg <= 0x95) {
      // Sustain / Release
      const op = reg - 0x80;
      const ch = this._opToChan[op];
      if (ch < 0) return;
      const isCarrier = this._opIsCarrier[op];
      const env = isCarrier ? this.channels[ch].cenv : this.channels[ch].menv;
      env.sustainLevel = val >> 4;
      env.releaseRate = val & 0x0f;
    }
    else if (reg >= 0xA0 && reg <= 0xA8) {
      // Frequency number (low 8 bits)
      const ch = reg - 0xA0;
      this.channels[ch].fnum = (this.channels[ch].fnum & 0x300) | val;
      this._updateFreq(ch);
    }
    else if (reg >= 0xB0 && reg <= 0xB8) {
      // Key-On / Block / Frequency (high 2 bits)
      const ch = reg - 0xB0;
      const newKeyOn = !!(val & 0x20);
      this.channels[ch].fnum = (this.channels[ch].fnum & 0xFF) | ((val & 0x03) << 8);
      this.channels[ch].block = (val >> 2) & 0x07;
      this._updateFreq(ch);

      if (newKeyOn && !this.channels[ch].keyOn) {
        this.channels[ch].cenv.keyOn();
        this.channels[ch].menv.keyOn();
      } else if (!newKeyOn && this.channels[ch].keyOn) {
        this.channels[ch].cenv.keyOff();
        this.channels[ch].menv.keyOff();
      }
      this.channels[ch].keyOn = newKeyOn;
    }
    else if (reg === 0xBD) {
      // Rhythm mode / percussion
      this.rhythmMode = !!(val & 0x20);
      this.rhythmBits = val & 0x1f;
    }
    else if (reg >= 0xC0 && reg <= 0xC8) {
      // Feedback / Connection
      const ch = reg - 0xC0;
      this.channels[ch].mod.feedback = (val >> 1) & 0x07;
      this.channels[ch].connection = val & 0x01;
    }
    else if (reg >= 0xE0 && reg <= 0xF5) {
      // Waveform select
      const op = reg - 0xE0;
      const ch = this._opToChan[op];
      if (ch < 0) return;
      const isCarrier = this._opIsCarrier[op];
      if (isCarrier) {
        this.channels[ch].car.waveform = val & 0x03;
      } else {
        this.channels[ch].mod.waveform = val & 0x03;
      }
    }
    else if (reg === 0x01) {
      // Waveform select enable - we always support waveforms
    }
    else if (reg === 0x08) {
      // CSW / Note-Sel - not critical for basic playback
    }
  }

  _updateFreq(ch) {
    const chan = this.channels[ch];
    // OPL2 frequency: fnum * fsam * 2^(block-1) / 2^19
    // Phase increment: (fnum << block) / 1024 * fsam / outputRate
    const fscale = 14318180.0 / (288.0 * this.outputRate);
    const incr = (chan.fnum << chan.block) / 1024.0;
    const cmul = chan.car.cmul || 1;
    const mmul = chan.mod.mmul || 1;
    chan.car.phaseIncr = incr * cmul * fscale;
    chan.mod.phaseIncr = incr * mmul * fscale;
  }

  /**
   * Generate n mono samples into a Float32Array.
   * Returns the array.
   */
  generate(numSamples) {
    if (this._outbuf.length < numSamples) {
      this._outbuf = new Float32Array(numSamples);
      this._scratch1 = new Int32Array(numSamples);
      this._scratch2 = new Int32Array(numSamples);
    }

    const out = this._outbuf;
    const s1 = this._scratch1;
    const s2 = this._scratch2;

    // Clear output
    for (let i = 0; i < numSamples; i++) out[i] = 0;

    for (let ch = 0; ch < 9; ch++) {
      const chan = this.channels[ch];

      // Modulator envelope → s1
      chan.menv.generate(chan.mlevel, numSamples, s1);
      // Modulator wave → s1
      chan.mod.generateMod(s1, numSamples, s1);

      // Carrier envelope → s2
      chan.cenv.generate(chan.clevel, numSamples, s2);

      if (chan.connection === 0) {
        // FM mode: carrier modulated by modulator
        // Use s1 as modulation input to carrier, add to outbuf (via Int32 temp)
        const intOut = new Int32Array(numSamples);
        chan.car.generateCar(s2, s1, numSamples, intOut);
        for (let i = 0; i < numSamples; i++) {
          out[i] += intOut[i] / 4096.0;
        }
      } else {
        // Additive mode: modulator + carrier summed
        const intOut = new Int32Array(numSamples);
        const zeroMod = new Int32Array(numSamples); // no modulation
        chan.car.generateCar(s2, zeroMod, numSamples, intOut);
        for (let i = 0; i < numSamples; i++) {
          out[i] += (intOut[i] + s1[i]) / 4096.0;
        }
      }
    }

    // Normalize (9 channels can sum up)
    const scale = 1.0 / 9.0;
    for (let i = 0; i < numSamples; i++) {
      out[i] *= scale;
    }

    return out;
  }

  /**
   * Reset all registers and channels.
   */
  reset() {
    this.regs.fill(0);
    for (let ch = 0; ch < 9; ch++) {
      const chan = this.channels[ch];
      chan.mod = new OPL2Operator();
      chan.car = new OPL2Operator();
      chan.menv = new OPL2Envelope();
      chan.cenv = new OPL2Envelope();
      chan.mlevel = 0;
      chan.clevel = 0;
      chan.connection = 0;
      chan.keyOn = false;
      chan.fnum = 0;
      chan.block = 0;
    }
    // Enable waveform select
    this.write(0x01, 0x20);
  }
}

// Export for use in worklet or main thread
if (typeof globalThis !== 'undefined') {
  globalThis.OPL2Chip = OPL2Chip;
  globalThis.OPL2_RATE = OPL2_RATE;
  globalThis.initOPL2Tables = initOPL2Tables;
}
