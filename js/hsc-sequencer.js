/**
 * HSC Sequencer - Tick-based playback engine for HSC files.
 *
 * Drives an OPL2 emulator via register writes at 18.2 Hz tick rate.
 */

const HSC_TICK_RATE = 18.2; // Hz (PC PIT timer frequency)

// OPL2 channel-to-operator register offset mapping
const CHAN_TO_MOD_OP = [0, 1, 2, 8, 9, 10, 16, 17, 18];
const CHAN_TO_CAR_OP = [3, 4, 5, 11, 12, 13, 19, 20, 21];

// AdPlug's HSC note frequency table (OPL2 F-numbers for 12 semitones)
const HSC_NOTE_FREQ = [363, 385, 408, 432, 458, 485, 514, 544, 577, 611, 647, 686];

class HSCSequencer {
  constructor() {
    this.hsc = null;
    this.playing = false;
    this.regWrites = []; // queued register writes for the audio worklet

    // Playback state
    this.songPos = 0;      // current position in order list
    this.patternRow = 0;   // current row in pattern (0-63)
    this.speed = 6;        // ticks per row
    this.delay = 1;        // tick countdown to next row

    // Per-channel state
    this.channelInstr = new Uint8Array(9);    // current instrument index
    this.channelNote = new Uint8Array(9);     // current note value
    this.channelSlide = new Int8Array(9);     // pitch slide accumulator
    this.channelFnum = new Uint16Array(9);    // current F-number
    this.channelBlock = new Uint8Array(9);    // current block/octave
    this.channelKeyOn = new Uint8Array(9);    // key-on state
    this.channelLevel = new Uint8Array(9);    // volume level

    // Song state
    this.songEnd = false;
    this.rhythmMode = false;
    this.fadeState = 0;  // 0 = no fade, >0 = fading (counter)
    this.fadeVolume = 63; // current fade volume (63=full, 0=silent)
    this._patternBreak = false;

    // Callbacks
    this.onRowChange = null;  // (songPos, patternRow, patternIndex) => void
    this.onSongEnd = null;    // () => void
  }

  /**
   * Load parsed HSC data.
   */
  load(hsc) {
    this.hsc = hsc;
    this.reset();
  }

  /**
   * Reset playback state to beginning.
   */
  reset() {
    this.songPos = 0;
    this.patternRow = 0;
    this.speed = 6;
    this.delay = 1;
    this.songEnd = false;
    this.rhythmMode = false;
    this.fadeState = 0;
    this.fadeVolume = 63;
    this.playing = false;
    this.regWrites = [];
    this.channelInstr.fill(0);
    this.channelNote.fill(0);
    this.channelSlide.fill(0);
    this.channelFnum.fill(0);
    this.channelBlock.fill(0);
    this.channelKeyOn.fill(0);
    this.channelLevel.fill(0);
  }

  /**
   * Initialize OPL2 registers for playback.
   * Returns array of register writes.
   */
  initOPL2() {
    const writes = [];
    // Enable waveform select
    writes.push([0x01, 0x20]);
    // Set test register
    writes.push([0x08, 0x00]);
    // Clear all channels
    for (let ch = 0; ch < 9; ch++) {
      writes.push([0xB0 + ch, 0x00]); // key-off all
      writes.push([0xA0 + ch, 0x00]); // freq = 0
    }
    // Set rhythm mode off
    writes.push([0xBD, 0x00]);
    return writes;
  }

  /**
   * Start playback.
   */
  start() {
    if (!this.hsc) throw new Error('No HSC data loaded');
    this.playing = true;
    const initWrites = this.initOPL2();
    this.regWrites.push(...initWrites);
  }

  /**
   * Stop playback.
   */
  stop() {
    this.playing = false;
    // Key-off all channels
    for (let ch = 0; ch < 9; ch++) {
      this.regWrites.push([0xB0 + ch, 0x00]);
    }
  }

  /**
   * Get current pattern index from order list.
   */
  getCurrentPattern() {
    if (!this.hsc) return 0;
    let pos = this.songPos;
    const order = this.hsc.orderList;

    // Resolve jumps
    let entry = order[pos] !== undefined ? order[pos] : 0xFF;
    if (entry >= 0x80 && entry <= 0xB1) {
      pos = entry & 0x7F;
      entry = order[pos] !== undefined ? order[pos] : 0xFF;
    }
    if (entry === 0xFF || entry >= 0xB2) {
      return -1; // end of song
    }
    if (entry >= this.hsc.patternCount) {
      return -1;
    }
    return entry;
  }

