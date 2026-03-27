// ---- HSC Sequencer (faithful port of AdPlug's hsc.cpp) ----

// op_table: modulator operator register offset for each channel
const OP_TABLE = [0, 1, 2, 8, 9, 10, 16, 17, 18];

// AdPlug's HSC note frequency table
const NOTE_FREQ = [363, 385, 408, 432, 458, 485, 514, 544, 577, 611, 647, 686];

class HSCSeq {
  constructor(opl2) {
    this.opl = opl2;
    this.hsc = null;
    this.playing = false;

    // Exact AdPlug state variables
    this.pattpos = 0;
    this.songpos = 0;
    this.pattbreak = 0;
    this.speed = 2;
    this.del = 1;
    this.songend = 0;
    this.mode6 = 0;
    this.bd = 0;
    this.fadein = 0;

    // Per-channel state (matches AdPlug's hscchan)
    this.channel = [];
    for (let i = 0; i < 9; i++) {
      this.channel[i] = { inst: 0, slide: 0, freq: 0 };
    }

    // adl_freq: B0 register shadow for each channel
    this.adl_freq = new Uint8Array(9);
    // Note trigger flags (set per tick, reset after state is read)
    this._chTriggered = new Uint8Array(9);
  }

  load(hsc) {
    this.hsc = hsc;
    this.rewind();
  }

  // Exact port of AdPlug's rewind()
  rewind() {
    this.pattpos = 0;
    this.songpos = 0;
    this.pattbreak = 0;
    this.speed = 2;
    this.del = 1;
    this.songend = 0;
    this.mode6 = 0;
    this.bd = 0;
    this.fadein = 0;

    this.opl.reset();
    this.opl.write(1, 32);
    this.opl.write(8, 128);
    this.opl.write(0xbd, 0);

    for (let i = 0; i < 9; i++) {
      this.channel[i] = { inst: 0, slide: 0, freq: 0 };
      this.adl_freq[i] = 0;
      this.setinstr(i, i); // init channels with instruments 0-8
    }
  }

  start() {
    if (!this.hsc) return;
    this.playing = true;
    this.rewind();
  }

  startFrom(songPos, pattPos, channelInstr, speed) {
    if (!this.hsc) return;
    this.rewind();
    this.songpos = songPos;
    this.pattpos = pattPos;
    this.del = 1;
    if (speed) this.speed = speed;
    // Apply scanned instrument state
    if (channelInstr) {
      for (let ch = 0; ch < 9; ch++) {
        this.setinstr(ch, channelInstr[ch]);
      }
    }
    this.playing = true;
  }

  stop() {
    this.playing = false;
    for (let ch = 0; ch < 9; ch++) {
      this.opl.write(0xb0 + ch, 0);
    }
  }

  // Preview a single note on a channel (for edit mode)
  previewNote(chan, noteByte) {
    if (!this.hsc) return;
    const noteVal = noteByte - 1;
    if (noteVal < 0 || noteVal === 0x7E) return;
    const oct = (Math.floor(noteVal / 12) & 7) << 2;
    const freq = NOTE_FREQ[noteVal % 12];
    this.opl.write(0xb0 + chan, 0); // key-off first
    this.adl_freq[chan] = oct | 32;  // key-on
    this.opl.write(0xa0 + chan, freq & 0xff);
    this.opl.write(0xb0 + chan, this.adl_freq[chan]);
  }

  stopPreview(chan) {
    this.opl.write(0xb0 + chan, 0);
  }

  // Exact port of AdPlug's setfreq()
  setfreq(chan, freq) {
    this.adl_freq[chan] = (this.adl_freq[chan] & ~3) | (freq >> 8);
    this.opl.write(0xa0 + chan, freq & 0xff);
    this.opl.write(0xb0 + chan, this.adl_freq[chan]);
  }

