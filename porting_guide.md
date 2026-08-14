# ZXDrawer Porting Guide

This document tracks changes made to ZXDrawer that need to be ported to the embedded version inside ZX Game Maker Studio.

## [New Feature] Vertical Animation Preview Layout

**Goal:** Allow users to preview sprite animations laid out vertically, asking for "Frame Height" instead of "Frame Width".

### Changes in `index.html`
- In the `<div class="anim-controls">` section, added a `<select>` for layout orientation (`id="anim-orientation"`).
- Renamed the input `id="anim-frame-w"` to `id="anim-frame-size"`.
- Wrapped the label text with `<label id="anim-size-label">` to easily toggle the translation key between "Frame W" and "Frame H" based on the dropdown.

### Changes in `renderer.js`
- **`setupAnimationViewer()`**:
  - Added an `onchange` listener for `#anim-orientation` to dynamically update the size label using the corresponding `data-i18n` key and reset the animation player.
  - Replaced the listener from `anim-frame-w` to `anim-frame-size`.
- **`getAnimParams()`**: Now returns an object `{ orient, frameSize, fps }` reading from the updated inputs.
- **`paintOnAnim(e)`**: Now computes `frameW` and `frameH` based on the clipboard dimensions and `orient`. Maps drawing coordinates from the preview canvas to the main canvas correctly by factoring in whether the frames advance along the X axis or Y axis.
- **`selectCurrentAnimFrame()`**: The bounding box calculation now shifts the selection rectangle along the Y axis when the layout is vertical.
- **`renderAnimFrame()`**: Iterates over pixels correctly depending on the orientation to build the frame.

### Changes in `locales/*.json`
Added new translation keys across `en.json`, `es.json` and `pt.json`:
- `anim.frameh`
- `anim.orientation`
- `anim.horiz`
- `anim.vert`

## [New Feature] Emulate Sprite in ZX Spectrum Screen

**Goal:** Provide an "Emulate" button in the animation viewer that opens a modal simulating a ZX Spectrum screen (256x192, scaled 2x to 512x384), allowing the user to move the selected sprite/animation around using classic keys (O, P, Q, A).

### Changes in `index.html`
- **Button:** Added `<button id="anim-emulate-btn">` inside `<div class="anim-controls">` block (near the play controls) with translation key `btn.emulate`.
- **Modal:** Added a new `<div id="emulate-modal" class="modal hidden">` containing:
  - Title (`modal.emulate.title`).
  - Hint text (`modal.emulate.hint`) explaining the keys O, P, Q, A.
  - Dropdowns for Movement settings:
    - `<select id="emu-move-step">` (1 to 4) labeled with `modal.emulate.movestep`.
    - `<select id="emu-anim-dist">` (1 to 4) labeled with `modal.emulate.animdist`.
  - Canvas: `<canvas id="emulate-canvas" width="256" height="192" style="width: 512px; height: 384px; ...">`.

### Changes in `renderer.js`
- **Variables added to constructor:** 
  - `this.emuX`, `this.emuY`
  - `this.emuKeys` (tracks held down keys)
  - `this.emuReq` (requestAnimationFrame ID)
  - `this.emuLastTime`, `this.emuTickTimer`, `this.emuDistanceAccumulator`, `this.emuCurrentFrame`.
- **Event Listeners in `setupAnimationViewer()`:**
  - Bound `#anim-emulate-btn` to call `this.startEmulation()`.
  - Bound `#emulate-close` to call `this.stopEmulation()`.
- **Emulation Logic (`startEmulation`, `stopEmulation`, `updateEmulation`, `drawEmulation`):**
  - **Loop:** A `requestAnimationFrame` loop keeps the emulation running, locked internally to a 50Hz logic tick (20ms) for retro accuracy.
  - **Input:** Global `keydown`/`keyup` events specifically track O, P, Q, A.
  - **Movement:** When moving, reads the step speed from `#emu-move-step` and updates `this.emuX`/`this.emuY`. Adds this distance to `this.emuDistanceAccumulator`.
  - **Animation:** Sprite remains on frame 0 when idle. When moving, frame advances every time `emuDistanceAccumulator` surpasses `#emu-anim-dist`.
  - **Rendering:** Clears the 256x192 canvas with black, and stamps the current sprite frame onto it at `Math.floor(this.emuX)`, `Math.floor(this.emuY)`.

### Changes in `locales/*.json`
Added new translation keys across `en.json`, `es.json` and `pt.json`:
- `btn.emulate`
- `modal.emulate.title`
- `modal.emulate.hint`
- `modal.emulate.movestep`
- `modal.emulate.animdist`

## [New Feature] Advanced Emulation (Physics & Action Frames)

**Goal:** Allow users to test directional sprites (Top-Down and Platformer) with custom frame mapping and basic physics integration.

### Changes in `index.html`
- Added `#emu-mode` select to toggle between Top-Down (Cenital) and Platformer (Plataformas lateral).
- Added an `#emu-spritesets` section below the canvas. This container dynamically renders the full clipboard sprite 4 times, allowing users to map specific frames to different logical actions by clicking them.
- Loaded `<script src="sprite-emulator.js"></script>` before `renderer.js`.