  /**
   * Set instrument on a channel.
   */
  _setInstrument(ch, instrIdx) {
    if (instrIdx >= 128) return;
    const ins = this.hsc.instruments[instrIdx];
    if (!ins) return;

    this.channelInstr[ch] = instrIdx;
    const modOp = CHAN_TO_MOD_OP[ch];
    const carOp = CHAN_TO_CAR_OP[ch];

    // Write all instrument registers to OPL2
    // HSC spec: byte 0 → reg 0x23+op (carrier), which equals 0x20+carOp
    this.regWrites.push([0x20 + carOp, ins.raw[0]]);  // Carrier: Trem/Vibr/Sust/KSR/Mul
    this.regWrites.push([0x20 + modOp, ins.raw[1]]);   // Modulator: Trem/Vibr/Sust/KSR/Mul
    this.regWrites.push([0x40 + carOp, ins.raw[2]]);   // Carrier: TL/KSL
    this.regWrites.push([0x40 + modOp, ins.raw[3]]);   // Modulator: TL/KSL
    this.regWrites.push([0x60 + carOp, ins.raw[4]]);   // Carrier: Attack/Decay
    this.regWrites.push([0x60 + modOp, ins.raw[5]]);   // Modulator: Attack/Decay
    this.regWrites.push([0x80 + carOp, ins.raw[6]]);   // Carrier: Sustain/Release
    this.regWrites.push([0x80 + modOp, ins.raw[7]]);   // Modulator: Sustain/Release
    this.regWrites.push([0xC0 + ch, ins.raw[8]]);      // Feedback/Connection
    this.regWrites.push([0xE0 + carOp, ins.raw[9]]);   // Carrier: Waveform
    this.regWrites.push([0xE0 + modOp, ins.raw[10]]);  // Modulator: Waveform
  }

  /**
   * Play a note on a channel.
   */
  _playNote(ch, noteVal) {
    // noteVal already decremented by 1 in processRow
    if (noteVal === 0x7E) {
      // Key-off
      this._keyOff(ch);
      return;
    }

    const semitone = noteVal % 12;
    const octave = Math.floor(noteVal / 12) & 7;

    // Get base F-number from table
    let fnum = HSC_NOTE_FREQ[semitone];

    // Add instrument pitch slide base
    const ins = this.hsc.instruments[this.channelInstr[ch]];
    if (ins) {
      fnum += ins.pitchSlide;
    }

    // Add accumulated slide
    fnum += this.channelSlide[ch];

    // Clamp F-number to 10-bit range
    fnum = Math.max(0, Math.min(0x3FF, fnum));

    this.channelFnum[ch] = fnum;
    this.channelBlock[ch] = octave;

    // Key-off first (retrigger)
    this.regWrites.push([0xB0 + ch, (octave << 2) | (fnum >> 8)]);

    // Set frequency low byte
    this.regWrites.push([0xA0 + ch, fnum & 0xFF]);

    // Key-on
    const b0val = 0x20 | (octave << 2) | (fnum >> 8);
    this.regWrites.push([0xB0 + ch, b0val]);

    this.channelKeyOn[ch] = 1;
    this.channelNote[ch] = noteVal;
  }

  /**
   * Key-off a channel.
   */
  _keyOff(ch) {
    const octave = this.channelBlock[ch];
    const fnum = this.channelFnum[ch];
    // Clear key-on bit
    this.regWrites.push([0xB0 + ch, (octave << 2) | (fnum >> 8)]);
    this.channelKeyOn[ch] = 0;
  }

  /**
   * Apply an effect on a channel.
   */
  _applyEffect(ch, effectByte) {
    if (effectByte === 0) return;

    const hi = (effectByte >> 4) & 0x0F;
    const lo = effectByte & 0x0F;

    switch (hi) {
      case 0x0: // Global control
        switch (lo) {
          case 0x1: // Pattern break
            this._patternBreak = true;
            break;
          case 0x3: // Fade in
            // Reset fade
            this.fadeState = 0;
            this.fadeVolume = 63;
            break;
          case 0x5: // 6-voice rhythm mode ON
            this.rhythmMode = true;
            this.regWrites.push([0xBD, 0x20]); // enable rhythm
            break;
          case 0x6: // 9-voice melodic mode ON
            this.rhythmMode = false;
            this.regWrites.push([0xBD, 0x00]); // disable rhythm
            break;
        }
        break;

      case 0x1: // Pitch slide down
        this.channelSlide[ch] -= lo;
        this._updateFreq(ch);
        break;

      case 0x2: // Pitch slide up
        this.channelSlide[ch] += lo;
        this._updateFreq(ch);
        break;

      case 0x6: // Set feedback
        {
          const ins = this.hsc.instruments[this.channelInstr[ch]];
          const conn = ins ? (ins.raw[8] & 1) : 0;
          this.regWrites.push([0xC0 + ch, conn | (lo << 1)]);
        }
        break;

      case 0xA: // Set carrier volume
        {
          const carOp = CHAN_TO_CAR_OP[ch];
          this.regWrites.push([0x40 + carOp, lo << 2]);
        }
        break;

      case 0xB: // Set modulator volume
        {
          const modOp = CHAN_TO_MOD_OP[ch];
          this.regWrites.push([0x40 + modOp, lo << 2]);
        }
        break;

      case 0xC: // Set overall volume
        {
          const carOp = CHAN_TO_CAR_OP[ch];
          const modOp = CHAN_TO_MOD_OP[ch];
          this.regWrites.push([0x40 + carOp, lo << 2]);
          this.regWrites.push([0x40 + modOp, lo << 2]);
        }
        break;

      case 0xD: // Position jump
        this.songPos = lo - 1; // will be incremented in tick()
        this._patternBreak = true;
        break;

      case 0xF: // Set speed
        this.speed = lo;
        this.delay = lo + 1;
        break;
    }
  }

