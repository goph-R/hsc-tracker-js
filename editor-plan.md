# HSC Tracker - Editor Mode Plan

Turn the current player into a real tracker editor. The goal is to allow composing
and editing HSC music directly in the browser, like classic DOS trackers (HSC Tracker,
Scream Tracker, FastTracker II, etc.).

## Current state

- Player-only: loads .hsc files, plays them via DBOPL in an AudioWorklet
- Pattern view is read-only HTML, re-rendered on each row change during playback
- Data model: `hscData` (parsed from file) and `hscCompact` (flat arrays sent to worklet)
- Pattern data: 64 rows x 9 channels x 2 bytes (note + effect) per pattern
- Note encoding: 0 = empty, 1-126 = note (value-1 gives semitone+octave), 0x7F = key-off, 0x80+ = instrument set
- No keyboard handling beyond Space (play/stop toggle)

## UI Layout

### Tabs
Two tabs under the "HSC Tracker" header:
- **Tracker** - pattern editor, order list, playback controls
- **Instruments** - instrument parameter editor (future, Phase 5)

The Instruments tab shows the currently loaded instruments for editing.

## Phase 1: Edit mode & cursor navigation

### Edit mode toggle
- **Space** toggles edit mode on/off (currently Space is play/stop - remap play/stop to
  different keys or make Space context-sensitive: play/stop when not in edit mode, toggle
  edit when a file is loaded and stopped)
- Visual indicator in the header/info bar showing "EDIT" when active
- Edit mode cursor: highlighted cell in the pattern grid (row + channel + column)

