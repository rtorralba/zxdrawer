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