  // Exact port of AdPlug's setvolume()
  setvolume(chan, volc, volm) {
    const ins = this.hsc.instruments[this.channel[chan].inst];
    const op = OP_TABLE[chan];
    this.opl.write(0x43 + op, volc | (ins[2] & ~63));
    if (ins[8] & 1) // additive mode
      this.opl.write(0x40 + op, volm | (ins[3] & ~63));
    else
      this.opl.write(0x40 + op, ins[3]); // modulator uses instrument value
  }

  // Exact port of AdPlug's setinstr()
  setinstr(chan, insnr) {
    const ins = this.hsc.instruments[insnr];
    if (!ins) return;
    const op = OP_TABLE[chan];

    this.channel[chan].inst = insnr;
    this.opl.write(0xb0 + chan, 0); // stop old note

    // Set instrument registers
    this.opl.write(0xc0 + chan, ins[8]);
    this.opl.write(0x23 + op, ins[0]);  // carrier
    this.opl.write(0x20 + op, ins[1]);  // modulator
    this.opl.write(0x63 + op, ins[4]);  // carrier attack/decay
    this.opl.write(0x60 + op, ins[5]);  // modulator attack/decay
    this.opl.write(0x83 + op, ins[6]);  // carrier sustain/release
    this.opl.write(0x80 + op, ins[7]);  // modulator sustain/release
    this.opl.write(0xe3 + op, ins[9]);  // carrier waveform
    this.opl.write(0xe0 + op, ins[10]); // modulator waveform
    this.setvolume(chan, ins[2] & 63, ins[3] & 63);
  }