### Cursor movement
- **Up / Down arrows**: move cursor by one row
- **Left / Right arrows**: move cursor between columns (note → effect → next channel's note → ...)
- **Tab / Shift+Tab**: jump to the next / previous channel (skipping columns)
- **Page Up / Page Down**: move cursor by 16 rows
- **Home / End**: jump to first / last row of the pattern
- Cursor should be visible at all times (auto-scroll the pattern view)

### Edit step
- Configurable edit step (how many rows to advance after entering a note)
- Default: 1 row
- Adjustable via a small UI control or keyboard shortcut

## Phase 2: Note entry

### Keyboard-to-note mapping (piano layout)
Standard two-row tracker keyboard layout:

```
Lower octave:                Upper octave:
Z  S  X  D  C  V  G  B  H  N  J  M      Q  2  W  3  E  R  5  T  6  Y  7  U
C  C# D  D# E  F  F# G  G# A  A# B      C  C# D  D# E  F  F# G  G# A  A# B
```

- Notes are entered at the current cursor position
- The current octave (selectable, e.g. 0-7) determines the base octave
- After entering a note, cursor advances by the edit step

### Key-off
- **Backtick (`` ` ``)**: enters a key-off event (`^^^`) at the cursor position

### Delete / clear
- **Delete**: clear the current cell (set note and effect to 0)
- **Backspace**: clear cell and move cursor up one row

### Instrument selection
- Current instrument shown in the UI
- **Numpad +/-** or dedicated keys to change current instrument
- **Insert**: enters an instrument-set command (`Ins`) at the cursor position
  (HSC encoding: 0x80 | instrument_index in the note byte, instrument number in the
  effect byte). This is a manual action — instruments are NOT automatically inserted
  when entering notes.

### Effect entry
- When cursor is in the effect column (navigated via **Left/Right**),
  type hex digits for effect values
- Effects: pitch slide up/down (1/2), set volume (3), speed (5), pattern break (7),
  position jump (6), feedback (F)

## Phase 3: Pattern management

### Creating new patterns
- Button or keyboard shortcut to create a new empty pattern (64 rows x 9 channels, all zeroed)
- Maximum 50 patterns (HSC format limit)
- New pattern is appended to the pattern list

### Deleting patterns
- Remove selected pattern from the pattern list
- Update order list references: entries pointing to deleted pattern are removed,
  entries pointing to higher-numbered patterns are decremented
- Confirmation prompt to prevent accidents

### Duplicating patterns
- Clone the current pattern to a new slot
- Useful for creating variations

### Pattern length
- HSC patterns are always 64 rows (fixed by the format) - no need for variable length

## Phase 4: Order list editing

### Order list UI (FastTracker II style)
A vertical double-column list showing **index** (row number) and **pattern number**,
similar to FastTracker II / Milky Tracker.

Four buttons next to the list:
- **Insert**: insert the current pattern number after the current row
- **Delete**: delete the current row (shift subsequent entries up)
- **+**: increase the pattern number on the current row
- **-**: decrease the pattern number on the current row

### Order list constraints
- Maximum 51 entries including the 0xFF terminator
- Order list always ends with 0xFF (auto-maintained)
- Pattern numbers clamped to 0-49 (HSC format limit)

### Order list navigation
- Click a row to select it; double-click to jump to that position for playback
- Arrow keys to move between rows when the order list has focus

## Phase 5 (later): Instrument editor

Instrument editing on the **Instruments** tab. Works with currently loaded instruments
(no need to load a separate file). Each HSC instrument is 12 bytes mapping to OPL2 registers.

### Layout
- **Left side**: instrument list (0-127), click to select
- **Right side**: parameter editor for the selected instrument

### Parameter editor — two columns: Modulator | Carrier
Each operator gets the same set of controls:
- **Attack / Decay / Sustain / Release** — sliders (4-bit values each, 0-15)
- **Output Level** — slider (6-bit, 0-63, where 0 = loudest)
- **Multiplier** — stepper (0-15)
- **KSL** (Key Scale Level) — dropdown (0-3)
- **Waveform** — visual selector showing the 4 wave shapes (sine, half-sine, abs-sine, quarter-sine)
- **Tremolo / Vibrato / Sustain / KSR** — toggle checkboxes

### Global parameters (below the two columns)
- **Feedback** (0-7) — stepper or slider
- **Connection** — toggle: FM (modulator→carrier) vs AM (additive), with a small routing diagram
- **Fine-tune** (byte 11) — slider or number input

### Visual feedback
- ADSR envelope graph that updates live as sliders are dragged
- FM routing diagram (mod→car vs mod+car)

### Test controls
- Piano keys or keyboard shortcut to play a test note on a channel while editing
- Octave selector for test notes

### Instrument management
- Copy/Paste instrument (Ctrl+C/V in the instrument list)
- Right-click to duplicate/swap

## Phase 6 (later): Save / Load

File I/O will be added in a future phase:
- **Save**: serialize the in-memory song data back to the HSC binary format
  (128 instruments x 12 bytes + 51-byte order list + patterns x 1152 bytes)
- **Load**: already implemented (the current file loader)
- **New song**: create an empty song from scratch (blank instruments, one empty pattern,
  minimal order list)
- **Export**: possible future WAV/OGG export using OfflineAudioContext

## Implementation notes

### Data model changes
- Currently `hscData` is parsed once from a file and treated as immutable. It needs to
  become the live, mutable song state that the editor modifies in place.
- The `hscCompact` format (sent to the AudioWorklet) needs to be re-sent after edits,
  or the worklet needs to accept incremental updates (single register writes for note
  preview, pattern data patches for edits).

### Pattern view refactoring
- The pattern view currently rebuilds all 64 rows as HTML on every row change. For
  editing, each cell needs to be individually addressable (for cursor highlighting and
  in-place updates).
- Consider giving each cell a stable DOM element with a data attribute (row, channel)
  and updating cell content via `textContent` instead of full `innerHTML` rebuilds.

### Audio preview
- When a note is entered in edit mode, it should be played immediately (send the
  instrument setup + note-on register writes to the worklet for that channel).
- Need a way to send one-shot register writes to the worklet outside of sequencer
  playback.

### Keyboard handling
- Need a centralized keyboard handler that respects current focus/mode:
  - Edit mode: note entry keys, cursor movement, edit commands
  - Play mode: transport controls
  - Order list focused: order editing keys
- Prevent browser default actions for used keys (e.g., Space scrolling, arrow key scrolling)
