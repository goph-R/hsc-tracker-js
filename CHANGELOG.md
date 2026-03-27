# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-28

### Added

- **Tracker editor** with cursor navigation and edit mode (Space to toggle)
- **Note entry** via piano keyboard layout (Z-M lower octave, Q-U upper octave)
- **Effect entry** with hex digit input on the effect column
- **Key-off** with backtick, **instrument-set** with Insert
- **Note manipulation**: +/- for octave shift, */ for semitone shift
- **Edit step** control for cursor advance after note entry
- **FT2-style order list** with vertical panel, Insert/Delete/+/- buttons
- **Pattern management**: New, Duplicate, Delete patterns
- **Playback controls**: Enter (play from pattern), Shift+Enter (play from cursor), Ctrl+Enter (play from song start), Escape (stop)
- **Instrument-aware play-from-position**: scans channel state before playback
- **Note preview** in edit mode with correct instrument per channel
- **Instrument editor** tab with Carrier/Modulator parameter controls
  - ADSR sliders with live envelope visualization
  - Output level, multiplier, KSL, waveform selector
  - Tremolo, vibrato, sustain, KSR checkboxes
  - Feedback, FM/AM connection, fine-tune controls
- **Instrument preview** with piano keys and polyphonic channel rotation
- **Instrument file I/O**: Load/Save single instruments in INS format (Electronic Rats)
- **Instrument copy/paste** with Ctrl+C/V
- **Save/Load**: HSC binary format export (Ctrl+S), Open, New song
- **Settings tab** with persistent preferences (localStorage)
  - Blink effect on note
  - Help visible
  - QWERTZ keyboard layout support
- **Shortcuts panel** (F1 to toggle) with keyboard reference and effects guide
- **Channel header blink** on note triggers
- **Dark scrollbars** via color-scheme
- **Scroll-to-change** on all number inputs
- **Confirmation dialog** on New/Open/Drop when song is loaded
- **Drag & drop** HSC file loading
- **UI scaled to 133%** for better readability
- **Tabs**: Tracker, Instruments, Settings
- Split audio-worklet.js into ES modules (dbopl.js, opl2-wrapper.js, hsc-seq.js)
