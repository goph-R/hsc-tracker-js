/**
 * HSC (AdLib Composer) file format parser.
 *
 * File layout:
 *   0x0000: 128 instruments × 12 bytes = 1536 bytes
 *   0x0600: 51-byte order list
 *   0x0633: N patterns × 1152 bytes (64 rows × 9 channels × 2 bytes)
 *   Pattern count = (fileSize - 1587) / 1152
 */

/**
 * Parse an HSC file from an ArrayBuffer.
 * @param {ArrayBuffer} buffer - The raw HSC file data
 * @returns {Object} Parsed HSC data: { instruments, orderList, patterns, patternCount }
 */
function parseHSC(buffer) {
  const data = new Uint8Array(buffer);
  const fileSize = data.length;

  if (fileSize < 1587) {
    throw new Error('File too small to be a valid HSC file (min 1587 bytes)');
  }

  // --- 1. Parse 128 instruments (12 bytes each) ---
  const instruments = [];
  for (let i = 0; i < 128; i++) {
    const offset = i * 12;
    const ins = new Uint8Array(12);
    for (let j = 0; j < 12; j++) {
      ins[j] = data[offset + j];
    }

    // Apply bit corrections (AdPlug compatibility)
    // KSL/TL bit fix for carrier and modulator
    ins[2] ^= (ins[2] & 0x40) << 1;
    ins[3] ^= (ins[3] & 0x40) << 1;
    // Normalize pitch slide nibble
    ins[11] >>= 4;

    instruments.push({
      // Raw corrected bytes for register writes
      raw: ins,
      // Decoded fields for display
      carrierTremVibrSustKSR: ins[0],   // → reg 0x23+op
      modulatorTremVibrSustKSR: ins[1], // → reg 0x20+op
      carrierTL: ins[2],                 // → reg 0x43+op
      modulatorTL: ins[3],               // → reg 0x40+op
      carrierAD: ins[4],                 // → reg 0x63+op
      modulatorAD: ins[5],               // → reg 0x60+op
      carrierSR: ins[6],                 // → reg 0x83+op
      modulatorSR: ins[7],               // → reg 0x80+op
      feedbackConnection: ins[8],        // → reg 0xC0+ch
      carrierWaveform: ins[9],           // → reg 0xE3+op
      modulatorWaveform: ins[10],        // → reg 0xE0+op
      pitchSlide: ins[11],              // normalized 0-15
    });
  }

  // --- 2. Parse order list (51 bytes at offset 0x0600) ---
  const orderList = [];
  for (let i = 0; i < 51; i++) {
    const entry = data[0x0600 + i];
    orderList.push(entry);
    if (entry === 0xFF) break;
  }

  // --- 3. Parse patterns ---
  const patternDataStart = 0x0633; // 1587
  const patternSize = 1152; // 64 rows × 9 channels × 2 bytes
  const patternCount = Math.floor((fileSize - patternDataStart) / patternSize);

  const patterns = [];
  for (let p = 0; p < patternCount; p++) {
    const patternOffset = patternDataStart + p * patternSize;
    const rows = [];

    for (let row = 0; row < 64; row++) {
      const cells = [];
      for (let ch = 0; ch < 9; ch++) {
        const cellOffset = patternOffset + (row * 9 + ch) * 2;
        const note = data[cellOffset];
        const effect = data[cellOffset + 1];
        cells.push({ note, effect });
      }
      rows.push(cells);
    }
    patterns.push(rows);
  }

  return {
    instruments,
    orderList,
    patterns,
    patternCount,
  };
}

// Note name lookup
const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

/**
 * Format a note byte for display.
 * @param {number} noteByte - Raw note byte from pattern
 * @returns {string} Display string like "C-4", "---", "^^^", or "I05"
 */
function formatNote(noteByte) {
  if (noteByte === 0) return '---';
  if (noteByte & 0x80) return 'I' + String(noteByte & 0x7F).padStart(2, '0');

  const noteVal = noteByte - 1;
  if (noteVal === 0x7E) return '^^^'; // key-off

  const name = NOTE_NAMES[noteVal % 12];
  const octave = Math.floor(noteVal / 12);
  return name + octave;
}

/**
 * Format an effect byte for display.
 * @param {number} noteByte - Note byte (to check instrument set)
 * @param {number} effectByte - Effect byte
 * @returns {string} Display string like "F06", "...", or "05" (instrument)
 */
function formatEffect(noteByte, effectByte) {
  if (noteByte & 0x80) {
    // This is an instrument number
    return String(effectByte).padStart(2, '0') + ' ';
  }
  if (effectByte === 0) return '...';
  const hi = (effectByte >> 4) & 0x0F;
  const lo = effectByte & 0x0F;
  return hi.toString(16).toUpperCase() + lo.toString(16).toUpperCase() + ' ';
}

// Export
if (typeof window !== 'undefined') {
  window.parseHSC = parseHSC;
  window.formatNote = formatNote;
  window.formatEffect = formatEffect;
  window.NOTE_NAMES = NOTE_NAMES;
}
