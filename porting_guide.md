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
