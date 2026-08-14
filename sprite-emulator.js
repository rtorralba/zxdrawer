/**
 * SpriteEmulator – handles the "Emulate" modal for ZXDrawer.
 *
 * Action indices (platformer):
 *   0 = Walk Left   1 = Walk Right
 *   2 = Jump Left   3 = Jump Right
 *   4 = Idle
 *
 * Action indices (topdown):
 *   0 = Up   1 = Down   2 = Left   3 = Right
 *   -1 = stopped (no animation)
 */
class SpriteEmulator {
    constructor(app) {
        this.app = app;

        // Per-action selected frames: user clicks them in the UI
        // Starts empty so nothing is pre-selected
        this.emuActionFrames = [[], [], [], [], []];

        // Runtime state (initialised properly in start())
        this.emuX = 128;
        this.emuY = 96;
        this.emuKeys = {};
        this.emuReq = null;
        this.emuLastTime = 0;
        this.emuTickTimer = 0;    // ms accumulator for 20 ms logic ticks
        this.emuIdleTimer = 0;    // ms the character has been idle
        this.emuAnimTimer = 0;    // ms accumulator for distance-based animation
        this.emuCurrentFrameIdx = 0;
        this.emuDisplayFrame = 0;
        this.emuCurrentAction = 4;

        this.emuFacingRight = true;
        this.emuVelocityY = 0;
        this.emuIsGrounded = true;
        this.emuMode = 'platformer';

        this.emuKeydownHandler = (e) => { this.emuKeys[e.code] = true; };
        this.emuKeyupHandler   = (e) => { this.emuKeys[e.code] = false; };

        const modeSelect = document.getElementById('emu-mode');
        if (modeSelect) {
            modeSelect.addEventListener('change', () => {
                this.emuMode = modeSelect.value;
                this.emuActionFrames = [[], [], [], [], []];
                if (this.emuMode === 'platformer') {
                    this.emuIsGrounded = false;
                    this.emuVelocityY = 0;
                    this.emuCurrentAction = 4;
                } else if (this.emuMode === 'isometric') {
                    this.emuCurrentAction = 4; // idle
                    // Position sprite near centre
                    this.emuX = 100;
                    this.emuY = 80;
                } else { // topdown
                    this.emuCurrentAction = -1;
                }
                this.emuIdleTimer = 0;
                this._updateHint();
                this.buildSpritesets();
            });
        }
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    start() {
        const modal = document.getElementById('emulate-modal');
        if (!modal) return;
        const clipboard = this.app.clipboard;
        if (!clipboard) return;
        modal.classList.remove('hidden');

        const modeSelect = document.getElementById('emu-mode');
        if (modeSelect) this.emuMode = modeSelect.value || 'platformer';

        const { frameSize, orient } = this.app.getAnimParams();
        const { w, h } = clipboard;
        const fPixW = (orient === 'v' ? w : frameSize) * 8;
        const fPixH = (orient === 'v' ? frameSize : h) * 8;

        // Reset runtime state
        this.emuX = Math.floor((256 - fPixW) / 2);
        // Platformer: start at the bottom (grounded). Topdown: centre.
        this.emuY = (this.emuMode === 'platformer') ? (192 - fPixH) : Math.floor((192 - fPixH) / 2);

        this.emuKeys = {};
        this.emuLastTime = performance.now();
        this.emuTickTimer = 0;
        this.emuIdleTimer = 0;
        this.emuAnimTimer = 0;
        this.emuCurrentFrameIdx = 0;
        this.emuDisplayFrame = 0;   // actual sprite-sheet frame number shown on canvas
        this.emuCurrentAction = (this.emuMode === 'platformer') ? 4 : -1;
        this.emuFacingRight = true;
        this.emuVelocityY = 0;
        this.emuIsGrounded = true;

        // Clear selections so user starts fresh
        this.emuActionFrames = [[], [], [], [], []];

        this.buildSpritesets();

        window.addEventListener('keydown', this.emuKeydownHandler);
        window.addEventListener('keyup',   this.emuKeyupHandler);

        const loop = (time) => {
            if (modal.classList.contains('hidden')) return;
            this.update(time);
            this.draw();
            this.emuReq = requestAnimationFrame(loop);
        };
        this.emuReq = requestAnimationFrame(loop);

        this._updateHint();
    }

    stop() {
        const modal = document.getElementById('emulate-modal');
        if (modal) modal.classList.add('hidden');
        if (this.emuReq) { cancelAnimationFrame(this.emuReq); this.emuReq = null; }
        window.removeEventListener('keydown', this.emuKeydownHandler);
        window.removeEventListener('keyup',   this.emuKeyupHandler);
    }

    _updateHint() {
        const el = document.getElementById('emu-hint');
        if (!el) return;
        if (this.emuMode === 'isometric') {
            el.textContent = 'Isométrico: Q=NE  P=SE  A=SO  O=NO';
        } else if (this.emuMode === 'platformer') {
            el.textContent = 'Plataformas: O=Izda  P=Dcha  Q=Salto';
        } else {
            el.textContent = 'Cenital: O=Izda  P=Dcha  Q=Arriba  A=Abajo';
        }
    }



    buildSpritesets() {
        const container = document.getElementById('emu-spritesets');
        if (!container || !this.app.clipboard) return;
        container.innerHTML = '';

        const loc = this.app._currentLocaleMap || {};
        let actionNames;
        if (this.emuMode === 'platformer') {
            actionNames = [
                loc['modal.emulate.act.left']  || 'Izda',
                loc['modal.emulate.act.right'] || 'Dcha',
                loc['modal.emulate.act.jumpl'] || 'Salto Izda',
                loc['modal.emulate.act.jumpr'] || 'Salto Dcha',
                loc['modal.emulate.act.idle']  || 'Quieto'
            ];
        } else if (this.emuMode === 'isometric') {
            // 4 diagonal directions + idle
            // 0=NE(Q)  1=SE(P)  2=SW(A)  3=NW(O)  4=Idle
            actionNames = [
                loc['modal.emulate.act.iso.ne'] || 'NE (Q)',
                loc['modal.emulate.act.iso.se'] || 'SE (P)',
                loc['modal.emulate.act.iso.sw'] || 'SO (A)',
                loc['modal.emulate.act.iso.nw'] || 'NO (O)',
                loc['modal.emulate.act.idle']   || 'Quieto'
            ];
        } else { // topdown
            actionNames = [
                loc['modal.emulate.act.up']    || 'Arriba',
                loc['modal.emulate.act.down']  || 'Abajo',
                loc['modal.emulate.act.left']  || 'Izda',
                loc['modal.emulate.act.right'] || 'Dcha'
            ];
        }

        const { frameSize, orient } = this.app.getAnimParams();
        const { w, h, pixels, attributes } = this.app.clipboard;
        const totalFrames = Math.max(1, Math.floor((orient === 'v' ? h : w) / frameSize));
        const frameW = orient === 'v' ? w : frameSize;
        const frameH = orient === 'v' ? frameSize : h;
        const fPixW  = frameW * 8;
        const fPixH  = frameH * 8;

        // Ensure array is big enough
        while (this.emuActionFrames.length < actionNames.length) {
            this.emuActionFrames.push([]);
        }

        for (let a = 0; a < actionNames.length; a++) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px';

            const label = document.createElement('div');
            label.textContent = actionNames[a];
            label.style.cssText = 'width:72px;font-size:12px;color:#ccc;flex-shrink:0';

            const framesDiv = document.createElement('div');
            framesDiv.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap';

            for (let f = 0; f < totalFrames; f++) {
                const fc = document.createElement('canvas');
                fc.width  = fPixW;
                fc.height = fPixH;
                const scale = Math.max(1, Math.floor(40 / Math.max(fPixW, fPixH)));
                fc.style.cssText = `width:${fPixW*scale}px;height:${fPixH*scale}px;image-rendering:pixelated;cursor:pointer`;
                fc.title = `Frame ${f}`;

                const updateBorder = () => {
                    fc.style.border = this.emuActionFrames[a].includes(f)
                        ? '2px solid #D7D700'
                        : '2px solid #444';
                };
                updateBorder();

                fc.addEventListener('click', () => {
                    const idx = this.emuActionFrames[a].indexOf(f);
                    if (idx > -1) {
                        this.emuActionFrames[a].splice(idx, 1);
                    } else {
                        this.emuActionFrames[a].push(f);
                        this.emuActionFrames[a].sort((x, y) => x - y);
                    }
                    updateBorder();
                });

                // Draw thumbnail
                const imgData = fc.getContext('2d').createImageData(fPixW, fPixH);
                const d = imgData.data;
                for (let py = 0; py < fPixH; py++) {
                    for (let px = 0; px < fPixW; px++) {
                        let srcX = px, srcY = py;
                        if (orient === 'v') { srcY = f * fPixH + py; if (srcY >= h*8) continue; }
                        else                { srcX = f * fPixW + px; if (srcX >= w*8) continue; }
                        const bx = Math.floor(srcX/8), by = Math.floor(srcY/8);
                        const attr   = attributes[by*w+bx] || 0;
                        const bright = (attr>>6)&1, ink = attr&7, paper = (attr>>3)&7;
                        const inkC   = this.app.hexToRgb(SPECTRUM_PALETTE[bright][ink]);
                        const paperC = this.app.hexToRgb(SPECTRUM_PALETTE[bright][paper]);
                        const color  = pixels[srcY*(w*8)+srcX] ? inkC : paperC;
                        const i = (py*fPixW+px)*4;
                        d[i]=color.r; d[i+1]=color.g; d[i+2]=color.b; d[i+3]=255;
                    }
                }
                fc.getContext('2d').putImageData(imgData, 0, 0);
                framesDiv.appendChild(fc);
            }

            row.appendChild(label);
            row.appendChild(framesDiv);
            container.appendChild(row);
        }
    }