  /**
   * Update frequency registers for a channel (for pitch slides).
   */
  _updateFreq(ch) {
    if (!this.channelKeyOn[ch]) return;

    const noteVal = this.channelNote[ch];
    const semitone = noteVal % 12;
    const octave = Math.floor(noteVal / 12) & 7;

    let fnum = HSC_NOTE_FREQ[semitone];
    const ins = this.hsc.instruments[this.channelInstr[ch]];
    if (ins) fnum += ins.pitchSlide;
    fnum += this.channelSlide[ch];
    fnum = Math.max(0, Math.min(0x3FF, fnum));

    this.channelFnum[ch] = fnum;
    this.channelBlock[ch] = octave;

    // Update registers (keep key-on state)
    this.regWrites.push([0xA0 + ch, fnum & 0xFF]);
    this.regWrites.push([0xB0 + ch, 0x20 | (octave << 2) | (fnum >> 8)]);
  }

  /**
   * Process one row of the current pattern.
   */
  _processRow() {
    const patIdx = this.getCurrentPattern();
    if (patIdx < 0) {
      // Song end
      this.songEnd = true;
      this.songPos = 0;
      this.patternRow = 0;
      if (this.onSongEnd) this.onSongEnd();
      return;
    }

    const pattern = this.hsc.patterns[patIdx];
    if (!pattern) return;

    const row = pattern[this.patternRow];
    if (!row) return;

    for (let ch = 0; ch < 9; ch++) {
      const cell = row[ch];
      const noteByte = cell.note;
      const effectByte = cell.effect;

      if (noteByte & 0x80) {
        // Set instrument
        this._setInstrument(ch, effectByte);
        continue;
      }

      if (noteByte !== 0) {
        // Play note (decrement by 1 as per HSC spec)
        const noteVal = noteByte - 1;
        this.channelSlide[ch] = 0; // reset slide on new note
        this._playNote(ch, noteVal);
      }

      // Apply effect (even if no note)
      this._applyEffect(ch, effectByte);
    }

    // Notify UI
    if (this.onRowChange) {
      this.onRowChange(this.songPos, this.patternRow, patIdx);
    }
  }

  /**
   * Process one tick (called at 18.2 Hz).
   * Returns array of register writes since last tick.
   */
  tick() {
    if (!this.playing || !this.hsc) return [];

    this.regWrites = [];

    this.delay--;
    if (this.delay <= 0) {
      this.delay = this.speed + 1;
      this._processRow();

      // Advance row (or skip to next pattern on break)
      if (this._patternBreak) {
        this._patternBreak = false;
        this.patternRow = 64; // force next pattern
      } else {
        this.patternRow++;
      }
      if (this.patternRow >= 64) {
        this.patternRow = 0;
        this.songPos++;

        // Handle order list navigation
        let entry = this.hsc.orderList[this.songPos];
        if (entry === undefined || entry === 0xFF || entry >= 0xB2) {
          // End of song - loop
          this.songPos = 0;
          this.songEnd = true;
        } else if (entry >= 0x80 && entry <= 0xB1) {
          // Jump
          this.songPos = entry & 0x7F;
        }
      }
    } else {
      // Between rows - still process continuous effects (slides)
      for (let ch = 0; ch < 9; ch++) {
        // Pitch slides continue between rows
        // (they're accumulated, so nothing to do here per-tick unless we want per-tick slides)
      }
    }

    // Handle fade
    if (this.fadeState > 0) {
      this.fadeState++;
      if (this.fadeState % 3 === 0 && this.fadeVolume > 0) {
        this.fadeVolume--;
        // Apply fade to all channels (set carrier volume)
        for (let ch = 0; ch < 9; ch++) {
          const carOp = CHAN_TO_CAR_OP[ch];
          this.regWrites.push([0x40 + carOp, (63 - this.fadeVolume)]);
        }
        if (this.fadeVolume === 0) {
          this.stop();
        }
      }
    }

    return this.regWrites;
  }

  /**
   * Start a fade-out.
   */
  fade() {
    this.fadeState = 1;
  }

  /**
   * Get info about current state for UI.
   */
  getState() {
    return {
      songPos: this.songPos,
      patternRow: Math.max(0, this.patternRow - 1), // show the row we just processed
      patternIndex: this.getCurrentPattern(),
      speed: this.speed,
      playing: this.playing,
      songEnd: this.songEnd,
      channelKeyOn: Array.from(this.channelKeyOn),
      channelInstr: Array.from(this.channelInstr),
      channelNote: Array.from(this.channelNote),
    };
  }
}

// Export
if (typeof window !== 'undefined') {
  window.HSCSequencer = HSCSequencer;
  window.HSC_TICK_RATE = HSC_TICK_RATE;
}