### Extracted logic to `sprite-emulator.js`
To keep `renderer.js` clean, all emulation and UI rendering logic for the emulator modal has been extracted to a standalone `SpriteEmulator` class.
- The `ZXDrawer` app instantiates it as `this.emulator = new SpriteEmulator(this)`.
- It takes full responsibility for handling the 50Hz logic loop, platformer physics, mapping inputs to `this.emuKeys`, and updating/drawing the sprites onto the `emulate-canvas`.

### Changes in `renderer.js`
- Replaced the large emulation block with `this.emulator.start()` and `this.emulator.stop()` inside the `anim-emulate-btn` event listeners.

### Changes in `locales/*.json`
- Added UI translation strings: `modal.emulate.mode`, `modal.emulate.topdown`, `modal.emulate.platformer`, `modal.emulate.spritesets`, and the 7 action labels (`up`, `down`, `left`, `right`, `jumpl`, `jumpr`, `idle`).

---

## [Refactor] Modularisation & Bug Fixes for SpriteEmulator

**Goal:** Fix a critical bug where `this.emulator` was being replaced on every `renderAnimFrame()` call, wiping the user's frame selections. Stabilise the emulator lifecycle and clean up stale state from `renderer.js`.

### Changes in `renderer.js`
- **Moved emulator instantiation** out of `renderAnimFrame()` into `setupAnimationViewer()` so `new SpriteEmulator(this)` is called **exactly once** per session.
- **Removed legacy emulation variables** from the `ZXDrawer` constructor (`this.emuX`, `this.emuY`, `this.emuKeys`, `this.emuReq`, `this.emuLastTime`, `this.emuFrameTimeAccumulator`, `this.emuCurrentFrame`). All emulation state now lives exclusively inside `SpriteEmulator`.

### Changes in `sprite-emulator.js`
- **`start()`**: Sprite now spawns at the **bottom of the screen** (grounded) in platformer mode, not at Y=96. Prevents the sprite from immediately entering a falling/jump state on first tick.
- **Gravity fix**: Gravity (`emuVelocityY += 0.5`) only applies when `!emuIsGrounded`, preventing velocity from accumulating while standing.
- **`emuDisplayFrame`**: Introduced a dedicated variable tracking the actual sprite-sheet frame number shown on canvas. This decouples display from animation index arithmetic and allows the character to **hold the last frame it was on** when movement stops, without jumping to frame 0.
- **Idle timer**: When stopped, `emuIdleTimer` counts up. After **5 seconds** of no input, the idle frames (action index 4) start cycling at **1 frame per 500 ms**. Any movement resets the timer.
- **Action-change reset policy**: `emuCurrentFrameIdx` and `emuAnimTimer` are only reset when **starting** to move, not when stopping, preserving the last drawn frame.

---

## [New Feature] Modal UI Redesign — Two-column layout

**Goal:** Better use of screen real estate in the emulate modal.

### Changes in `index.html`
- **Two-column layout**: Canvas (512×384 px) on the left; controls panel on the right using `display:flex; gap:20px`.
- **Controls panel** (right column) contains:
  - Mode, Move step, Anim every — stacked vertically with aligned labels.
  - Frame-assignment section (`#emu-spritesets`) below, with `max-height:300px` scroll area.
- **Close button** moved to the modal header bar alongside the title (top-right).
- **`#emu-anim-dist`** select extended from 1–4 to **1–8** options.
- **Hint text** moved below the canvas; updated dynamically by `_updateHint()`.

---

## [New Feature] Isometric Mode in Emulator

**Goal:** Add a third emulation mode for classic ZX Spectrum isometric games (Knight Lore style).

### Changes in `index.html`
- Added `<option value="isometric">` to `#emu-mode` select.

### Changes in `sprite-emulator.js`

#### `buildSpritesets()`
- New branch for `this.emuMode === 'isometric'` that shows 5 action rows:
  - `0 = NE (Q)`, `1 = SE (P)`, `2 = SO (A)`, `3 = NO (O)`, `4 = Quieto`

#### `_tick()` — isometric branch
- **Movement**: Diagonal screen-space vectors (no gravity, no grounding):
  - **Q (NE)**: `movedX += step`, `movedY -= step × 0.5`
  - **P (SE)**: `movedX += step`, `movedY += step × 0.5`
  - **A (SO)**: `movedX -= step`, `movedY += step × 0.5`
  - **O (NO)**: `movedX -= step`, `movedY -= step × 0.5`
- No keys pressed → action 4 (idle, 5-second rule applies).

#### `_updateHint()`
- New helper method. Updates `#emu-hint` text to show the correct key legend for the active mode (Cenital / Plataformas / Isométrico). Called from `start()` and from the `emu-mode` change handler.

#### Mode-change handler
- Switching to **isometric**: sets action to idle (4), repositions sprite near centre, calls `_updateHint()` and `buildSpritesets()`.
- Switching to **platformer**: sets `emuIsGrounded = false` so gravity activates immediately.

### Changes in `locales/*.json`
Added new translation keys to `en.json`, `es.json`, `pt.json`:
- `modal.emulate.isometric`
- `modal.emulate.act.iso.ne`
- `modal.emulate.act.iso.se`
- `modal.emulate.act.iso.sw`
- `modal.emulate.act.iso.nw`