    // ─── Logic update (runs at 50 Hz) ─────────────────────────────────────────

    update(time) {
        const dt = time - this.emuLastTime;
        this.emuLastTime = time;
        this.emuTickTimer += dt;

        while (this.emuTickTimer >= 20) {
            this.emuTickTimer -= 20;
            this._tick();
        }
    }

    _tick() {
        const moveStep = parseInt(document.getElementById('emu-move-step').value) || 2;
        const animDist = parseInt(document.getElementById('emu-anim-dist').value) || 4;

        const { frameSize, orient } = this.app.getAnimParams();
        const { w, h } = this.app.clipboard;
        const fPixW = (orient === 'v' ? w        : frameSize) * 8;
        const fPixH = (orient === 'v' ? frameSize : h       ) * 8;

        let movedX = 0, movedY = 0;
        let newAction;

        // ── Platformer ────────────────────────────────────────────────────────
        if (this.emuMode === 'platformer') {
            const goLeft  = !!this.emuKeys['KeyO'];
            const goRight = !!this.emuKeys['KeyP'];
            const goJump  = !!this.emuKeys['KeyQ'];

            if (goLeft)  { movedX -= moveStep; this.emuFacingRight = false; }
            if (goRight) { movedX += moveStep; this.emuFacingRight = true; }

            // Gravity – only when airborne
            if (!this.emuIsGrounded) {
                this.emuVelocityY += 0.5;
            } else {
                this.emuVelocityY = 0;
            }

            // Jump
            if (goJump && this.emuIsGrounded) {
                this.emuVelocityY = -6;
                this.emuIsGrounded = false;
            }
            movedY = this.emuVelocityY;

            // Determine action based on current state
            if (!this.emuIsGrounded) {
                newAction = this.emuFacingRight ? 3 : 2; // Jump R / Jump L
            } else if (goLeft || goRight) {
                newAction = this.emuFacingRight ? 1 : 0; // Walk R / Walk L
            } else {
                newAction = 4; // Idle
            }

        // ── Isometric ─────────────────────────────────────────────────────────
        } else if (this.emuMode === 'isometric') {
            // Keys:  Q=NE  P=SE  A=SW  O=NW
            // Screen-space diagonals: x±step, y±step*0.5
            const goNE = !!this.emuKeys['KeyQ'];
            const goSE = !!this.emuKeys['KeyP'];
            const goSW = !!this.emuKeys['KeyA'];
            const goNW = !!this.emuKeys['KeyO'];

            if (goNE) { movedX += moveStep; movedY -= moveStep * 0.5; newAction = 0; }
            if (goSE) { movedX += moveStep; movedY += moveStep * 0.5; newAction = 1; }
            if (goSW) { movedX -= moveStep; movedY += moveStep * 0.5; newAction = 2; }
            if (goNW) { movedX -= moveStep; movedY -= moveStep * 0.5; newAction = 3; }
            if (!goNE && !goSE && !goSW && !goNW) newAction = 4; // idle

        // ── Top-down ──────────────────────────────────────────────────────────
        } else {
            const goUp    = !!this.emuKeys['KeyQ'];
            const goDown  = !!this.emuKeys['KeyA'];
            const goLeft  = !!this.emuKeys['KeyO'];
            const goRight = !!this.emuKeys['KeyP'];

            if (goUp)    { movedY -= moveStep; newAction = 0; }
            if (goDown)  { movedY += moveStep; newAction = 1; }
            if (goLeft)  { movedX -= moveStep; newAction = 2; }
            if (goRight) { movedX += moveStep; newAction = 3; }
            if (!goUp && !goDown && !goLeft && !goRight) newAction = -1;
        }

        // ── Action change ─────────────────────────────────────────────────────
        if (newAction !== this.emuCurrentAction) {
            const wasMoving = (this.emuCurrentAction !== 4 && this.emuCurrentAction !== -1);
            const nowMoving = (newAction !== 4 && newAction !== -1);
            this.emuCurrentAction = newAction;
            // Only reset frame counter when starting to move (not when stopping)
            if (nowMoving) {
                this.emuCurrentFrameIdx = 0;
                this.emuAnimTimer = 0;
            }
            this.emuIdleTimer = 0; // reset idle countdown whenever action changes
        }

        // ── Move ──────────────────────────────────────────────────────────────
        this.emuX += movedX;
        this.emuY += movedY;

        // ── Clamp X ───────────────────────────────────────────────────────────
        if (this.emuX < 0) this.emuX = 0;
        if (this.emuX + fPixW > 256) this.emuX = 256 - fPixW;

        // ── Clamp Y / grounded ────────────────────────────────────────────────
        if (this.emuMode === 'platformer') {
            if (this.emuY + fPixH >= 192) {
                this.emuY = 192 - fPixH;
                this.emuVelocityY = 0;
                this.emuIsGrounded = true;
                // If we just landed and we were in jump, move to walk/idle
                if (this.emuCurrentAction === 2 || this.emuCurrentAction === 3) {
                    const walking = movedX !== 0;
                    newAction = walking ? (this.emuFacingRight ? 1 : 0) : 4;
                    if (newAction !== this.emuCurrentAction) {
                        this.emuCurrentAction = newAction;
                        // Landing from jump while walking: reset anim
                        if (walking) { this.emuCurrentFrameIdx = 0; this.emuAnimTimer = 0; }
                        this.emuIdleTimer = 0;
                    }
                }
            }
            if (this.emuY < 0) { this.emuY = 0; this.emuVelocityY = 0; }
        } else {
            if (this.emuY < 0) this.emuY = 0;
            if (this.emuY + fPixH > 192) this.emuY = 192 - fPixH;
        }

        // ── Animation ─────────────────────────────────────────────────────────
        const action = this.emuCurrentAction;
        const frames = (action >= 0 && action < this.emuActionFrames.length)
            ? this.emuActionFrames[action]
            : [];

        const stopped = (action === -1 || action === 4);

        if (stopped) {
            // Count idle time; do NOT touch emuDisplayFrame until idle kicks in
            this.emuIdleTimer += 20;

            if (this.emuIdleTimer > 5000) {
                // Idle animation: cycle idle frames every 500 ms
                const idleFrames = this.emuActionFrames[4] || [];
                if (idleFrames.length > 0) {
                    this.emuAnimTimer += 20;
                    while (this.emuAnimTimer >= 500) {
                        this.emuAnimTimer -= 500;
                        this.emuCurrentFrameIdx = (this.emuCurrentFrameIdx + 1) % idleFrames.length;
                        this.emuDisplayFrame = idleFrames[this.emuCurrentFrameIdx];
                    }
                }
            }
            // else: keep emuDisplayFrame exactly as it was when movement stopped

        } else {
            // Moving: accumulate distance and advance frame
            const dist = Math.max(Math.abs(movedX), 1);
            this.emuAnimTimer += dist;

            if (frames.length > 0) {
                while (this.emuAnimTimer >= animDist) {
                    this.emuAnimTimer -= animDist;
                    this.emuCurrentFrameIdx = (this.emuCurrentFrameIdx + 1) % frames.length;
                }
                // Always update the displayed frame while moving
                this.emuDisplayFrame = frames[this.emuCurrentFrameIdx];
            } else {
                this.emuAnimTimer = 0;
                // No frames configured: show frame 0
                this.emuDisplayFrame = 0;
            }
        }
    }