  // Exact port of AdPlug's update()
  tick() {
    if (!this.playing || !this.hsc) return null;

    this.del--;
    if (this.del) return null; // nothing done

    if (this.fadein) this.fadein--;

    let pattnr = this.hsc.orderList[this.songpos];

    // Arrangement handling
    if (pattnr >= 0xb2) {
      this.songend = 1;
      this.songpos = 0;
      pattnr = this.hsc.orderList[this.songpos];
    } else if ((pattnr & 128) && (pattnr <= 0xb1)) {
      this.songpos = pattnr & 127;
      this.pattpos = 0;
      pattnr = this.hsc.orderList[this.songpos];
      this.songend = 1;
    }

    if (pattnr === undefined || pattnr >= 50) {
      // skip pattern data
      this.del = this.speed;
      this._postRow();
      return this._makeState(pattnr);
    }

    const pat = this.hsc.patterns[pattnr];
    if (!pat) {
      this.del = this.speed;
      this._postRow();
      return this._makeState(pattnr);
    }

    const rowBase = this.pattpos * 9 * 2;

    for (let chan = 0; chan < 9; chan++) {
      const note = pat[rowBase + chan * 2];
      const effect = pat[rowBase + chan * 2 + 1];

      if (note & 128) { // set instrument
        this.setinstr(chan, effect);
        continue;
      }

      const eff_op = effect & 0x0f;
      const inst = this.channel[chan].inst;

      if (note) this.channel[chan].slide = 0;

      // Effect handling (BEFORE note!)
      switch (effect & 0xf0) {
        case 0x00: // global effect
          switch (eff_op) {
            case 1: this.pattbreak++; break;
            case 3: this.fadein = 31; break;
            case 5: this.mode6 = 1; break;
            case 6: this.mode6 = 0; break;
          }
          break;

        case 0x10: // AdPlug: 0x10 = freq += (slide up!)
        case 0x20: // AdPlug: 0x20 = freq -= (slide down!)
          if (effect & 0x10) {
            this.channel[chan].freq += eff_op;
            this.channel[chan].slide += eff_op;
          } else {
            this.channel[chan].freq -= eff_op;
            this.channel[chan].slide -= eff_op;
          }
          if (!note) this.setfreq(chan, this.channel[chan].freq);
          break;

        case 0x50: break; // set percussion (unimplemented)

        case 0x60: // set feedback
          this.opl.write(0xc0 + chan,
            (this.hsc.instruments[inst][8] & 1) + (eff_op << 1));
          break;

        case 0xa0: { // set carrier volume
          const vol = eff_op << 2;
          this.opl.write(0x43 + OP_TABLE[chan],
            vol | (this.hsc.instruments[inst][2] & ~63));
          break;
        }

        case 0xb0: { // set modulator volume
          const vol = eff_op << 2;
          if (this.hsc.instruments[inst][8] & 1)
            this.opl.write(0x40 + OP_TABLE[chan],
              vol | (this.hsc.instruments[inst][3] & ~63));
          else
            this.opl.write(0x40 + OP_TABLE[chan],
              vol | (this.hsc.instruments[inst][3] & ~63));
          break;
        }

        case 0xc0: { // set instrument volume
          const db = eff_op << 2;
          this.opl.write(0x43 + OP_TABLE[chan],
            db | (this.hsc.instruments[inst][2] & ~63));
          if (this.hsc.instruments[inst][8] & 1)
            this.opl.write(0x40 + OP_TABLE[chan],
              db | (this.hsc.instruments[inst][3] & ~63));
          break;
        }

        case 0xd0: // position jump
          this.pattbreak++;
          this.songpos = eff_op;
          this.songend = 1;
          break;

        case 0xf0: // set speed
          this.speed = eff_op;
          this.del = ++this.speed;
          break;
      }

      // Fade-in volume
      if (this.fadein)
        this.setvolume(chan, this.fadein * 2, this.fadein * 2);

      // Note handling
      if (!note) continue;

      let noteVal = note - 1;
      if (noteVal === 0x7e || ((Math.floor(noteVal / 12)) & ~7)) {
        // key-off (pause)
        this.adl_freq[chan] &= ~32;
        this.opl.write(0xb0 + chan, this.adl_freq[chan]);
        continue;
      }

      const Okt = (Math.floor(noteVal / 12) & 7) << 2;
      let Fnr = NOTE_FREQ[noteVal % 12]
        + this.hsc.instruments[inst][11]
        + this.channel[chan].slide;
      this.channel[chan].freq = Fnr;

      if (!this.mode6 || chan < 6)
        this.adl_freq[chan] = Okt | 32; // key-on
      else
        this.adl_freq[chan] = Okt; // no key-on for drums

      this.opl.write(0xb0 + chan, 0); // key-off first
      this.setfreq(chan, Fnr);
      this._chTriggered[chan] = 1;

      if (this.mode6) {
        switch (chan) {
          case 6: this.opl.write(0xbd, this.bd & ~16); this.bd |= 48; break;
          case 7: this.opl.write(0xbd, this.bd & ~1); this.bd |= 33; break;
          case 8: this.opl.write(0xbd, this.bd & ~2); this.bd |= 34; break;
        }
        this.opl.write(0xbd, this.bd);
      }
    }

    this.del = this.speed;
    this._postRow();
    return this._makeState(pattnr);
  }

  // Post-row processing (pattern break, advance)
  _postRow() {
    if (this.pattbreak) {
      this.pattpos = 0;
      this.pattbreak = 0;
      this.songpos++;
      this.songpos %= 50;
      if (!this.songpos) this.songend = 1;
    } else {
      this.pattpos++;
      this.pattpos &= 63;
      if (!this.pattpos) {
        this.songpos++;
        this.songpos %= 50;
        if (!this.songpos) this.songend = 1;
      }
    }
  }

  _makeState(pattnr) {
    const state = {
      songPos: this.songpos,
      patRow: this.pattpos === 0 ? 63 : this.pattpos - 1,
      patIdx: (pattnr !== undefined && pattnr < 50) ? pattnr : 0,
      speed: this.speed,
      chTriggered: this._chTriggered ? Array.from(this._chTriggered) : new Array(9).fill(0),
    };
    // Reset triggers after reading
    if (this._chTriggered) this._chTriggered.fill(0);
    return state;
  }
}

export { HSCSeq };
