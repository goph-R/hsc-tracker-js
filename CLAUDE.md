# CLAUDE.md

Project guidelines for Claude Code when working on HSC Tracker.

## Project Overview

HSC Tracker is a browser-based AdLib/OPL2 music tracker and player. It loads, edits, and saves HSC music files (AdLib Composer / HSC Tracker format) using DBOPL emulation in an AudioWorklet.

## Tech Stack

- Vanilla JavaScript, HTML, CSS — no frameworks, no build tools, no dependencies
- Single `index.html` contains all UI, CSS, and application logic
- Audio runs in an AudioWorklet using ES modules
- No bundler — files served directly via HTTP server

## Architecture

- `index.html` — Main application (UI, editor, keyboard handling, state management)
- `js/dbopl.js` — OPL2 emulator (DOSBox DBOPL port, IIFE namespace pattern)
- `js/opl2-wrapper.js` — Adapter between DBOPL and the sequencer
- `js/hsc-seq.js` — HSC sequencer (tick-based playback, note preview)
- `js/audio-worklet.js` — AudioWorkletProcessor entry point (ES module)
- `js/hsc-parser.js` — HSC binary format parser (loaded via script tag, not module)

## Key Patterns

- **DBOPL namespace**: Uses `var DBOPL; (function(DBOPL) { ... })(DBOPL || (DBOPL = {}));` IIFE pattern (compiled from TypeScript). Do not refactor to ES classes.
- **Data model**: `hscData` (structured, for UI) and `hscCompact` (flat arrays, for worklet). Both must be kept in sync when editing.
- **Pattern data**: `hscData.patterns[patIdx][row][ch] = { note, effect }`. Compact: `Uint8Array(64 * 9 * 2)`.
- **Instrument data**: `hscData.instruments[idx].raw` is a `Uint8Array(12)`. The parser applies bit corrections on load; these must be reversed on save.
- **Worklet communication**: Messages via `port.postMessage`. Types: `loadHSC`, `play`, `playFrom`, `stop`, `previewNote`, `stopPreview`.
- **Settings**: Stored in `localStorage` as JSON under key `hsc-tracker-settings`.

## File Formats

### HSC (song)
- 128 instruments x 12 bytes + 51-byte order list + N patterns x 1152 bytes
- Bit corrections applied on load (KSL/TL bit fix, pitch slide normalization)
- Must be reversed on save (`serializeHSC`)

### INS (single instrument)
- 12 raw bytes, no header (Electronic Rats / Hannes Seifert format)
- Same bit corrections as HSC instruments

## Coding Conventions

- All application JS is inside a single IIFE in `index.html`
- DOM elements referenced by ID, stored in `const` variables
- Functions use declaration style (hoisted) not arrow expressions
- CSS uses custom properties (`:root` variables) for theming
- Buttons are made unfocusable via `tabindex=-1` (MutationObserver for dynamic ones)
- Number inputs support scroll-to-change (wheel event)
- Keyboard handling: single `keydown` listener with priority order (F1 > Ctrl+S > Ctrl+C/V > Escape > Enter > Space > instrument tab > navigation > editing)

## Testing

No automated tests. Test manually by:
1. Loading an HSC file and verifying playback sounds correct
2. Editing notes/effects and playing back changes
3. Saving and re-loading to verify round-trip integrity
4. Testing instrument editor parameter changes with preview notes

## Important Notes

- `hsc-parser.js` is loaded via `<script>` tag (not ES module) — `parseHSC` is a global function
- The worklet uses `{ type: 'module' }` in `addModule` for ES module imports
- `dbopl.js` has a copyright header (DOSBox Team, GPL v2+) — preserve it
- When sending data to the worklet, `loadHSC` must be called before `previewNote` at least once
- Preview uses `previewHscLoaded` flag to avoid re-sending HSC data on every note (enables polyphonic preview)