    // ─── Render ───────────────────────────────────────────────────────────────

    draw() {
        const canvas = document.getElementById('emulate-canvas');
        if (!canvas || !this.app.clipboard) return;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const { frameSize, orient } = this.app.getAnimParams();
        const { pixels, attributes, w, h } = this.app.clipboard;

        const action = this.emuCurrentAction;
        const frames = (action >= 0 && action < this.emuActionFrames.length)
            ? this.emuActionFrames[action]
            : [];

        // Use the pre-computed display frame from _tick()
        let frameIdx = this.emuDisplayFrame;
        if (frameIdx === undefined || frameIdx === null) frameIdx = 0;

        const frameW = orient === 'v' ? w        : frameSize;
        const frameH = orient === 'v' ? frameSize : h;
        const fPixW  = frameW * 8;
        const fPixH  = frameH * 8;

        const imgData = ctx.createImageData(fPixW, fPixH);
        const data    = imgData.data;

        for (let py = 0; py < fPixH; py++) {
            for (let px = 0; px < fPixW; px++) {
                let srcX = px, srcY = py;
                if (orient === 'v') { srcY = frameIdx * fPixH + py; if (srcY >= h*8) continue; }
                else                { srcX = frameIdx * fPixW + px; if (srcX >= w*8) continue; }

                const bx = Math.floor(srcX/8), by = Math.floor(srcY/8);
                const attr   = attributes[by*w+bx] || 0;
                const flash  = (attr>>7)&1;
                const bright = (attr>>6)&1;
                const ink    = attr & 7;
                const paper  = (attr>>3)&7;
                let inkC   = this.app.hexToRgb(SPECTRUM_PALETTE[bright][ink]);
                let paperC = this.app.hexToRgb(SPECTRUM_PALETTE[bright][paper]);
                if (flash && this.app.flashInverted) [inkC, paperC] = [paperC, inkC];
                const color = pixels[srcY*(w*8)+srcX] ? inkC : paperC;
                const i = (py*fPixW+px)*4;
                data[i]=color.r; data[i+1]=color.g; data[i+2]=color.b; data[i+3]=255;
            }
        }

        const tmp = document.createElement('canvas');
        tmp.width = fPixW; tmp.height = fPixH;
        tmp.getContext('2d').putImageData(imgData, 0, 0);
        ctx.drawImage(tmp, Math.floor(this.emuX), Math.floor(this.emuY));
    }
}
