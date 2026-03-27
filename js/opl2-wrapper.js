import { DBOPL } from './dbopl.js';

class OPL2Wrapper {
  constructor(rate) {
    this.rate = rate;
    this.opl = new DBOPL.OPL(rate, 1); // mono
  }

  write(reg, val) {
    this.opl.write(reg, val);
  }

  reset() {
    // Re-create the OPL instance for a clean reset
    this.opl = new DBOPL.OPL(this.rate, 1);
  }

  // Generate samples into a Float32Array, converting from Int16
  generate(numSamples, outBuf) {
    let offset = 0;
    while (offset < numSamples) {
      const chunk = Math.min(numSamples - offset, 512);
      // DBOPL requires minimum 2 samples
      const toGen = Math.max(2, chunk);
      const samples = this.opl.generate(toGen);
      for (let i = 0; i < chunk; i++) {
        outBuf[offset + i] = samples[i] / 32768.0;
      }
      offset += chunk;
    }
  }
}

export { OPL2Wrapper };
