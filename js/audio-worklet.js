import { OPL2Wrapper } from './opl2-wrapper.js';
import { HSCSeq } from './hsc-seq.js';

// ---- AudioWorkletProcessor ----

class HSCWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.opl2 = new OPL2Wrapper(sampleRate);
    this.seq = new HSCSeq(this.opl2);

    // Tick timing (sample-accurate)
    this.tickRate = 18.2;
    this.samplesPerTick = sampleRate / this.tickRate;
    this.tickAccum = 0;

    this._buf = new Float32Array(512);

    // Channel activity levels for visualization
    this.chLevels = new Float32Array(9);
    this.levelSendCounter = 0;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'loadHSC') {
        this.seq.load(msg.hsc);
      } else if (msg.type === 'play') {
        this.seq.start();
        this.tickAccum = 0;
      } else if (msg.type === 'stop') {
        this.seq.stop();
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : null;
    const numSamples = outL.length;

    if (!this.seq.playing) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return true;
    }

    // Process audio with sample-accurate tick timing
    let offset = 0;
    while (offset < numSamples) {
      // How many samples until next tick?
      const samplesUntilTick = Math.floor(this.samplesPerTick - this.tickAccum);
      const samplesToGen = Math.min(samplesUntilTick > 0 ? samplesUntilTick : 1, numSamples - offset);

      // Generate OPL2 audio
      if (this._buf.length < samplesToGen) {
        this._buf = new Float32Array(samplesToGen);
      }
      this.opl2.generate(samplesToGen, this._buf);

      // Copy to output
      const masterVol = 0.5;
      for (let i = 0; i < samplesToGen; i++) {
        const s = this._buf[i] * masterVol;
        outL[offset + i] = s;
        if (outR) outR[offset + i] = s;
      }

      offset += samplesToGen;
      this.tickAccum += samplesToGen;

      // Time for a tick?
      if (this.tickAccum >= this.samplesPerTick) {
        this.tickAccum -= this.samplesPerTick;
        const state = this.seq.tick();

        if (state) {
          // Send state to main thread for UI update
          this.port.postMessage({ type: 'state', state });

          // Update channel levels based on key-on state
          for (let c = 0; c < 9; c++) {
            if (state.chKeyOn[c]) {
              this.chLevels[c] = 1.0;
            }
          }
        }
      }
    }

    // Decay channel levels
    for (let c = 0; c < 9; c++) {
      this.chLevels[c] *= 0.95;
    }

    this.levelSendCounter += numSamples;
    if (this.levelSendCounter >= sampleRate / 30) { // ~30 fps updates
      this.levelSendCounter = 0;
      this.port.postMessage({
        type: 'levels',
        levels: Array.from(this.chLevels)
      });
    }

    return true;
  }
}

registerProcessor('hsc-worklet-processor', HSCWorkletProcessor);
