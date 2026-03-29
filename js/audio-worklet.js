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
      } else if (msg.type === 'playFrom') {
        this.seq.startFrom(msg.songPos, msg.pattPos, msg.channelInstr, msg.speed);
        this.tickAccum = 0;
      } else if (msg.type === 'stop') {
        this.seq.stop();
      } else if (msg.type === 'previewNote') {
        // Set instrument and play a single note for preview
        this.seq.setinstr(msg.ch, msg.instrIdx);
        this.seq.previewNote(msg.ch, msg.note);
        this.previewing = true;
      } else if (msg.type === 'stopPreview') {
        this.seq.stopPreview(msg.ch);
        this.previewing = false;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : null;
    const numSamples = outL.length;

    if (!this.seq.playing && !this.previewing) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return true;
    }

    // Preview mode: just generate OPL2 audio without sequencer ticks
    if (this.previewing && !this.seq.playing) {
      if (this._buf.length < numSamples) {
        this._buf = new Float32Array(numSamples);
      }
      this.opl2.generate(numSamples, this._buf);
      const masterVol = 0.5;
      for (let i = 0; i < numSamples; i++) {
        const s = this._buf[i] * masterVol;
        outL[i] = s;
        if (outR) outR[i] = s;
      }
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

          // Update channel levels from note triggers
          for (let c = 0; c < 9; c++) {
            if (state.chTriggered[c]) {
              this.chLevels[c] = 1.0;
            }
          }

        }
      }
    }

    // Decay channel levels
    for (let c = 0; c < 9; c++) {
      this.chLevels[c] *= 0.85;
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
